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
      logger.info({ sessionName }, 'WAHA session already exists — continuing');
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
    logger.info({ sessionName, status: data.status }, 'WAHA session status');
    return data.status;
  } catch (err) {
    if (err.response?.status === 404) return 'STOPPED';
    throw new Error(`getSessionStatus: ${err.message}`);
  }
}

// Returns a direct WAHA URL the browser can use as an <img src>
// WAHA accepts the API key as a ?key= query param so no auth header needed
function getQRCodeUrl(sessionName) {
  const base = process.env.WAHA_BASE_URL;
  const key  = process.env.WAHA_API_KEY;
  return `${base}/api/${sessionName}/auth/qr?format=image&key=${key}`;
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
    logger.info({ sessionName }, 'WAHA session stopped');
  } catch (err) {
    logger.warn({ sessionName, err: err.message }, 'stopSession error (may be OK)');
  }
}

module.exports = {
  createSession, startSession, getSessionStatus,
  getQRCodeUrl, getGroups, stopSession
};
