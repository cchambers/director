/**
 * Simple HTTP server that serves the dashboard UI and streams director suggestions + fact-checks via SSE.
 * Suggestions and fact-checks are shown as cards; new ones are pushed in real time.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { getRecentForDirector } from './conversationLog.js';
import { getFactCheck } from './modditClient.js';

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
