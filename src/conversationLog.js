/**
 * In-memory conversation log with speaker labels.
 * Appends transcript lines and provides recent context for the director API.
 */

import { config } from './config.js';

const { contextMessages } = config.moddit;

/** @type {Array<{ speaker: string, text: string, timestamp: number }>} */
const log = [];

/**
 * @param {string} speaker - Display name or ID
 * @param {string} text - Transcribed text (trimmed)
 */
export function append(speaker, text) {
  const trimmed = text?.trim();
  if (!trimmed) return;
  log.push({
    speaker,
    text: trimmed,
    timestamp: Date.now(),
  });
  console.log(`[${speaker}] ${trimmed}`);
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
