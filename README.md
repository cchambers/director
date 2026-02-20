# Podcast Director (Discord)

Node.js bot that joins a Discord voice channel, transcribes who said what, logs the conversation, and periodically sends it to your **Moddit** endpoint for "director" suggestions (e.g. `api.moddit.io/1234`).

- **Voice only** (Discord voice channel).
- **Per-speaker** via Discord’s per-user receive streams (no ML diarization).
- **Transcription**: Deepgram (pre-recorded API on each speaking turn).
- **Director**: POST recent conversation to your API; suggestions print in the console.

## Requirements

- Node 18+ (22+ recommended for `@discordjs/voice` receive)
- [Discord Bot](https://discord.com/developers/applications) with token and **Message Content Intent** enabled
- [Deepgram](https://deepgram.com) API key
- Your Moddit API that accepts `POST /:sessionId` with body `{ conversation: [{ speaker, text, timestamp }] }` and returns suggestions

## Setup

1. **Clone / create project and install**

   ```bash
   cd podcast-director
   npm install
   ```

2. **Env**

   ```bash
   cp .env.example .env
   ```

   Edit `.env`:

   - `DISCORD_TOKEN` – bot token
   - `DISCORD_APPLICATION_ID` – app id (for slash command)
   - `DEEPGRAM_API_KEY` – Deepgram key
   - `MODDIT_API_URL`, `MODDIT_SESSION_ID` – your director API (default `https://api.moddit.io` and `1234`)

3. **Optional: register slash command**

   ```bash
   node src/registerCommands.js
   ```

4. **Run**

   ```bash
   npm start
   ```

   In Discord, either:

   - Say **join** in a channel where the bot can read messages, or  
   - Use **/join** (if you registered the command).

   The bot will join your current voice channel, stay muted, and receive audio. Transcripts appear in the console as `[SpeakerName] text`; director suggestions appear every 30s (configurable).

## Config (.env)

| Variable | Description |
|----------|-------------|
| `MODDIT_API_URL` | Base URL (e.g. `https://api.moddit.io`) |
| `MODDIT_SESSION_ID` | Path segment (e.g. `1234` → `POST .../1234`) |
| `MODDIT_CONTEXT_MESSAGES` | Last N messages sent to the director (default 20) |
| `MODDIT_SUGGESTION_INTERVAL_SEC` | Seconds between director calls (default 30) |
| `DEEPGRAM_MIN_AUDIO_MS` | Ignore utterances shorter than this (default 1500) |

## Moddit API contract

- **Request**: `POST {MODDIT_API_URL}/{MODDIT_SESSION_ID}`  
  Body: `{ conversation: [{ speaker: string, text: string, timestamp: string }] }`
- **Response**: JSON with a suggestion string, e.g. `{ suggestion: "..." }` or `{ text: "..." }` (see `modditClient.js`).

## Project layout

- `src/index.js` – Discord client, join on `join` / `/join`, starts voice receive and director loop
- `src/voiceHandler.js` – Subscribes to each user’s audio, Opus → PCM, buffer and send to Deepgram
- `src/transcribe.js` – Deepgram pre-recorded transcription (PCM 48kHz stereo)
- `src/conversationLog.js` – In-memory log with speaker labels
- `src/modditClient.js` – POST conversation to your API, parse suggestion
- `src/directorLoop.js` – Interval that sends recent log to Moddit and prints suggestions

## Possible next steps

- Persist conversation (DB or file)
- Post director suggestions into a Discord channel or TTS
- Slash commands for “leave” and “pause director”
- Support multiple guilds with separate sessions
