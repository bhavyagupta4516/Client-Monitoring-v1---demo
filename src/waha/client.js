'use strict';
const axios = require('axios');
const logger = require('../logger');

function wahaClient() {
  return axios.create({
    baseURL: process.env.WAHA_BASE_URL,
    headers: { 'X-Api-Key': process.env.WAHA_API_KEY },
    timeout: 15000
  });
}

// Get raw session object from WAHA — returns null if not found
async function getRawSession(sessionName) {
  try {
    const { data } = await wahaClient().get(`/api/sessions/${sessionName}`);
    return data;
  } catch (err) {
    if (err.response?.status === 404) return null;
    logger.warn({ err: err.response?.data || err.message }, 'getRawSession error');
    return null;
  }
}

// Returns: NOT_FOUND | STOPPED | STARTING | SCAN_QR_CODE | WORKING | FAILED
async function getSessionStatus(sessionName) {
  const session = await getRawSession(sessionName);
  const status = session ? (session.status || 'UNKNOWN') : 'NOT_FOUND';
  logger.info({ sessionName, status, raw: session }, 'getSessionStatus');
  return status;
}

// Create session — pass start:true so WAHA starts it atomically (no race condition)
async function createAndStartSession(sessionName) {
  const client = wahaClient();
  try {
    await client.post('/api/sessions', {
      name: sessionName,
      start: true,
      config: { noweb: { store: { enabled: true, fullSync: false } } }
    });
    logger.info({ sessionName }, 'Session created+started');
  } catch (err) {
    if (err.response?.status === 422) {
      // Session already exists — just start it
      logger.info({ sessionName }, 'Session exists — starting');
      await startSession(sessionName);
      return;
    }
    throw new Error(`createAndStartSession: ${err.response?.data?.message || err.message}`);
  }
}

async function startSession(sessionName) {
  try {
    await wahaClient().post(`/api/sessions/${sessionName}/start`);
    logger.info({ sessionName }, 'Session started');
  } catch (err) {
    const msg = err.response?.data?.message || err.message || '';
    if (msg.toLowerCase().includes('already started') || err.response?.status === 422) {
      logger.info({ sessionName }, 'Already started — OK');
      return;
    }
    throw new Error(`startSession: ${msg}`);
  }
}

async function restartSession(sessionName) {
  try {
    await wahaClient().post(`/api/sessions/${sessionName}/restart`);
    logger.info({ sessionName }, 'Session restarted');
  } catch (err) {
    // restart endpoint may not exist — fallback to stop+start
    logger.warn({ err: err.message }, 'restart failed — trying stop+start');
    try { await wahaClient().post(`/api/sessions/${sessionName}/stop`); } catch(_) {}
    await new Promise(r => setTimeout(r, 2000));
    await startSession(sessionName);
  }
}

// Fetch QR as base64 — retries every 2s up to maxAttempts times
async function fetchQRBase64(sessionName, maxAttempts = 10) {
  const client = wahaClient();
  for (let i = 1; i <= maxAttempts; i++) {
    // Try binary PNG
    try {
      const { data } = await client.get(`/api/${sessionName}/auth/qr`, {
        params: { format: 'image' }, responseType: 'arraybuffer'
      });
      if (data && data.byteLength > 500) {
        logger.info({ sessionName, attempt: i }, 'QR fetched (binary)');
        return `data:image/png;base64,${Buffer.from(data).toString('base64')}`;
      }
    } catch (_) {}

    // Try JSON value
    try {
      const { data } = await client.get(`/api/${sessionName}/auth/qr`);
      if (data?.value) {
        logger.info({ sessionName, attempt: i }, 'QR fetched (JSON)');
        return data.value.startsWith('data:') ? data.value : `data:image/png;base64,${data.value}`;
      }
    } catch (_) {}

    if (i < maxAttempts) {
      logger.info({ attempt: i }, 'QR not ready — waiting 2s');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  logger.warn({ sessionName }, 'QR not available after all attempts');
  return null;
}

async function getGroups(sessionName) {
  try {
    const { data } = await wahaClient().get(`/api/${sessionName}/chats`, {
      params: { limit: 200, offset: 0 }
    });
    return data
      .filter(c => c.id?.endsWith('@g.us'))
      .map(c => ({ group_jid: c.id, group_name: c.name || c.id }))
      .sort((a, b) => a.group_name.localeCompare(b.group_name));
  } catch (err) {
    throw new Error(`getGroups: ${err.response?.data?.message || err.message}`);
  }
}

module.exports = {
  getRawSession, getSessionStatus,
  createAndStartSession, startSession, restartSession,
  fetchQRBase64, getGroups
};
