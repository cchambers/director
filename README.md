# Podcast Director (Discord)

Node.js bot that joins a Discord voice channel, transcribes who said what, logs the conversation, and sends it to your **Moddit** endpoint for director suggestions. It also serves a **dashboard** at `http://localhost:8765` (configurable) for the conversation log, director suggestions, fact-check, claims, video search, and “speak as” voices. Optional TTS (ElevenLabs), OBS lower-third, and a video viewer (YouTube/Twitch embed) for easy next-video loading.

- **Voice only** (Discord voice channel).
- **Per-speaker** via Discord’s per-user receive streams (no ML diarization).
- **Transcription**: Deepgram (pre-recorded API on each speaking turn).
- **Director**: POST recent conversation to Moddit; suggestions appear in the dashboard (and optionally console).
- **Dashboard**: Conversation (editable), suggestions, fact-check, claims, video search, OBS lower-third, voice selection for “Speak” / “Speak with search”.

## Requirements

- Node 18+ (22+ recommended for `@discordjs/voice` receive)
- [Discord Bot](https://discord.com/developers/applications) with token and **Message Content Intent** enabled
- [Deepgram](https://deepgram.com) API key
- [Moddit](https://api.moddit.io) API key and session (director suggestion, moderator/speak, fact-check, claim extraction)
- Optional: Tavily (fact-check with search), YouTube Data API v3 (video search), ElevenLabs (TTS), OBS WebSocket (lower-third)

## Setup

1. **Clone and install**

   ```bash
   cd podcast-director
   npm install
   ```

2. **Environment**

   ```bash
   cp .env.example .env
   ```

   Edit `.env`:

   - `DISCORD_TOKEN` – bot token
   - `DISCORD_APPLICATION_ID` – app id (for slash command)
   - `DEEPGRAM_API_KEY` – Deepgram key
   - `MODDIT_API_KEY` – Moddit API key (required for all Moddit calls)
   - `MODDIT_API_URL`, `MODDIT_SESSION_ID` – director API (default `https://api.moddit.io` and `1234`)

3. **Optional: register slash command**

   ```bash
   node src/registerCommands.js
   ```

4. **Run**

   ```bash
   npm start
   ```

   In Discord, say **join** in a channel (or use **/join** if registered). The bot joins your voice channel, stays muted, and receives audio. Open the dashboard at **http://localhost:8765** (or `DASHBOARD_PORT`). Transcripts stream in the Conversation column; director suggestions and fact-checks appear as cards. Trigger phrases (e.g. “yeah”, “okay”, “go ahead”) or the Suggestions button also request director output.

## Dashboard

URL: `http://localhost:{DASHBOARD_PORT}` (default 8765).

- **Conversation** – Live log via SSE. Double-click an entry to edit speaker/text; Save updates in memory and rewrites the session log file. Refresh to reload.
- **Direction** – Director suggestion cards. Use the Suggestions button, slash command, or say a trigger phrase in voice.
- **Tools**
  - **Claims** – Extract claims from the conversation, then fact-check individual claims (Tavily optional).
  - **Video** – Search (YouTube API). Voice triggers: “pull (up) a video of/on X”, “(play) the latest video from X”. Results open in the video viewer; first result can auto-open.
  - **OBS** – Lower-third: set first/second line and trigger the browser source.
  - **Voice** dropdown – Choose voice for “Speak” and “Speak with search” (right-click selected text → Speak / Speak with search). Each voice can use a different Moddit mod for “speak as”.

## Video viewer

`/video-viewer.html?url=...` – Full-page iframe that embeds the given URL. YouTube and youtu.be URLs are rewritten to the embed form with autoplay; Twitch and other allowed hosts load as-is. The viewer subscribes to SSE; when the server sends `videoUrl` (e.g. on “pull video” or “latest video from”), the iframe updates without reload. All video links from the dashboard open in this viewer (or in an external browser if `OPEN_VIDEO_IN_BROWSER` is set).

## Voices and “speak as”

In config, `elevenlabs.voices` is a map: name → `voiceId` string or `{ voiceId, modId? }`. The optional `modId` is the Moddit mod used for “speak as” for that voice; when omitted, the default mod is `MODERATOR_MOD_ID` (env or built-in). The dashboard Voice dropdown and the speak endpoints use this map so you can have multiple voices with different Moddit personas.

## Config (.env)

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token (Discord Developer Portal) |
| `DISCORD_APPLICATION_ID` | App ID (for /join slash command) |
| `DISCORD_HOST_USER_ID` | Optional: host user ID for trigger phrases and auto-join |
| `DISCORD_AUTO_JOIN_HOST_CHANNEL` | Optional: true/1 to auto-join host’s voice channel |
| `MODDIT_API_KEY` | **Required** for Moddit API calls |
| `MODDIT_API_URL` | Base URL (e.g. `https://api.moddit.io`) |
| `MODDIT_SESSION_ID` | Session/path (e.g. `1234`) |
| `MODDIT_CONTEXT_MESSAGES` | Last N messages sent to director (default 20) |
| `MODDIT_SUGGESTION_INTERVAL_SEC` | Seconds between director calls (default 30) |
| `MODERATOR_MOD_ID` | Optional; default mod for moderator/speak when a voice has no `modId` |
| `DASHBOARD_PORT` | Dashboard HTTP port (default 8765) |
| `DEEPGRAM_API_KEY` | Deepgram API key |
| `DEEPGRAM_MIN_AUDIO_MS` | Ignore utterances shorter than this (default 500) |
| `CLAIM_EXTRACT_MIN_LINE_LENGTH` | Optional; run claim extraction when a log line is longer (0 = disabled) |
| `TAVILY_API_KEY` | Optional; Tavily for “Speak with search” / fact-check |
| `YOUTUBE_API_KEY` | Optional; YouTube Data API v3 for video search |
| `ELEVENLABS_API_KEY` | Optional; ElevenLabs TTS |
| `ELEVENLABS_VOICE_ID` | Optional; default voice ID |
| `FFMPEG_PATH` | Optional; path to ffmpeg if not on PATH |
| `OPEN_VIDEO_IN_BROWSER` | Optional; e.g. `firefox` to open video viewer in that browser |
| `OBS_WS_URL` | Optional; OBS WebSocket URL |
| `OBS_WS_PASSWORD` | Optional; OBS WebSocket password |
| `OBS_LOWER_THIRD_SOURCE_NAME` | Optional; browser source name (e.g. lower-third) |
| `OBS_LOWER_THIRD_BASE_URL` | Optional; chyron base URL |

## Moddit API

All Moddit requests use `MODDIT_API_KEY` in the body. See [src/modditClient.js](src/modditClient.js).

- **Director suggestion** – POST with conversation; returns suggestion text. Used for the director loop and dashboard Suggestions.
- **Moderator/speak** – POST with input text and mod id (from voice config or `MODERATOR_MOD_ID`); returns text to speak. TTS (ElevenLabs) plays it in the selected voice.
- **Fact-check** – POST with conversation; returns fact-check result.
- **Claim extraction** – POST with conversation; returns JSON array of claims (used for Claims tool).

## Project layout

- **Core**: [src/index.js](src/index.js) (Discord client, /join, voice receive, starts dashboard and director loop), [src/voiceHandler.js](src/voiceHandler.js), [src/transcribe.js](src/transcribe.js), [src/conversationLog.js](src/conversationLog.js) (in-memory log, session file, SRT, editable via `updateEntry`), [src/directorLoop.js](src/directorLoop.js), [src/config.js](src/config.js).
- **Moddit**: [src/modditClient.js](src/modditClient.js) (director suggestion, moderator response with optional modId, fact-check, claim extraction).
- **Dashboard**: [src/dashboard.js](src/dashboard.js) (HTTP server, SSE, routes for conversation, voices, speak, video search, open-in-browser, video-viewer.html).
- **TTS / search / OBS**: [src/ttsPlayer.js](src/ttsPlayer.js), [src/elevenlabsClient.js](src/elevenlabsClient.js), [src/searchClient.js](src/searchClient.js) (YouTube search, latest-from-channel), [src/obsClient.js](src/obsClient.js), [src/transcriptionState.js](src/transcriptionState.js), [src/soundboard.js](src/soundboard.js).
- **Public**: [public/index.html](public/index.html) (dashboard UI), [public/video-viewer.html](public/video-viewer.html) (embed iframe + SSE for videoUrl).
- **Slash**: [src/registerCommands.js](src/registerCommands.js).

