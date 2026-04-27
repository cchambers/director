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

/** Current session title (if set). Used for display and for optional header in log file. */
let currentSessionTitle = null;
/** Current session slug (basename without extension). Used for filenames and video log path. */
let currentSessionSlug = null;

/**
 * Derive a filesystem-safe slug from a title. Lowercase, replace spaces/special with -, collapse dashes, trim.
 * @param {string} title - Human-readable session title
 * @returns {string | null} Slug or null if title is empty/falsy
 */
export function titleToSlug(title) {
  if (title == null || typeof title !== 'string') return null;
  const t = title.trim();
  if (!t) return null;
  const slug = t
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || null;
}

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
 * Start a new session log file and SRT caption file, or resume an existing one if the same title/slug exists.
 * Call when the bot joins voice.
 * @param {string} [logDir='logs'] - Directory for log files
 * @param {{ title?: string }} [options] - Optional session title; if provided and logs/<slug>.log exists, that session is loaded (resume).
 * @returns {{ logPath: string, captionPath: string, slug: string, resumed?: boolean }} Paths and slug; resumed true if existing session was loaded
 */
export function startSessionLog(logDir = 'logs', options = {}) {
  const title = typeof options.title === 'string' ? options.title.trim() : null;
  fs.mkdirSync(logDir, { recursive: true });

  if (title) {
    const slug = titleToSlug(title);
    if (slug) {
      const existingLogPath = path.join(logDir, `${slug}.log`);
      if (fs.existsSync(existingLogPath)) {
        loadSessionLog(logDir, slug);
        currentSessionTitle = title;
        currentSessionSlug = slug;
        return { logPath: sessionLogPath, captionPath: sessionCaptionPath, slug, resumed: true };
      }
    }
  }

  log.length = 0;
  directorBuffer.length = 0;
  claimBuffer.length = 0;
  sessionStartMs = Date.now();
  lastCaptionEndMs = 0;
  currentSessionTitle = title || null;

  let base;
  if (title) {
    const slug = titleToSlug(title);
    base = slug || `conversation-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  } else {
    const safeDate = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    base = `conversation-${safeDate}`;
  }
  currentSessionSlug = base;
  sessionLogPath = path.join(logDir, `${base}.log`);
  sessionCaptionPath = path.join(logDir, `${base}.srt`);
  const header = `Session started ${new Date().toISOString()}\n`;
  fs.appendFileSync(sessionLogPath, header, 'utf8');
  return { logPath: sessionLogPath, captionPath: sessionCaptionPath, slug: base, resumed: false };
}

/**
 * Load an existing session from disk by slug. Populates in-memory log and sets session paths so new appends go to the same files.
 * @param {string} logDir - Directory containing the .log file
 * @param {string} slug - Session slug (filename without .log)
 * @returns {{ logPath: string, captionPath: string } | { error: string }} Paths on success, or error if file not found/invalid
 */
export function loadSessionLog(logDir, slug) {
  const logPath = path.join(logDir, `${slug}.log`);
  if (!fs.existsSync(logPath)) {
    return { error: 'Session log not found' };
  }
  const captionPath = path.join(logDir, `${slug}.srt`);
  let content;
  try {
    content = fs.readFileSync(logPath, 'utf8');
  } catch (err) {
    return { error: err.message || 'Failed to read log file' };
  }
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  const headerMatch = lines[0] && lines[0].match(/^Session started (.+)$/);
  if (headerMatch) {
    try {
      sessionStartMs = new Date(headerMatch[1].trim()).getTime();
    } catch (_) {
      sessionStartMs = Date.now();
    }
  } else {
    sessionStartMs = Date.now();
  }

  log.length = 0;
  directorBuffer.length = 0;
  claimBuffer.length = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const idx = line.indexOf(': ');
    if (idx === -1) continue;
    const speaker = line.slice(0, idx).trim();
    const text = line.slice(idx + 2).trim();
    const timestamp = sessionStartMs + (i - 1) * 1000;
    const entry = { speaker, text, timestamp };
    log.push(entry);
    directorBuffer.push(entry);
    claimBuffer.push(entry);
  }

  lastCaptionEndMs = 0;
  if (fs.existsSync(captionPath)) {
    try {
      const srtContent = fs.readFileSync(captionPath, 'utf8');
      const blocks = srtContent.split(/\n\n+/);
      for (let b = blocks.length - 1; b >= 0; b--) {
        const block = blocks[b];
        const timeMatch = block.match(/\d+\n(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
        if (timeMatch) {
          lastCaptionEndMs = srtTimeToMs(timeMatch[2]);
          break;
        }
      }
    } catch (_) {}
  }

  sessionLogPath = logPath;
  sessionCaptionPath = captionPath;
  currentSessionSlug = slug;
  return { logPath, captionPath };
}

/**
 * Return current session info for dashboard and video log path.
 * @returns {{ slug: string | null, logPath: string | null, captionPath: string | null, title: string | null, startedAt: number } | null}
 */
export function getCurrentSession() {
  if (!sessionLogPath) return null;
  return {
    slug: currentSessionSlug,
    logPath: sessionLogPath,
    captionPath: sessionCaptionPath,
    title: currentSessionTitle,
    startedAt: sessionStartMs,
  };
}

/**
 * Set the display title for the current session (e.g. from dashboard). Does not change slug or filenames.
 * @param {string | null} title - Display title or null to clear
 */
export function setCurrentSessionTitle(title) {
  currentSessionTitle = typeof title === 'string' ? title.trim() || null : null;
}

/** Parse SRT timestamp "HH:MM:SS,mmm" to ms from zero. */
function srtTimeToMs(s) {
  const [time, frac] = s.split(',');
  const [h, m, sec] = time.split(':').map(Number);
  const ms = (frac !== undefined ? parseInt(frac, 10) : 0);
  return (h * 3600 + m * 60 + sec) * 1000 + ms;
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

/** Format ms (Date.now()) as local time HH:MM:SS for topic log lines. */
function formatTimeLocal(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Append a topic shift to the conversation log (and session .log file). Not added to director/claim buffers.
 * @param {number} at - Timestamp (e.g. Date.now())
 * @param {string} topic - Topic text
 */
export function appendTopicEntry(at, topic) {
  const trimmed = (topic ?? '').trim();
  if (!trimmed) return;
  const timeStr = formatTimeLocal(at);
  const text = `${timeStr} — ${trimmed}`;
  const entry = { speaker: 'Topic', text, timestamp: at };
  log.push(entry);
  logAppendListeners.forEach((fn) => {
    try {
      fn(entry);
    } catch (err) {
      console.warn('[Conversation log] append listener error:', err.message);
    }
  });
  if (sessionLogPath) {
    const line = `Topic: ${text}\n`;
    fs.appendFile(sessionLogPath, line, 'utf8', (err) => {
      if (err) console.warn('[Conversation log file]', err.message);
    });
  }
}

/**
 * Rewrite the session .log file with current log contents (used after an edit).
 * Writes header + one line per entry: "speaker: text\n".
 */
function rewriteSessionLogFile() {
  if (!sessionLogPath) return;
  const header = `Session started ${new Date(sessionStartMs).toISOString()}\n`;
  const body = log.map((e) => `${e.speaker}: ${e.text}\n`).join('');
  try {
    fs.writeFileSync(sessionLogPath, header + body, 'utf8');
  } catch (err) {
    console.warn('[Conversation log file] rewrite failed:', err.message);
  }
}

/**
 * Update a single log entry by index. Also updates director and claim buffers and rewrites the session .log file.
 * @param {number} index - Zero-based index into the log
 * @param {{ speaker?: string, text?: string }} patch - Fields to update (trimmed; omit to leave unchanged)
 * @returns {{ entry: { speaker, text, timestamp } } | { error: string }}
 */
export function updateEntry(index, patch) {
  if (index < 0 || index >= log.length) return { error: 'Invalid index' };
  const entry = log[index];
  if (patch.speaker !== undefined) entry.speaker = String(patch.speaker).trim() || entry.speaker;
  if (patch.text !== undefined) entry.text = String(patch.text).trim() || entry.text;
  if (claimBuffer[index]) {
    claimBuffer[index].speaker = entry.speaker;
    claimBuffer[index].text = entry.text;
  }
  /* directorBuffer holds same object refs as log, so entry is already updated */
  rewriteSessionLogFile();
  return { entry: { speaker: entry.speaker, text: entry.text, timestamp: entry.timestamp } };
}

/**
 * Remove a single log entry by index. Updates director and claim buffers and rewrites the session .log file.
 * @param {number} index - Zero-based index into the log
 * @returns {{ removed: true } | { error: string }}
 */
export function removeEntry(index) {
  if (index < 0 || index >= log.length) return { error: 'Invalid index' };
  log.splice(index, 1);
  claimBuffer.splice(index, 1);
  directorBuffer.length = 0;
  log.forEach((e) => directorBuffer.push(e));
  rewriteSessionLogFile();
  return { removed: true };
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

/**
 * Exclude join/part (Voice) and AI response lines from messages before fact-check or claim extraction.
 * @param {Array<{ speaker: string, text: string, timestamp?: string }>} messages
 * @returns {Array<{ speaker: string, text: string, timestamp?: string }>}
 */
export function filterMessagesForFactCheck(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.filter((m) => m?.speaker !== 'Voice' && m?.speaker !== 'AI');
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
