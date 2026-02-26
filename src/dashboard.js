/**
 * Simple HTTP server that serves the dashboard UI and streams director suggestions + fact-checks via SSE.
 * Suggestions and fact-checks are shown as cards; new ones are pushed in real time.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, normalizeVoiceEntry } from './config.js';

const { elevenlabs } = config;
const defaultModId = config.moderatorModId;

function getVoicesList() {
  const raw = elevenlabs?.voices && typeof elevenlabs.voices === 'object' ? elevenlabs.voices : {};
  return Object.entries(raw).map(([name, val]) => {
    const { voiceId, modId } = normalizeVoiceEntry(val, defaultModId);
    return { name, id: name, voiceId, modId };
  });
}

function resolveVoice(voiceName) {
  if (!voiceName || typeof voiceName !== 'string') return null;
  const raw = elevenlabs?.voices && typeof elevenlabs.voices === 'object' ? elevenlabs.voices : {};
  const val = raw[voiceName.trim()];
  if (val === undefined) return null;
  return normalizeVoiceEntry(val, defaultModId);
}
import { getRecentForDirector, getRecentForClaimExtraction, resetClaimBuffer, reset as resetDirectorBuffer, getLog, onLogAppend, updateEntry, appendTopicEntry, append } from './conversationLog.js';
import { getFactCheck, getClaimExtraction, getFactCheckClaim, getDirectorSuggestion, getModeratorResponse, getTopicUpdate } from './modditClient.js';
import { getSearchContext, getVideoSearchResults, getLatestVideoFromChannel } from './searchClient.js';
import { speak as ttsSpeak, playLocalMp3 } from './ttsPlayer.js';
import { showLowerThird } from './obsClient.js';
import { getCurrentTopic, setTopic, getHistory } from './topicTracker.js';
import { getTranscriptionState, setLiveTranscriptionEnabled } from './transcriptionState.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { port } = config.dashboard;

const ONE_MOMENT_MP3 = 'src/responses/one-moment.mp3';

/** Max recent log entries to send as context with "Speak with moderator". */
const SPEAK_LOG_LIMIT = 10;

/** Format recent conversation log for moderator context. */
function getConversationContextForSpeak() {
  const entries = getLog().slice(-SPEAK_LOG_LIMIT);
  if (entries.length === 0) return '';
  return entries.map((e) => `[${e.speaker}] ${e.text}`).join('\n');
}

/** @type {Array<{ type: 'suggestion'|'factcheck', text: string, at: number }>} */
const recentItems = [];
const MAX_ITEMS = 100;

/** SSE clients to broadcast to */
const sseClients = new Set();

/**
 * Push a new suggestion to the dashboard (cards UI + SSE). Call from directorLoop when Moddit returns.
 * @param {string} text - Suggestion text from the director API
 */
export function pushSuggestion(text) {
  if (!text?.trim()) return;
  const entry = { type: 'suggestion', text: text.trim(), at: Date.now() };
  recentItems.push(entry);
  if (recentItems.length > MAX_ITEMS) recentItems.shift();
  broadcast(entry);
}

/**
 * Push a fact-check result to the dashboard (cards UI + SSE).
 * @param {string} text - Fact-check result text
 */
export function pushFactCheck(text) {
  if (!text?.trim()) return;
  const entry = { type: 'factcheck', text: text.trim(), at: Date.now() };
  recentItems.push(entry);
  if (recentItems.length > MAX_ITEMS) recentItems.shift();
  broadcast(entry);
}

function broadcast(entry) {
  const payload = JSON.stringify(entry);
  sseClients.forEach((res) => {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (_) {}
  });
}

const VIDEO_OPEN_ALLOWED_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
  'vimeo.com', 'www.vimeo.com', 'player.vimeo.com',
  'dailymotion.com', 'www.dailymotion.com',
  'twitch.tv', 'www.twitch.tv', 'player.twitch.tv',
]);

/** In-memory video queue; next URL is broadcast when viewer calls POST /video/ended. */
const videoQueue = [];

/** Currently playing (or last loaded) video URL; cleared on stop. */
let currentVideoUrl = null;

const LOG_DIR = path.join(__dirname, '..', 'logs');
const VIDEO_QUEUE_FILENAME = 'video-queue.txt';

function writeVideoQueueFile() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const lines = [];
    lines.push(currentVideoUrl ? `Now: ${currentVideoUrl}` : 'Now: —');
    videoQueue.forEach((u) => lines.push(`Up next: ${u}`));
    fs.writeFileSync(path.join(LOG_DIR, VIDEO_QUEUE_FILENAME), lines.join('\n'), 'utf8');
  } catch (_) {}
}

function broadcastVideoQueue() {
  broadcast({ type: 'videoQueue', current: currentVideoUrl, queue: [...videoQueue] });
}

/**
 * Load a video URL in the dashboard viewer (broadcasts videoUrl over SSE). Call from Discord /video or dashboard UI.
 * @param {string} url - Full URL (e.g. https://youtu.be/xxx)
 */
export function loadVideoUrl(url) {
  const u = (url ?? '').trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) return;
  try {
    const parsed = new URL(u);
    if (!VIDEO_OPEN_ALLOWED_HOSTS.has(parsed.hostname)) return;
    currentVideoUrl = u;
    broadcast({ type: 'videoUrl', url: u });
    writeVideoQueueFile();
    broadcastVideoQueue();
  } catch (_) {}
}

function isAllowedVideoUrl(u) {
  try {
    const parsed = new URL(u);
    return VIDEO_OPEN_ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Last topic we ran video search for (debounce same topic within 60s). */
let lastVideoTopic = '';
let lastVideoTopicAt = 0;
const PULL_VIDEO_DEBOUNCE_MS = 60000;
/** Match "pull (up) a video(s) of/on X" — only in the current message so we don't trigger on follow-ups like "mhmm". */
const PULL_VIDEO_REGEX = /pull\s+(?:up\s+)?a\s+video?s?\s+(?:of|on|by|with)\s+(.+)/i;
/** Match "play the latest video from X" / "latest video from X". */
const LATEST_VIDEO_FROM_REGEX = /(?:play\s+)?(?:the\s+)?latest\s+video\s+from\s+(.+)/i;
/** Debounce for "latest video from" (same channel within 60s). */
let lastLatestVideoChannel = '';
let lastLatestVideoChannelAt = 0;

/** Topic tracker: only run when log has new content since last check. */
let lastTopicCheckLogLength = 0;
let topicCheckInProgress = false;

onLogAppend((entry) => {
  broadcast({ type: 'logEntry', entry: { speaker: entry.speaker, text: entry.text, timestamp: entry.timestamp } });
  const pullVideoMatch = entry.text.match(PULL_VIDEO_REGEX);
  if (pullVideoMatch) {
    const topic = pullVideoMatch[1].trim().replace(/\s*\.\.\.?\s*$/, '').slice(0, 200);
    if (!topic) return;
    const now = Date.now();
    if (topic === lastVideoTopic && now - lastVideoTopicAt <= PULL_VIDEO_DEBOUNCE_MS) return;
    lastVideoTopic = topic;
    lastVideoTopicAt = now;
    playLocalMp3(ONE_MOMENT_MP3);
    getVideoSearchResults(topic).then((results) => {
      if (results && results.length > 0) {
        broadcast({ type: 'videoResults', results });
        if (results[0].url) broadcast({ type: 'videoUrl', url: results[0].url });
      }
    }).catch(() => {});
    return;
  }
  const latestFromMatch = entry.text.match(LATEST_VIDEO_FROM_REGEX);
  if (latestFromMatch) {
    const channelName = latestFromMatch[1].trim().replace(/\s*\.\.\.?\s*$/, '').slice(0, 200);
    if (!channelName) return;
    const now = Date.now();
    if (channelName === lastLatestVideoChannel && now - lastLatestVideoChannelAt <= PULL_VIDEO_DEBOUNCE_MS) return;
    lastLatestVideoChannel = channelName;
    lastLatestVideoChannelAt = now;
    playLocalMp3(ONE_MOMENT_MP3);
    getLatestVideoFromChannel(channelName).then((results) => {
      if (results && results.length > 0) {
        broadcast({ type: 'videoResults', results });
        if (results[0].url) broadcast({ type: 'videoUrl', url: results[0].url });
      }
    }).catch(() => {});
    return;
  }
  const minLen = config.claims?.autoExtractMinLineLength ?? 0;
  if (minLen > 0 && entry.text.length > minLen) {
    const messages = getRecentForClaimExtraction();
    if (messages.length > 0) {
      getClaimExtraction(messages).then(({ claims, error }) => {
        if (error) return;
        const list = claims ?? [];
        if (list.length > 0) {
          broadcast({ type: 'claims', claims: list });
          resetClaimBuffer();
        }
      }).catch(() => {});
    }
  }
});

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  if (url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    sseClients.add(res);
    recentItems.forEach((entry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (url === '/suggest' && req.method === 'POST') {
    const messages = getRecentForDirector();
    if (messages.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No conversation yet.' }));
      return;
    }
    getDirectorSuggestion(messages).then(({ suggestion, error }) => {
      if (error) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ suggestion: null, error }));
        return;
      }
      resetDirectorBuffer();
      if (suggestion) pushSuggestion(suggestion);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ suggestion: suggestion ?? null }));
    });
    return;
  }
  if (url === '/fc' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const messages = getRecentForDirector();
      if (messages.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No conversation yet to fact-check.' }));
        return;
      }
      getFactCheck(messages).then(({ result, error }) => {
        if (result) pushFactCheck(result);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: result ?? null, error: error ?? null }));
      });
    });
    return;
  }
  if (url === '/factcheck/claim' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      const claim = typeof payload.claim === 'string' ? payload.claim.trim() : '';
      if (!claim) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing claim' }));
        return;
      }
      const withSearch = !!payload.withSearch;
      getFactCheckClaim(claim, { withSearch }).then(({ result, verdict, error }) => {
        if (result) pushFactCheck(result);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: result ?? null, verdict: verdict ?? null, error: error ?? null }));
      });
    });
    return;
  }
  if (url === '/claims/extract' && req.method === 'POST') {
    const messages = getRecentForClaimExtraction();
    if (messages.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ claims: [], error: 'No conversation yet.' }));
      return;
    }
    getClaimExtraction(messages).then(({ claims, error }) => {
      resetClaimBuffer();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ claims: claims ?? [], error: error ?? null }));
    });
    return;
  }
  if (url === '/claims/check' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      const claim = payload.claim;
      if (!claim || typeof claim !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing claim' }));
        return;
      }
      const withSearch = !!payload.withSearch;
      getFactCheckClaim(claim.trim(), { withSearch }).then(({ result, verdict, error, sources }) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: result ?? null, verdict: verdict ?? null, error: error ?? null, sources: sources ?? [] }));
      });
    });
    return;
  }
  if (url === '/conversation' && req.method === 'GET') {
    const entries = getLog();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ entries }));
    return;
  }
  if (url === '/conversation' && req.method === 'PATCH') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      const index = typeof payload.index === 'number' ? payload.index : parseInt(payload.index, 10);
      if (Number.isNaN(index)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid index' }));
        return;
      }
      const patch = {};
      if (payload.speaker !== undefined) patch.speaker = payload.speaker;
      if (payload.text !== undefined) patch.text = payload.text;
      const result = updateEntry(index, patch);
      if (result.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ entry: result.entry }));
    });
    return;
  }
  if (url === '/voices' && req.method === 'GET') {
    const voices = getVoicesList();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ voices }));
    return;
  }
  if (url === '/topic' && req.method === 'GET') {
    const topic = getCurrentTopic();
    const history = getHistory();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ topic, history }));
    return;
  }
  if (url === '/topic' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      const topic = typeof payload.topic === 'string' ? payload.topic.trim() : '';
      if (!topic) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing topic' }));
        return;
      }
      const at = Date.now();
      appendTopicEntry(at, topic);
      setTopic(topic, at);
      broadcast({ type: 'topic', topic, at, history: getHistory() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ topic, history: getHistory() }));
    });
    return;
  }
  if (url === '/moderator/speak' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      const voiceName = typeof payload.voice === 'string' ? payload.voice.trim() : null;
      const entry = resolveVoice(voiceName);
      const voiceId = entry?.voiceId ?? null;
      const modId = entry?.modId ?? null;
      const conversationBlock = getConversationContextForSpeak();
      const inputWithLog = conversationBlock
        ? `Recent conversation:\n${conversationBlock}\n\nUser selection: ${text || 'No context provided.'}`
        : (text || 'No context provided.');
      getModeratorResponse(inputWithLog, { modId }).then(({ response, error }) => {
        if (error) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ response: null, error }));
          return;
        }
        if (response) {
          append('AI', response);
          ttsSpeak(response, { voiceId: voiceId || undefined }).catch((err) => console.warn('[TTS]', err.message));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: response ?? null }));
      });
    });
    return;
  }
  if (url === '/moderator/speak-with-search' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      const voiceName = typeof payload.voice === 'string' ? payload.voice.trim() : null;
      const entry = resolveVoice(voiceName);
      const voiceId = entry?.voiceId ?? null;
      const modId = entry?.modId ?? null;
      const input = text || 'No context provided.';
      const { contextText, sources } = await getSearchContext(input);
      const enrichedInput = contextText
        ? `${input}\n\nSearch context:\n${contextText}`
        : input;
      const conversationBlock = getConversationContextForSpeak();
      const inputWithLog = conversationBlock
        ? `Recent conversation:\n${conversationBlock}\n\nUser selection (with search):\n${enrichedInput}`
        : enrichedInput;
      getModeratorResponse(inputWithLog, { modId }).then(({ response, error }) => {
        if (error) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ response: null, error, sources: sources ?? [] }));
          return;
        }
        if (response) {
          append('AI', response);
          ttsSpeak(response, { voiceId: voiceId || undefined }).catch((err) => console.warn('[TTS]', err.message));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: response ?? null, sources: sources ?? [] }));
      });
    });
    return;
  }
  if (url === '/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      openVideoInBrowser: config.dashboard.openVideoInBrowser || null,
    }));
    return;
  }
  if (url === '/open-in-browser' && req.method === 'POST') {
    const browser = config.dashboard.openVideoInBrowser;
    if (!browser?.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OPEN_VIDEO_IN_BROWSER not set' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      const rawUrl = typeof payload.url === 'string' ? payload.url.trim() : '';
      let parsed;
      try {
        parsed = new URL(rawUrl);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid URL' }));
        return;
      }
      const hostAllowed = VIDEO_OPEN_ALLOWED_HOSTS.has(parsed.hostname) ||
        (parsed.hostname === 'localhost' && parsed.pathname === '/video-viewer.html');
      if (!hostAllowed) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'URL not in allowed video hosts' }));
        return;
      }
      try {
        const open = (await import('open')).default;
        await open(rawUrl, { app: { name: browser.trim() } });
        res.writeHead(204);
        res.end();
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Failed to open in browser' }));
      }
    });
    return;
  }
  if (url === '/transcription-enabled') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getTranscriptionState()));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let payload;
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        const enabled = payload.enabled !== false;
        setLiveTranscriptionEnabled(enabled);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ enabled }));
      });
      return;
    }
  }
  if (url === '/lower-third' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        return;
      }
      const first = typeof payload.first === 'string' ? payload.first.trim() : '';
      const second = typeof payload.second === 'string' ? payload.second.trim() : '';
      const result = await showLowerThird(first, second);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }
  if (url === '/video/load' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      const urlsArray = Array.isArray(payload.urls)
        ? payload.urls.map((u) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean)
        : [];
      const singleUrl = typeof payload.url === 'string' ? payload.url.trim() : '';

      if (urlsArray.length > 0) {
        videoQueue.length = 0;
        const valid = urlsArray.filter((u) => isAllowedVideoUrl(u));
        if (valid.length === 0) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No URLs in allowed video hosts (YouTube, Vimeo, Twitch, Dailymotion)' }));
          return;
        }
        const first = valid.shift();
        valid.forEach((u) => videoQueue.push(u));
        loadVideoUrl(first);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, url: first, queueLength: videoQueue.length }));
        return;
      }
      if (singleUrl) {
        if (!isAllowedVideoUrl(singleUrl)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'URL not in allowed video hosts (YouTube, Vimeo, Twitch, Dailymotion)' }));
          return;
        }
        videoQueue.length = 0;
        loadVideoUrl(singleUrl);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, url: singleUrl }));
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url or urls' }));
    });
    return;
  }
  if (url === '/video/ended' && req.method === 'POST') {
    const next = videoQueue.shift();
    if (next) {
      loadVideoUrl(next);
    } else {
      currentVideoUrl = null;
      writeVideoQueueFile();
      broadcastVideoQueue();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, next: next ?? null, queueLength: videoQueue.length }));
    return;
  }
  if (url === '/video/queue' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ current: currentVideoUrl, queue: [...videoQueue] }));
    return;
  }
  if (url === '/video/next' && req.method === 'POST') {
    const next = videoQueue.shift();
    if (next) {
      loadVideoUrl(next);
    } else {
      currentVideoUrl = null;
      writeVideoQueueFile();
      broadcastVideoQueue();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, next: next ?? null, queueLength: videoQueue.length }));
    return;
  }
  if (url === '/video/play' && req.method === 'POST') {
    if (currentVideoUrl) {
      broadcast({ type: 'videoUrl', url: currentVideoUrl });
      writeVideoQueueFile();
      broadcastVideoQueue();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, url: currentVideoUrl }));
      return;
    }
    if (videoQueue.length > 0) {
      const first = videoQueue.shift();
      loadVideoUrl(first);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, url: first, queueLength: videoQueue.length }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Nothing to play' }));
    return;
  }
  if (url === '/video/stop' && req.method === 'POST') {
    currentVideoUrl = null;
    broadcast({ type: 'videoStop' });
    writeVideoQueueFile();
    broadcastVideoQueue();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url === '/video/search' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON', results: [] }));
        return;
      }
      const query = typeof payload.query === 'string' ? payload.query.trim() : '';
      const results = await getVideoSearchResults(query);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results }));
    });
    return;
  }
  if (url === '/index.html' || url === '/') {
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
    serveFile(res, htmlPath, 'text/html');
    return;
  }
  if (url.startsWith('/video-viewer.html')) {
    const htmlPath = path.join(__dirname, '..', 'public', 'video-viewer.html');
    serveFile(res, htmlPath, 'text/html');
    return;
  }
  res.writeHead(404);
  res.end();
});

/**
 * Start the dashboard server. Call once when the bot is ready.
 */
export function startDashboard() {
  server.listen(port, '0.0.0.0', () => {
    console.log(`Dashboard: http://localhost:${port}`);
    if (config.dashboard.openOnStart) {
      const url = `http://localhost:${port}`;
      import('open').then(({ default: open }) => open(url)).catch((err) => console.warn('[Dashboard] Could not open in browser:', err.message));
    }
    const topicCfg = config.topic;
    if (topicCfg?.enabled !== false && topicCfg?.intervalSec > 0) {
      const intervalMs = topicCfg.intervalSec * 1000;
      const contextMessages = config.moddit?.contextMessages ?? 20;
      const minNewMessages = Math.max(0, topicCfg.minNewMessages ?? 5);
      setInterval(() => {
        if (topicCheckInProgress) return;
        const entries = getLog();
        if (entries.length < 2) return;
        const newSinceLast = entries.length - lastTopicCheckLogLength;
        if (newSinceLast < minNewMessages) return;
        lastTopicCheckLogLength = entries.length;
        topicCheckInProgress = true;
        const recent = entries.slice(-contextMessages);
        const conversationLog = recent.map((e) => `[${e.speaker}] ${e.text}`).join('\n');
        const previousTopic = getCurrentTopic();
        getTopicUpdate(previousTopic, conversationLog).then(({ topic: newTopic, error }) => {
          topicCheckInProgress = false;
          if (error) return;
          if (newTopic && newTopic !== previousTopic) {
            const at = Date.now();
            appendTopicEntry(at, newTopic);
            setTopic(newTopic, at);
            broadcast({ type: 'topic', topic: newTopic, at, history: getHistory() });
          }
        }).catch(() => { topicCheckInProgress = false; });
      }, intervalMs);
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Dashboard port ${port} in use; UI unavailable. Set DASHBOARD_PORT in .env.`);
    } else {
      console.warn('Dashboard error:', err.message);
    }
  });
}
