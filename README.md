# slopcord

Discord bot and voice assistant for controlling local AI coding agents (Antigravity, Claude Code, Codex) on `slopbox`.

## Features

- **Text Prompts & Thread Workflows:**
  - Send instructions via `/prompt <instruction> [agent] [project]` or mention `@Slopcord`.
  - Automatically creates a Discord Thread for each task.
  - Streams real-time tool execution, status updates, and command outputs.
  - Formats finishing results with duration, exit status, and `git diff --stat`.
  - **Thread Continuity:** Simply reply inside the thread with follow-up instructions to continue iterating on the exact same agent session.
- **Voice Call Integration:**
  - Summon the bot into any voice channel via `/join`.
  - Native **Discord DAVE E2EE** audio stream decryption (`@discordjs/voice` + `@snazzah/davey`).
  - Low-latency Speech-to-Text (Groq Whisper API, OpenAI Whisper API, or local `whisper-cpp`).
  - Conversational intent parsing: maps natural spoken speech to target projects in `~/src` (e.g. `mayfly`, `trough`, `slop-landing`, `nixfiles`, etc.) and agents (`agy`, `claude`, `codex`).
  - Natural neural Text-to-Speech (TTS) verbally confirms tasks and reports back when builds succeed or fail.
- **Agent Backend:**
  - Antigravity CLI (`agy`) with `--dangerously-skip-permissions` and NDJSON stream parsing.
  - Claude Code (`claude -p`).
  - Codex CLI (`codex exec`).
- **NixOS Service:**
  - Exported reusable NixOS module `services.slopcord`.

## Quick Start

### 1. Configuration
Create `~/.secrets/discord/config.json` (or set `config.json` in the project root):

```json
{
  "token": "YOUR_DISCORD_BOT_TOKEN",
  "clientId": "YOUR_DISCORD_APPLICATION_CLIENT_ID",
  "guildId": "YOUR_DISCORD_GUILD_ID",
  "allowedUsers": [
    "YOUR_DISCORD_USER_ID"
  ],
  "defaultAgent": "agy",
  "defaultProject": "slop-landing",
  "groqApiKey": "gsk_...",
  "ttsVoice": "en-US-ChristopherNeural"
}
```

### 2. Run with Nix

```bash
nix run .#slopcord
```

Or via development shell:

```bash
nix develop
node src/index.js
```

### 3. Discord Slash Commands

- `/prompt <instruction> [agent] [project]` - Dispatch an agent task
- `/join [channel]` - Summon bot into voice call
- `/leave` - Disconnect bot from voice call
- `/status` - Check running jobs, CPU and memory load
- `/projects` - List discovered projects in `~/src`
- `/cancel <job_id>` - Terminate a running agent job
- `/help` - Usage guide
