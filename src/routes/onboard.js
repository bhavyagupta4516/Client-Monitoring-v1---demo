'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/supabase');
const waha = require('../waha/client');
const logger = require('../logger');

// Step 1 — Register CSM and create WAHA session
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'name, email, and phone are required' });
    }

    const sessionName = 'default'; // WAHA Core free tier only supports 'default' session

    const csm = await db.createCSM({ name, email, phone, wahaSession: sessionName });
    await waha.createSession(sessionName);
    await waha.startSession(sessionName);

    // Webhook is configured globally via WHATSAPP_HOOK_URL env var on WAHA service

    logger.info({ email, sessionName }, 'CSM registered');
    return res.json({ csmId: csm.id, sessionName });
  } catch (err) {
    logger.error({ err: err.message }, 'register failed');
    return res.status(500).json({ error: err.message });
  }
});

// Step 2 — Poll session status + return QR URL for browser to load directly
router.get('/qr/:sessionName', async (req, res) => {
  try {
    const { sessionName } = req.params;
    const status = await waha.getSessionStatus(sessionName);
    logger.info({ sessionName, status }, 'QR poll');

    if (status === 'WORKING') {
      return res.json({ status: 'connected' });
    }

    if (status === 'SCAN_QR_CODE' || status === 'STARTING') {
      // Return a direct URL — the browser fetches the QR image straight from WAHA
      const qrUrl = waha.getQRCodeUrl(sessionName);
      return res.json({ status: 'qr_ready', qr: qrUrl });
    }

    logger.info({ sessionName, status }, 'QR poll — unexpected status');
    return res.json({ status: status ? status.toLowerCase() : 'loading' });
  } catch (err) {
    logger.error({ err: err.message }, 'QR poll error');
    return res.status(500).json({ error: err.message });
  }
});

// Step 3 — List WhatsApp groups
router.get('/groups/:sessionName', async (req, res) => {
  try {
    const groups = await waha.getGroups(req.params.sessionName);
    return res.json(groups);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Step 3b — Save selected groups
router.post('/groups', async (req, res) => {
  try {
    const { csmId, groups } = req.body;
    if (!csmId || !groups?.length) {
      return res.status(400).json({ error: 'csmId and groups[] are required' });
    }
    await db.saveMonitoredGroups(csmId, groups);
    return res.json({ ok: true, saved: groups.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Step 4 — Save Slack details
router.post('/complete', async (req, res) => {
  try {
    const { csmId, slackUserId, managerSlackId, managerName } = req.body;
    if (!csmId || !slackUserId) {
      return res.status(400).json({ error: 'csmId and slackUserId are required' });
    }
    await db.updateCSMSlack(csmId, { slackUserId, managerSlackId, managerName });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
