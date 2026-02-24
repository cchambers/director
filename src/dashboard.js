/**
 * Simple HTTP server that serves the dashboard UI and streams director suggestions + fact-checks via SSE.
 * Suggestions and fact-checks are shown as cards; new ones are pushed in real time.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const { elevenlabs } = config;
import { getRecentForDirector, getRecentForClaimExtraction, resetClaimBuffer, reset as resetDirectorBuffer, getLog, onLogAppend } from './conversationLog.js';
import { getFactCheck, getClaimExtraction, getFactCheckClaim, getDirectorSuggestion, getModeratorResponse } from './modditClient.js';
import { getSearchContext } from './searchClient.js';
import { speak as ttsSpeak } from './ttsPlayer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { port } = config.dashboard;

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

onLogAppend((entry) => {
  broadcast({ type: 'logEntry', entry: { speaker: entry.speaker, text: entry.text, timestamp: entry.timestamp } });
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
  if (url === '/voices' && req.method === 'GET') {
    const voices = elevenlabs?.voices && typeof elevenlabs.voices === 'object'
      ? Object.entries(elevenlabs.voices).map(([name, id]) => ({ name, id }))
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ voices }));
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
      const voiceId = typeof payload.voiceId === 'string' ? payload.voiceId.trim() : null;
      const allowedIds = elevenlabs?.voices && typeof elevenlabs.voices === 'object'
        ? new Set(Object.values(elevenlabs.voices))
        : new Set();
      const safeVoiceId = (voiceId && allowedIds.has(voiceId)) ? voiceId : null;
      getModeratorResponse(text || 'No context provided.').then(({ response, error }) => {
        if (error) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ response: null, error }));
          return;
        }
        if (response) ttsSpeak(response, { voiceId: safeVoiceId || undefined }).catch((err) => console.warn('[TTS]', err.message));
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
      const voiceId = typeof payload.voiceId === 'string' ? payload.voiceId.trim() : null;
      const allowedIds = elevenlabs?.voices && typeof elevenlabs.voices === 'object'
        ? new Set(Object.values(elevenlabs.voices))
        : new Set();
      const safeVoiceId = (voiceId && allowedIds.has(voiceId)) ? voiceId : null;
      const input = text || 'No context provided.';
      const { contextText, sources } = await getSearchContext(input);
      const enrichedInput = contextText
        ? `${input}\n\nSearch context:\n${contextText}`
        : input;
      getModeratorResponse(enrichedInput).then(({ response, error }) => {
        if (error) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ response: null, error, sources: sources ?? [] }));
          return;
        }
        if (response) ttsSpeak(response, { voiceId: safeVoiceId || undefined }).catch((err) => console.warn('[TTS]', err.message));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: response ?? null, sources: sources ?? [] }));
      });
    });
    return;
  }
  if (url === '/index.html' || url === '/') {
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
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
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Dashboard port ${port} in use; UI unavailable. Set DASHBOARD_PORT in .env.`);
    } else {
      console.warn('Dashboard error:', err.message);
    }
  });
}
