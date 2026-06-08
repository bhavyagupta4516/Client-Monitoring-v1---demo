'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/supabase');
const waha = require('../waha/client');
const logger = require('../logger');

// Step 1 — Register CSM and create WAHA session
// POST /api/onboard/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'name, email, and phone are required' });
    }

    // Build a safe session name from email prefix
    const sessionName = 'default'; // WAHA Core free tier only supports 'default' session

    // Create CSM record in DB
    const csm = await db.createCSM({ name, email, phone, wahaSession: sessionName });

    // Create and start WAHA session
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

// Step 2 — Poll for QR code / connection status
// GET /api/onboard/qr/:sessionName
router.get('/qr/:sessionName', async (req, res) => {
  try {
    const { sessionName } = req.params;
    const status = await waha.getSessionStatus(sessionName);

    if (status === 'WORKING') {
      return res.json({ status: 'connected' });
    }

    if (status === 'SCAN_QR_CODE') {
      const qr = await waha.getQRCode(sessionName);
      if (qr) return res.json({ status: 'qr_ready', qr });
      return res.json({ status: 'loading' }); // QR not rendered yet
    }

    return res.json({ status: status.toLowerCase() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Step 3 — List WhatsApp groups for CSM to choose
// GET /api/onboard/groups/:sessionName
router.get('/groups/:sessionName', async (req, res) => {
  try {
    const groups = await waha.getGroups(req.params.sessionName);
    return res.json(groups);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Step 3b — Save selected groups
// POST /api/onboard/groups
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

// Step 4 — Save Slack details and complete setup
// POST /api/onboard/complete
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
