# slopcord development notes

Discord bot and voice assistant to control local AI agents (`agy` / Antigravity, `claude` / Claude Code,
`codex` / Codex CLI) running on `slopbox`.

## Features and Architecture
- `src/index.js`: Main client entry point, slash command interactions, thread listeners, text mention parser.
- `src/commands.js`: Discord slash commands (`/prompt`, `/join`, `/leave`, `/status`, `/projects`, `/cancel`, `/help`).
- `src/agentRunner.js`: Agent execution manager. Spawns `agy`, `claude`, or `codex` with `--dangerously-skip-permissions`. Emits NDJSON step events, streams stdout/stderr, tracks pre/post git status and `git diff --stat`.
- `src/voice/voiceManager.js`: Voice channel connection manager (`@discordjs/voice`).
- `src/voice/audioProcessor.js`: Real-time Opus stream decoder with `@snazzah/davey` (DAVE E2EE support), silence detection (VAD), and in-memory downsampler from 48kHz stereo to 16kHz mono WAV buffer.
- `src/voice/stt.js`: Speech-to-Text supporting Groq Whisper API (`whisper-large-v3-turbo` for ultra low latency), OpenAI Whisper API, and local offline `whisper-cli` from `whisper-cpp`.
- `src/voice/intentParser.js`: Speech parser detecting direct address/wake phrases ("agent", "antigravity", "claude", "slopcord", "bot", etc.), mapping keywords to projects in `~/src` (e.g. `mayfly`, `trough`, `slop-landing`, `nixfiles`), and resolving tasks.
- `src/voice/tts.js`: Neural Text-to-Speech into Discord voice calls via `node-edge-tts` (default `en-US-ChristopherNeural`), piped through `ffmpeg-headless`.
- `src/discordUI.js`: Discord thread formatting, status embeds, live progress updates, and thread session continuity for follow-up prompts.

## Development & Testing
- Unit tests: `npm test` (uses Node's native `node:test` harness).
- Nix build: `nix build` (builds package and tests inside sandbox).
- Flake checks: `nix flake check`.
- Dev shell: `nix develop`.
- Service module: `nixosModules.default` exports `services.slopcord`.

## Secrets & Deployment
- Discord configuration lives in `~/.secrets/discord/config.json` (or token in `~/.secrets/discord/token`).
- Never log or commit Discord tokens, API keys, or private guild IDs.
- Remote: `https://github.com/slopmaxxer/slopcord.git`.
- Signed commits (`slop <slopmoder@tutamail.com>`), no Co-Authored-By trailers, no session links.
