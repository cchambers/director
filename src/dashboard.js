/**
 * Simple HTTP server that serves the dashboard UI and streams director suggestions via SSE.
 * Suggestions are shown as cards; new ones are pushed in real time.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { port } = config.dashboard;

/** @type {Array<{ text: string, at: number }>} */
const recentSuggestions = [];
const MAX_SUGGESTIONS = 100;

/** SSE clients to broadcast new suggestions to */
const sseClients = new Set();

/**
 * Push a new suggestion to the dashboard (cards UI + SSE). Call from directorLoop when Moddit returns.
 * @param {string} text - Suggestion text from the director API
 */
export function pushSuggestion(text) {
  if (!text?.trim()) return;
  const entry = { text: text.trim(), at: Date.now() };
  recentSuggestions.push(entry);
  if (recentSuggestions.length > MAX_SUGGESTIONS) recentSuggestions.shift();
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
    recentSuggestions.forEach((entry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });
    req.on('close', () => sseClients.delete(res));
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
