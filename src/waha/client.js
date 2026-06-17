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

// Create a new session in WAHA (does NOT start it — onboard.js calls startSession separately)
async function createSession(sessionName) {
  try {
    await wahaClient().post('/api/sessions', {
      name: sessionName,
      config: { noweb: { store: { enabled: true, fullSync: true } } }
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

async function startSession(sessionName) {
  try {
    await wahaClient().post(`/api/sessions/${sessionName}/start`);
    logger.info({ sessionName }, 'WAHA session started');
  } catch (err) {
    const msg = err.response?.data?.message || err.message || '';
    if (msg.toLowerCase().includes('already started') || err.response?.status === 422) {
      logger.info({ sessionName }, 'Already started — OK');
      return;
    }
    throw new Error(`startSession: ${msg}`);
  }
}

async function getSessionStatus(sessionName) {
  try {
    const { data } = await wahaClient().get(`/api/sessions/${sessionName}`);
    return data?.status || 'UNKNOWN';
  } catch (err) {
    if (err.response?.status === 404) return 'NOT_FOUND';
    logger.warn({ sessionName, err: err.message }, 'getSessionStatus error');
    return 'UNKNOWN';
  }
}

async function getQRCode(sessionName) {
  try {
    const { data } = await wahaClient().get(`/api/${sessionName}/auth/qr`, {
      params: { format: 'image' },
      responseType: 'arraybuffer'
    });
    if (data && data.byteLength > 500) {
      return `data:image/png;base64,${Buffer.from(data).toString('base64')}`;
    }
    return null;
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 422) return null;
    logger.warn({ sessionName, err: err.message }, 'getQRCode failed');
    return null;
  }
}

async function setWebhook(sessionName, webhookUrl) {
  try {
    await wahaClient().put(`/api/sessions/${sessionName}`, {
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

async function stopSession(sessionName) {
  try {
    await wahaClient().post(`/api/sessions/${sessionName}/stop`);
    await wahaClient().delete(`/api/sessions/${sessionName}`);
    logger.info({ sessionName }, 'WAHA session stopped');
  } catch (err) {
    logger.warn({ sessionName, err: err.message }, 'stopSession error (may be OK if already stopped)');
  }
}

module.exports = {
  createSession, startSession, getSessionStatus,
  getQRCode, setWebhook, getGroups, stopSession
};
