/**
 * Topic tracker: in-memory current topic and history, with a text file for OBS.
 * When the topic changes, we append to history and rewrite the file.
 */

import fs from 'fs';
import path from 'path';

const LOG_DIR = 'logs';
const TOPIC_FILENAME = 'current-topic.txt';

/** @type {string} */
let currentTopic = '';

/** @type {Array<{ at: number, topic: string }>} */
const history = [];

function getTopicFilePath() {
  return path.join(LOG_DIR, TOPIC_FILENAME);
}

function writeTopicFile() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(getTopicFilePath(), currentTopic || '', 'utf8');
}

/**
 * @returns {string} Current topic (may be empty)
 */
export function getCurrentTopic() {
  return currentTopic;
}

/**
 * @returns {Array<{ at: number, topic: string }>} Timestamped topic shifts (oldest first)
 */
export function getHistory() {
  return [...history];
}

/**
 * Set the current topic (e.g. after mod returns a new topic). Appends to history and writes file.
 * @param {string} topic - New topic text
 * @param {number} [at] - Timestamp for this shift (default now); use when injecting into conversation log so times match
 */
export function setTopic(topic, at) {
  const trimmed = (topic ?? '').trim();
  if (!trimmed) return;
  const now = at ?? Date.now();
  currentTopic = trimmed;
  history.push({ at: now, topic: trimmed });
  writeTopicFile();
}

/**
 * Path to the topic file (for OBS or dashboard).
 * @returns {string}
 */
export function getTopicFilePathForOBS() {
  return getTopicFilePath();
}
