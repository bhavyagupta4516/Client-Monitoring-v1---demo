'use strict';
const axios = require('axios');
const logger = require('../logger');

const waha = axios.create({
  baseURL: process.env.WAHA_BASE_URL,
  headers: { 'X-Api-Key': process.env.WAHA_API_KEY },
  timeout: 15000
});

async function createSession(sessionName) {
  try {
    await waha.post('/api/sessions', {
      name: sessionName,
      config: { noweb: { store: { enabled: true, fullSync: false } } }
    });
    logger.info({ sessionName }, 'WAHA session created');
  } catch (err) {
    if (err.response?.status === 422) {
      logger.info({ sessionName }, 'WAHA session already exists');
      return;
    }
    throw new Error(`createSession: ${err.response?.data?.message || err.message}`);
  }
}

async function startSession(sessionName) {
  try {
    await waha.post(`/api/sessions/${sessionName}/start`);
    logger.info({ sessionName }, 'WAHA session started');
  } catch (err) {
    const msg = err.response?.data?.message || err.message || '';
    if (msg.toLowerCase().includes('already started') || err.response?.status === 422) {
      logger.info({ sessionName }, 'WAHA session already running');
      return;
    }
    throw new Error(`startSession: ${msg}`);
  }
}

async function getSessionStatus(sessionName) {
  try {
    const { data } = await waha.get(`/api/sessions/${sessionName}`);
    return data.status; // STOPPED | STARTING | SCAN_QR_CODE | WORKING | FAILED
  } catch (err) {
    if (err.response?.status === 404) return 'STOPPED';
    throw new Error(`getSessionStatus: ${err.message}`);
  }
}

// Fetch QR as base64 PNG — retries up to maxAttempts times waiting for WAHA to be ready
async function fetchQRBase64(sessionName, maxAttempts = 10) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const { data } = await waha.get(`/api/${sessionName}/auth/qr`, {
        params: { format: 'image' },
        responseType: 'arraybuffer'
      });
      if (data && data.byteLength > 500) {
        logger.info({ sessionName, attempt: i }, 'QR fetched as binary image');
        return `data:image/png;base64,${Buffer.from(data).toString('base64')}`;
      }
    } catch (e1) {
      // binary failed — try JSON format
      try {
        const { data } = await waha.get(`/api/${sessionName}/auth/qr`);
        if (data?.value) {
          logger.info({ sessionName, attempt: i }, 'QR fetched as JSON value');
          const val = data.value;
          return val.startsWith('data:') ? val : `data:image/png;base64,${val}`;
        }
      } catch (e2) { /* not ready yet */ }
    }

    if (i < maxAttempts) {
      logger.info({ sessionName, attempt: i }, 'QR not ready — waiting 2s');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

async function getGroups(sessionName) {
  try {
    const { data } = await waha.get(`/api/${sessionName}/chats`, {
      params: { limit: 200, offset: 0 }
    });
    return data
      .filter(chat => chat.id && chat.id.endsWith('@g.us'))
      .map(chat => ({ group_jid: chat.id, group_name: chat.name || chat.id }))
      .sort((a, b) => a.group_name.localeCompare(b.group_name));
  } catch (err) {
    throw new Error(`getGroups: ${err.response?.data?.message || err.message}`);
  }
}

async function stopSession(sessionName) {
  try {
    await waha.post(`/api/sessions/${sessionName}/stop`);
    await waha.delete(`/api/sessions/${sessionName}`);
  } catch (err) {
    logger.warn({ sessionName, err: err.message }, 'stopSession error');
  }
}

module.exports = {
  createSession, startSession, getSessionStatus,
  fetchQRBase64, getGroups, stopSession
};
