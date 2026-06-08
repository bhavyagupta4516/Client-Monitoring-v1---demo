'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/supabase');
const waha = require('../waha/client');
const logger = require('../logger');

/**
 * GET /api/onboard/debug
 * Shows raw WAHA state — use this to diagnose issues
 */
router.get('/debug', async (_req, res) => {
  const raw = await waha.getRawSession('default');
  const status = raw ? raw.status : 'NOT_FOUND';
  res.json({ status, raw });
});

/**
 * POST /api/onboard/register
 * Smart session management — never blindly deletes, handles every state.
 */
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email || !phone)
      return res.status(400).json({ error: 'name, email and phone required' });

    const sessionName = 'default';
    const csm = await db.createCSM({ name, email, phone, wahaSession: sessionName });
    const status = await waha.getSessionStatus(sessionName);

    logger.info({ email, status }, 'Register — WAHA session state');

    // Already authenticated — skip QR entirely
    if (status === 'WORKING') {
      return res.json({ csmId: csm.id, sessionName, alreadyConnected: true });
    }

    // QR is already on screen — just fetch it
    if (status === 'SCAN_QR_CODE') {
      const qrDataUrl = await waha.fetchQRBase64(sessionName, 5);
      return res.json({ csmId: csm.id, sessionName, qrDataUrl });
    }

    // Session exists but is stopped — just start it
    if (status === 'STOPPED') {
      await waha.startSession(sessionName);
      const qrDataUrl = await waha.fetchQRBase64(sessionName, 10);
      return res.json({ csmId: csm.id, sessionName, qrDataUrl });
    }

    // Session doesn't exist — create and start atomically
    if (status === 'NOT_FOUND') {
      await waha.createAndStartSession(sessionName);
      const qrDataUrl = await waha.fetchQRBase64(sessionName, 10);
      return res.json({ csmId: csm.id, sessionName, qrDataUrl });
    }

    // STARTING — wait for QR
    if (status === 'STARTING') {
      const qrDataUrl = await waha.fetchQRBase64(sessionName, 10);
      return res.json({ csmId: csm.id, sessionName, qrDataUrl });
    }

    // FAILED or unknown — restart
    await waha.restartSession(sessionName);
    const qrDataUrl = await waha.fetchQRBase64(sessionName, 10);
    return res.json({ csmId: csm.id, sessionName, qrDataUrl });

  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'register failed');
    return res.status(500).json({ error: err.message });
  }
});

router.get('/status/:sessionName', async (req, res) => {
  try {
    const status = await waha.getSessionStatus(req.params.sessionName);
    return res.json({ connected: status === 'WORKING', status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/qr/:sessionName', async (req, res) => {
  try {
    const qr = await waha.fetchQRBase64(req.params.sessionName, 3);
    return res.json({ qr: qr || null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/groups/:sessionName', async (req, res) => {
  try {
    // Retry up to 4 times — WAHA NOWEB needs a moment to sync chats after connect
    let groups = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      groups = await waha.getGroups(req.params.sessionName);
      if (groups.length > 0) break;
      if (attempt < 4) {
        logger.info({ attempt }, 'No groups yet — waiting 3s for WAHA sync');
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    return res.json(groups);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/groups', async (req, res) => {
  try {
    const { csmId, groups } = req.body;
    if (!csmId || !groups?.length)
      return res.status(400).json({ error: 'csmId and groups[] required' });
    await db.saveMonitoredGroups(csmId, groups);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/complete', async (req, res) => {
  try {
    const { csmId, slackUserId, managerSlackId, managerName } = req.body;
    if (!csmId || !slackUserId)
      return res.status(400).json({ error: 'csmId and slackUserId required' });
    await db.updateCSMSlack(csmId, { slackUserId, managerSlackId, managerName });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
