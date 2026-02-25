/**
 * OBS WebSocket client for lower-third control.
 * Updates the browser source URL (first & second params) and shows the source.
 * Requires OBS_WS_URL and OBS_WS_PASSWORD in config.
 */

import OBSWebSocket from 'obs-websocket-js';
import { config } from './config.js';

const { obs } = config;
const LOWER_THIRD_HIDE_AFTER_MS = 8000;
let obsInstance = null;
let connected = false;
let hideLowerThirdTimeout = null;

function getObs() {
  if (!obs?.wsUrl?.trim()) return null;
  if (!obsInstance) obsInstance = new OBSWebSocket();
  return obsInstance;
}

/**
 * Connect to OBS WebSocket. Call once at startup or before first use.
 * @returns {Promise<boolean>} true if connected
 */
export async function connectObs() {
  const client = getObs();
  if (!client) return false;
  if (connected) return true;
  try {
    const url = obs.wsUrl.trim().replace(/^http/, 'ws');
    await client.connect(url, obs.password?.trim() || undefined);
    connected = true;
    console.log('[OBS] Connected');
    return true;
  } catch (err) {
    console.warn('[OBS] Connect failed:', err.message);
    return false;
  }
}

/**
 * Find the scene and sceneItemId that contain the given source name.
 * @param {string} sourceName
 * @returns {Promise<{ sceneName: string, sceneItemId: number } | null>}
 */
async function findSceneItemForSource(sourceName) {
  const client = getObs();
  if (!client || !connected) return null;
  const { scenes } = await client.call('GetSceneList');
  const sceneList = Array.isArray(scenes) ? scenes : [];
  for (const scene of sceneList) {
    const sceneName = scene.sceneName ?? scene.name;
    if (!sceneName) continue;
    const { sceneItems } = await client.call('GetSceneItemList', { sceneName });
    const item = sceneItems.find((i) => (i.sourceName || i.inputName) === sourceName);
    if (item) return { sceneName, sceneItemId: item.sceneItemId ?? item.sceneItemIndex };
  }
  return null;
}

/**
 * Hide the lower-third source (set scene item enabled to false).
 * @param {string} sourceName
 */
async function hideLowerThirdSource(sourceName) {
  const client = getObs();
  if (!client || !connected) return;
  try {
    const found = await findSceneItemForSource(sourceName);
    if (found) {
      await client.call('SetSceneItemEnabled', {
        sceneName: found.sceneName,
        sceneItemId: found.sceneItemId,
        sceneItemEnabled: false,
      });
    }
  } catch (err) {
    console.warn('[OBS] hideLowerThird failed:', err.message);
  }
}

/**
 * Set the lower-third browser source URL and make it visible.
 * @param {string} first - First line (e.g. "Captain Khi")
 * @param {string} second - Second line (e.g. "Here to save the day")
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function showLowerThird(first, second) {
  const client = getObs();
  if (!client) return { ok: false, error: 'OBS not configured (OBS_WS_URL)' };
  if (!connected) {
    const ok = await connectObs();
    if (!ok) return { ok: false, error: 'Could not connect to OBS' };
  }
  const baseUrl = (obs.lowerThirdBaseUrl || '').trim() || 'https://cdpn.io/pen/debug/mKbQGa/e70d51e92a36ff6eddedd781368ae604';
  const name = (obs.lowerThirdSourceName || 'lower-third').trim() || 'lower-third';
  const sep = baseUrl.includes('?') ? '&' : '?';
  const url = `${baseUrl}${sep}first=${encodeURIComponent(String(first || ''))}&second=${encodeURIComponent(String(second || ''))}`;
  try {
    await client.call('SetInputSettings', {
      inputName: name,
      inputSettings: { url },
    });
    const found = await findSceneItemForSource(name);
    if (found) {
      await client.call('SetSceneItemEnabled', {
        sceneName: found.sceneName,
        sceneItemId: found.sceneItemId,
        sceneItemEnabled: true,
      });
      if (hideLowerThirdTimeout) clearTimeout(hideLowerThirdTimeout);
      hideLowerThirdTimeout = setTimeout(() => {
        hideLowerThirdTimeout = null;
        hideLowerThirdSource(name);
      }, LOWER_THIRD_HIDE_AFTER_MS);
    }
    return { ok: true };
  } catch (err) {
    console.warn('[OBS] showLowerThird failed:', err.message);
    if (err.code === 'ConnectionClosed' || err.message?.includes('connect')) connected = false;
    return { ok: false, error: err.message || String(err) };
  }
}
