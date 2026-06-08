'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/supabase');
const waha = require('../waha/client');
const logger = require('../logger');

router.post('/register', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'name, email, and phone are required' });
    }

    const sessionName = 'default';
    const csm = await db.createCSM({ name, email, phone, wahaSession: sessionName });

    // Check what state the existing session is in
    const currentStatus = await waha.getSessionStatus(sessionName);
    logger.info({ sessionName, currentStatus }, 'Session status on register');

    if (currentStatus === 'WORKING') {
      // Already connected — skip QR, go straight to group selection
      logger.info({ sessionName }, 'Session already WORKING — skipping QR');
      return res.json({ csmId: csm.id, sessionName, alreadyConnected: true });
    }

    // If session exists in a broken/stale state, wipe it and start fresh
    if (currentStatus !== 'STOPPED') {
      logger.info({ sessionName, currentStatus }, 'Wiping stale session');
      await waha.stopSession(sessionName);
      await new Promise(r => setTimeout(r, 2000)); // let WAHA clean up
    }

    // Create and start a clean session
    await waha.createSession(sessionName);
    await waha.startSession(sessionName);

    // Wait for WAHA to generate QR (up to 20s)
    const qrDataUrl = await waha.fetchQRBase64(sessionName, 10);

    logger.info({ email, hasQR: !!qrDataUrl, status: currentStatus }, 'CSM registered');
    return res.json({ csmId: csm.id, sessionName, qrDataUrl });

  } catch (err) {
    logger.error({ err: err.message }, 'register failed');
    return res.status(500).json({ error: err.message });
  }
});

router.get('/status/:sessionName', async (req, res) => {
  try {
    const status = await waha.getSessionStatus(req.params.sessionName);
    logger.info({ sessionName: req.params.sessionName, status }, 'status poll');
    return res.json({ connected: status === 'WORKING', status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/qr/:sessionName', async (req, res) => {
  try {
    const qrDataUrl = await waha.fetchQRBase64(req.params.sessionName, 3);
    return res.json({ qr: qrDataUrl || null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/groups/:sessionName', async (req, res) => {
  try {
    const groups = await waha.getGroups(req.params.sessionName);
    return res.json(groups);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

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
