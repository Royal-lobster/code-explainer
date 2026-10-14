"""Persistent TTS server: loads a backend once and streams audio over localhost TCP."""

from __future__ import annotations

import argparse
import hmac
import os
import secrets
import signal
import socket
import sys
import threading
import time

from codeexplainer import client, daemon, paths, protocol
from codeexplainer.endpoint import Endpoint, remove_endpoint, write_endpoint
from codeexplainer.tts import registry
from codeexplainer.tts.base import BackendUnavailable, TTSBackend


def log(message: str) -> None:
    """Write a timestamped line to stdout (the daemon's log file)."""
    print(f"[tts-server] {message}", flush=True)


class TTSServer:
    """Serves each connection on its own thread from a single loaded backend.

    Pings and shutdowns are answered immediately, even mid-narration, so clients
    never mistake a busy server for a dead one. Synthesis is serialized because
    backends are not thread-safe.
    """

    def __init__(
        self,
        backend: TTSBackend,
        *,
        idle_timeout: float = 300.0,
        default_voice: str = "af_heart",
        default_speed: float = 1.0,
        host: str = "127.0.0.1",
        poll_interval: float = 1.0,
    ) -> None:
        """Configure the server.

        Args:
            backend: Loaded TTS backend.
            idle_timeout: Seconds without requests before exiting; 0 disables.
            default_voice: Voice used when a request omits one.
            default_speed: Speed used when a request omits one.
            host: Loopback address to bind.
            poll_interval: How often the accept loop checks for stop and idleness.
        """
        self.backend = backend
        self.idle_timeout = idle_timeout
        self.default_voice = default_voice
        self.default_speed = default_speed
        self.host = host
        self.poll_interval = poll_interval
        self.token = secrets.token_hex(32)
        self._stop = threading.Event()
        self._listener: socket.socket | None = None
        self._synth_lock = threading.Lock()
        self._activity_lock = threading.Lock()
        self._in_flight = 0
        self._last_activity = time.monotonic()

    def start(self) -> Endpoint:
        """Bind an ephemeral port and publish the endpoint file.

        Returns:
            The published endpoint.
        """
        self._listener = socket.create_server((self.host, 0))
        self._listener.settimeout(self.poll_interval)
        ep = Endpoint(
            host=self.host, port=self._listener.getsockname()[1], token=self.token, pid=os.getpid()
        )
        write_endpoint(ep)
        log(f"Listening on {ep.host}:{ep.port} with backend {self.backend.name}")
        return ep

    def stop(self) -> None:
        """Ask the accept loop to exit at its next poll."""
        self._stop.set()

    def serve_forever(self) -> None:
        """Accept connections until stopped or idle, then remove the endpoint file."""
        if self._listener is None:
            self.start()
        assert self._listener is not None
        with self._activity_lock:
            self._last_activity = time.monotonic()
        try:
            while not self._stop.is_set():
                idle = self._idle_seconds()
                if self.idle_timeout > 0 and idle >= self.idle_timeout:
                    log(f"Idle for {int(idle)}s, shutting down to free memory.")
                    break
                try:
                    conn, _ = self._listener.accept()
                except TimeoutError:
                    continue
                threading.Thread(target=self._serve_connection, args=(conn,), daemon=True).start()
        finally:
            self._listener.close()
            remove_endpoint(only_if_pid=os.getpid())

    def _idle_seconds(self) -> float:
        """Return how long the server has been idle; 0 while a request is running."""
        with self._activity_lock:
            if self._in_flight:
                return 0.0
            return time.monotonic() - self._last_activity

    def _authorized(self, request: dict) -> bool:
        """Check the request token in constant time."""
        supplied = request.get("token")
        return isinstance(supplied, str) and hmac.compare_digest(
            supplied.encode("utf-8"), self.token.encode("utf-8")
        )

    def _serve_connection(self, conn: socket.socket) -> None:
        """Serve one connection on a worker thread, then close it.

        Only authenticated requests count as activity for the idle timer.

        Args:
            conn: Accepted connection.
        """
        with conn:
            conn.settimeout(30.0)
            try:
                request = protocol.read_request(conn)
            except Exception as exc:  # noqa: BLE001 - one bad request must not kill the server
                log(f"Request failed: {type(exc).__name__}: {exc}")
                return
            if not self._authorized(request):
                log("Rejected request with a missing or wrong token.")
                return
            with self._activity_lock:
                self._in_flight += 1
            try:
                self._respond(conn, request)
            except Exception as exc:  # noqa: BLE001 - one bad request must not kill the server
                log(f"Request failed: {type(exc).__name__}: {exc}")
            finally:
                with self._activity_lock:
                    self._in_flight -= 1
                    self._last_activity = time.monotonic()

    def _respond(self, conn: socket.socket, request: dict) -> None:
        """Answer an authenticated request: shutdown, ping, or synthesis.

        Raises:
            Exception: Whatever the backend or socket raises; the caller logs it.
        """
        if request.get("shutdown"):
            conn.sendall(protocol.END_FRAME)
            self.stop()
            return
        text = str(request.get("text") or "").strip()
        if text and not request.get("ping"):
            import numpy as np  # deferred so control commands (--stop) work without numpy

            voice = str(request.get("voice") or self.default_voice)
            speed = float(request.get("speed") or self.default_speed)
            with self._synth_lock:
                for chunk in self.backend.synthesize(text, voice, speed):
                    if chunk.size:
                        pcm = np.ascontiguousarray(chunk, dtype="<f4").tobytes()
                        conn.sendall(protocol.encode_frame(pcm))
        conn.sendall(protocol.END_FRAME)


def run() -> int:
    """Run the server in the foreground until stopped or idle.

    Returns:
        Process exit code.
    """
    if client.live_endpoint() is not None:
        log("Another instance is already running, exiting.")
        return 0
    try:
        log("Loading TTS backend...")
        backend = registry.create_backend()
    except BackendUnavailable as exc:
        log(str(exc))
        return 1
    if client.live_endpoint() is not None:
        log("Another instance started while loading, exiting.")
        return 0
    srv = TTSServer(
        backend,
        idle_timeout=float(os.environ.get("TTS_IDLE_TIMEOUT", "300")),
        default_voice=os.environ.get("TTS_VOICE", "af_heart"),
        default_speed=float(os.environ.get("TTS_SPEED", "1.0")),
    )
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: srv.stop())
    srv.start()
    srv.serve_forever()
    return 0


def main(argv: list[str] | None = None) -> int:
    """Command-line entry point.

    Args:
        argv: Arguments without the program name.

    Returns:
        Process exit code.
    """
    parser = argparse.ArgumentParser(description="Code Explainer TTS server")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--daemon", action="store_true", help="start in the background and return")
    mode.add_argument("--stop", action="store_true", help="stop the running server")
    args = parser.parse_args(argv)

    if args.stop:
        ep = client.live_endpoint()
        if ep is None:
            print("[tts-server] Not running.")
        else:
            client.shutdown(ep)
            print(f"[tts-server] Stopped (PID {ep.pid}).")
        return 0

    if args.daemon:
        try:
            name = registry.resolve_backend_name()
        except BackendUnavailable as exc:
            print(f"[tts-server] {exc}", file=sys.stderr)
            return 1
        pid = daemon.spawn_detached([sys.executable, str(client.SERVER_SCRIPT)], paths.log_file())
        print(f"[tts-server] Started daemon (PID {pid}, backend {name}) using {sys.executable}")
        return 0

    return run()
