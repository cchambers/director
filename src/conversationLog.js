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
  if (!trimmed) return;
  const now = Date.now();
  log.push({
    speaker,
    text: trimmed,
    timestamp: now,
    userId: opts.userId,
  });
  console.log(`[${speaker}] ${trimmed}`);
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

/** Clear the log (call after sending to Moddit; Moddit manages history). */
export function reset() {
  log.length = 0;
}

/** Last log entry, or null. Used to check if last speaker was host vs guest. */
export function getLastEntry() {
  return log.length ? log[log.length - 1] : null;
}

/**
 * Returns the last N messages for the director API.
 * @returns {Array<{ speaker: string, text: string, timestamp?: string }>}
 */
export function getRecentForDirector() {
  const recent = log.slice(-contextMessages);
  return recent.map(({ speaker, text, timestamp }) => ({
    speaker,
    text,
    timestamp: new Date(timestamp).toISOString(),
  }));
}

export function getLog() {
  return [...log];
}
