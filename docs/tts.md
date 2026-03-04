# TTS Reference

## Engine

TTS uses **Kokoro-82M** (via mlx-audio) by default -- #1 ranked open-source TTS, runs locally on Apple Silicon. The model is configurable via `TTS_MODEL` env var or user config.

Uses a **persistent server** (`tts_server.py`) that loads the model once and streams audio chunks to the client. First call takes ~5s (model load), subsequent calls play audio within ~450ms (streaming).

The server starts automatically on first TTS call and stays running in the background. Falls back to macOS `say` if mlx-audio is not installed.

## Behavior

- Speech is **non-blocking** -- the agent continues while audio plays (use `run_in_background: true` on the Bash call)
- Previous speech is **auto-canceled** when a new segment starts (the script kills the previous client process before speaking)
- Audio is **streamed** -- playback starts as soon as the first sentence is generated, while remaining sentences generate in parallel

## Voices

Default voice: `af_heart` (American English female) -- configurable via `TTS_VOICE` env var or user config.

Available voices:
| Voice | Description |
|-------|-------------|
| `af_heart` | American English female (default) |
| `af_bella` | American English female |
| `af_sarah` | American English female |
| `am_adam` | American English male |
| `am_michael` | American English male |
| `bf_emma` | British English female |
| `bm_george` | British English male |

Naming convention: `a`=American, `b`=British, `f`=female, `m`=male.

## Speed

Configurable via `TTS_SPEED` env var or user config (default 1.0).

| Speed | Use case |
|-------|----------|
| `1.0` | Normal pace, good for unfamiliar code |
| `1.25` | Slightly faster |
| `1.5` | Fast, good for familiar code |
| `2.0` | Very fast, skim mode |

**Always pass the user's speed setting** from config to the TTS scripts via `TTS_SPEED` env var.

## Formatting rules for spoken text

- **Strip all markdown** from spoken text: no backticks, no `**bold**`, no `line 42` references, no file paths
- Keep spoken explanations **shorter than written** ones -- aim for 2-4 sentences max
- The spoken text should sound **natural and conversational**, not like reading documentation
