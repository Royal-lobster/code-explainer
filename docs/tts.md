# TTS Reference

## Engine

**Kokoro-82M**, run locally through a pluggable backend chosen at startup:

| `TTS_BACKEND` | Engine | Used by default on |
|---|---|---|
| `auto` (default) | best available | - |
| `mlx` | mlx-audio (GPU) | Apple Silicon Macs |
| `torch` | kokoro + PyTorch (CUDA if available, else CPU) | Linux, Intel Macs, Apple Silicon without mlx-audio |
| `fake` | test tone, no model | tests and diagnostics |

`TTS_MODEL` overrides the backend's model id (defaults: `prince-canuma/Kokoro-82M` for mlx, `hexgrad/Kokoro-82M` for torch).

A persistent server (`tts_server.py`) loads the model once and listens on a random localhost port, advertised with an access token in `~/.code-explainer/run/tts-server.json`. First call ~5s (model load), later calls stream within about half a second on GPU. It starts automatically on the first TTS call, stops after `TTS_IDLE_TIMEOUT` seconds idle (default 300), and can be stopped with `tts_server.py --stop`. If no engine is installed, walkthroughs run without voice. The log is `~/.code-explainer/run/tts-server.log`.

## Behavior

- **Non-blocking** — agent continues while audio plays (`run_in_background: true`)
- **Auto-canceling** — new segment kills previous audio
- **Streaming** — playback starts on first sentence while rest generates

## Voices

Default: `af_heart`. Configurable via `TTS_VOICE` env var.

| Voice | Description |
|-------|-------------|
| `af_heart` | American female (default) |
| `af_bella` | American female |
| `af_sarah` | American female |
| `am_adam` | American male |
| `am_michael` | American male |
| `bf_emma` | British female |
| `bm_george` | British male |

Convention: `a`=American, `b`=British, `f`=female, `m`=male.

## Speed

Default: `1.0`. Configurable via `TTS_SPEED` env var. Always pass user's speed setting.

## Spoken text rules

- **Plain text only** — no backticks, bold, line numbers, file paths
- **2-4 sentences** — shorter than written explanation
- **Conversational** — as if explaining to a colleague
