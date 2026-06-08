'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/supabase');
const waha = require('../waha/client');
const logger = require('../logger');

/**
 * POST /api/onboard/register
 * Creates the CSM, starts WAHA session, waits for QR, returns it as base64.
 * Frontend gets everything it needs in one response — no QR polling required.
 */
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'name, email, and phone are required' });
    }

    const sessionName = 'default';

    // Upsert CSM — safe to call multiple times
    const csm = await db.createCSM({ name, email, phone, wahaSession: sessionName });

    // Start WAHA session (both calls are idempotent)
    await waha.createSession(sessionName);
    await waha.startSession(sessionName);

    // Wait up to 20s for WAHA to generate the QR code
    const qrDataUrl = await waha.fetchQRBase64(sessionName, 10);

    if (!qrDataUrl) {
      logger.warn({ sessionName }, 'QR not ready after 20s — returning without it');
    }

    logger.info({ email, hasQR: !!qrDataUrl }, 'CSM registered');
    return res.json({ csmId: csm.id, sessionName, qrDataUrl });

  } catch (err) {
    logger.error({ err: err.message }, 'register failed');
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/onboard/status/:sessionName
 * Lightweight poll — just checks if WhatsApp is connected yet.
 */
router.get('/status/:sessionName', async (req, res) => {
  try {
    const status = await waha.getSessionStatus(req.params.sessionName);
    logger.info({ sessionName: req.params.sessionName, status }, 'status poll');
    return res.json({ connected: status === 'WORKING', status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/onboard/qr/:sessionName
 * Refresh the QR image (called every 50s since QR expires in 60s).
 */
router.get('/qr/:sessionName', async (req, res) => {
  try {
    const qrDataUrl = await waha.fetchQRBase64(req.params.sessionName, 3);
    if (!qrDataUrl) return res.json({ qr: null });
    return res.json({ qr: qrDataUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/onboard/groups/:sessionName
 */
router.get('/groups/:sessionName', async (req, res) => {
  try {
    const groups = await waha.getGroups(req.params.sessionName);
    return res.json(groups);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/onboard/groups
 */
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

/**
 * POST /api/onboard/complete
 */
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
