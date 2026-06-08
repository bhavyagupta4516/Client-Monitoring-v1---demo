'use strict';
const axios = require('axios');
const logger = require('../logger');

const waha = axios.create({
  baseURL: process.env.WAHA_BASE_URL,
  headers: { 'X-Api-Key': process.env.WAHA_API_KEY },
  timeout: 15000
});

// Create a new session in WAHA
async function createSession(sessionName) {
  try {
    await waha.post('/api/sessions', {
      name: sessionName,
      config: {
        noweb: { store: { enabled: true, fullSync: false } }
      }
    });
    logger.info({ sessionName }, 'WAHA session created');
  } catch (err) {
    if (err.response?.status === 422) {
      logger.info({ sessionName }, 'WAHA session already exists — continuing');
      return;
    }
    throw new Error(`createSession: ${err.response?.data?.message || err.message}`);
  }
}

// Start the session (triggers QR generation)
async function startSession(sessionName) {
  try {
    await waha.post(`/api/sessions/${sessionName}/start`);
    logger.info({ sessionName }, 'WAHA session started');
  } catch (err) {
    const msg = err.response?.data?.message || err.message || '';
    // If session is already running, that is fine — just continue
    if (msg.toLowerCase().includes('already started') || err.response?.status === 422) {
      logger.info({ sessionName }, 'WAHA session already running — continuing');
      return;
    }
    throw new Error(`startSession: ${msg}`);
  }
}

// Returns: STOPPED | STARTING | SCAN_QR_CODE | WORKING | FAILED
async function getSessionStatus(sessionName) {
  try {
    const { data } = await waha.get(`/api/sessions/${sessionName}`);
    return data.status;
  } catch (err) {
    if (err.response?.status === 404) return 'STOPPED';
    throw new Error(`getSessionStatus: ${err.message}`);
  }
}

// Returns a base64 PNG data URI, or null if QR isn't ready yet
async function getQRCode(sessionName) {
  try {
    const { data } = await waha.get(`/api/${sessionName}/auth/qr`, {
      params: { format: 'image' },
      responseType: 'arraybuffer'
    });
    return `data:image/png;base64,${Buffer.from(data).toString('base64')}`;
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 422) return null;
    logger.warn({ sessionName, err: err.message }, 'getQRCode failed');
    return null;
  }
}

// Returns array of { group_jid, group_name }
async function getGroups(sessionName) {
  try {
    const { data } = await waha.get(`/api/${sessionName}/chats`, {
      params: { limit: 200, offset: 0 }
    });
    return data
      .filter(chat => chat.id && chat.id.endsWith('@g.us'))
      .map(chat => ({
        group_jid: chat.id,
        group_name: chat.name || chat.id
      }))
      .sort((a, b) => a.group_name.localeCompare(b.group_name));
  } catch (err) {
    throw new Error(`getGroups: ${err.response?.data?.message || err.message}`);
  }
}

// Configure the webhook for a session
async function setWebhook(sessionName, webhookUrl) {
  try {
    await waha.put(`/api/sessions/${sessionName}`, {
      config: {
        webhooks: [{
          url: webhookUrl,
          events: ['message', 'session.status'],
          retries: { delaySeconds: 2, attempts: 3 }
        }]
      }
    });
    logger.info({ sessionName, webhookUrl }, 'WAHA webhook configured');
  } catch (err) {
    throw new Error(`setWebhook: ${err.response?.data?.message || err.message}`);
  }
}

// Stop and delete a session
async function stopSession(sessionName) {
  try {
    await waha.post(`/api/sessions/${sessionName}/stop`);
    await waha.delete(`/api/sessions/${sessionName}`);
    logger.info({ sessionName }, 'WAHA session stopped');
  } catch (err) {
    logger.warn({ sessionName, err: err.message }, 'stopSession error (may be OK if already stopped)');
  }
}

module.exports = {
  createSession, startSession, getSessionStatus,
  getQRCode, getGroups, setWebhook, stopSession
};
