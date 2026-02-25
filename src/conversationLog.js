/**
 * In-memory conversation log with speaker labels.
 * Appends transcript lines and provides recent context for the director API.
 * Optionally writes each line to a session log file (one file per /join).
 */

import fs from 'fs';
import path from 'path';
import { config } from './config.js';

const { contextMessages } = config.moddit;

/** @type {Array<{ speaker: string, text: string, timestamp: number, userId?: string }>} */
const log = [];

/** Buffer sent to Moddit for director suggestions; cleared after each successful suggestion so next send only has new messages. */
const directorBuffer = [];

/** Secondary buffer for claim extraction. Appended to with main log; cleared after extraction. */
const claimBuffer = [];

/** Listeners called when a new entry is appended (e.g. for SSE broadcast). Receive { speaker, text, timestamp }. */
const logAppendListeners = [];

/** Current session log file path; set when startSessionLog() is called. */
let sessionLogPath = null;
/** Current session SRT caption file path. */
let sessionCaptionPath = null;
/** Session start time (ms) for caption timestamps. */
let sessionStartMs = 0;
/** End time (ms from session start) of last caption written, for SRT continuity. */
let lastCaptionEndMs = 0;

/** Format ms since session start as SRT timestamp HH:MM:SS,mmm */
function msToSrt(ms) {
  const h = Math.floor(ms / 3600000);
  ms %= 3600000;
  const m = Math.floor(ms / 60000);
  ms %= 60000;
  const s = Math.floor(ms / 1000);
  const frac = ms % 1000;
  const pad = (n) => String(n).padStart(2, '0');
  const pad3 = (n) => String(n).padStart(3, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad3(frac)}`;
}

/**
 * Start a new session log file and SRT caption file. Call when the bot joins voice so each run has a unique file.
 * @param {string} [logDir='logs'] - Directory for log files
 * @returns {{ logPath: string, captionPath: string }} Paths to the new log and caption files
 */
export function startSessionLog(logDir = 'logs') {
  log.length = 0;
  directorBuffer.length = 0;
  claimBuffer.length = 0;
  fs.mkdirSync(logDir, { recursive: true });
  sessionStartMs = Date.now();
  lastCaptionEndMs = 0;
  const safeDate = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = `conversation-${safeDate}`;
  sessionLogPath = path.join(logDir, `${base}.log`);
  sessionCaptionPath = path.join(logDir, `${base}.srt`);
  const header = `Session started ${new Date().toISOString()}\n`;
  fs.appendFileSync(sessionLogPath, header, 'utf8');
  return { logPath: sessionLogPath, captionPath: sessionCaptionPath };
}

/**
 * @param {string} speaker - Display name or ID
 * @param {string} text - Transcribed text (trimmed)
 * @param {{ userId?: string }} [opts] - Optional userId for host/guest detection
 */
export function append(speaker, text, opts = {}) {
  const trimmed = text?.trim();
  // #region agent log
  const lower = trimmed.toLowerCase();
  if (lower.includes('video') && lower.includes('pull')) {
    fetch('http://127.0.0.1:7633/ingest/31b29ecb-377e-4b01-bcb2-5ab262f9a2f4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ef08e6'},body:JSON.stringify({sessionId:'ef08e6',location:'conversationLog.js:append',message:'Transcript contains pull+video',data:{textPreview:trimmed.slice(0,120),length:trimmed.length},timestamp:Date.now(),hypothesisId:'H2'})}).catch(()=>{});
  }
  // #endregion
  if (!trimmed) return;
  const now = Date.now();
  const entry = { speaker, text: trimmed, timestamp: now, userId: opts.userId };
  log.push(entry);
  directorBuffer.push(entry);
  claimBuffer.push({ speaker, text: trimmed, timestamp: now, userId: opts.userId });
  console.log(`[${speaker}] ${trimmed}`);
  logAppendListeners.forEach((fn) => {
    try {
      fn(entry);
    } catch (err) {
      console.warn('[Conversation log] append listener error:', err.message);
    }
  });
  if (sessionLogPath) {
    const line = `${speaker}: ${trimmed}\n`; //[${new Date(now).toISOString()}] 
    fs.appendFile(sessionLogPath, line, 'utf8', (err) => {
      if (err) console.warn('[Conversation log file]', err.message);
    });
  }
  if (sessionCaptionPath) {
    const endMs = Math.max(0, now - sessionStartMs);
    const startMs = lastCaptionEndMs;
    const endMsClamped = endMs <= startMs ? startMs + 1000 : endMs;
    const index = log.length;
    const startStr = msToSrt(startMs);
    const endStr = msToSrt(endMsClamped);
    const captionText = `${speaker}: ${trimmed}`.replace(/\n/g, ' ');
    const block = `${index}\n${startStr} --> ${endStr}\n${captionText}\n\n`;
    fs.appendFile(sessionCaptionPath, block, 'utf8', (err) => {
      if (err) console.warn('[Caption file]', err.message);
    });
    lastCaptionEndMs = endMsClamped;
  }
}

/** Clear only the director buffer (call after sending to Moddit; next suggestion gets only new messages). */
export function reset() {
  directorBuffer.length = 0;
}

/** Last log entry, or null. Used to check if last speaker was host vs guest. */
export function getLastEntry() {
  return log.length ? log[log.length - 1] : null;
}

/**
 * Returns the last N messages for the director API (from the director buffer, cleared after each suggestion).
 * @returns {Array<{ speaker: string, text: string, timestamp?: string }>}
 */
export function getRecentForDirector() {
  const recent = directorBuffer.slice(-contextMessages);
  return recent.map(({ speaker, text, timestamp }) => ({
    speaker,
    text,
    timestamp: new Date(timestamp).toISOString(),
  }));
}

/** Returns recent messages from the claim buffer (same shape as getRecentForDirector). */
export function getRecentForClaimExtraction() {
  const recent = claimBuffer.slice(-contextMessages);
  return recent.map(({ speaker, text, timestamp }) => ({
    speaker,
    text,
    timestamp: new Date(timestamp).toISOString(),
  }));
}

/** Clear the claim buffer after extraction so next run only sees new conversation. */
export function resetClaimBuffer() {
  claimBuffer.length = 0;
}

export function getLog() {
  return [...log];
}

/**
 * Register a callback to run when a new log entry is appended. Used by dashboard to broadcast over SSE.
 * @param {(entry: { speaker: string, text: string, timestamp: number }) => void} fn
 */
export function onLogAppend(fn) {
  if (typeof fn === 'function') logAppendListeners.push(fn);
}
