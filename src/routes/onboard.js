'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/supabase');
const waha = require('../waha/client');
const logger = require('../logger');

/**
 * POST /api/onboard/register
 *
 * State machine for WAHA session:
 *   WORKING       → already connected, skip QR
 *   SCAN_QR_CODE  → QR already generated, just fetch it (no wipe needed)
 *   STARTING      → wait for QR to appear
 *   STOPPED       → create + start fresh
 *   FAILED/other  → delete + recreate + start
 */
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'name, email, and phone are required' });
    }

    const sessionName = 'default';
    const csm = await db.createCSM({ name, email, phone, wahaSession: sessionName });

    const status = await waha.getSessionStatus(sessionName);
    logger.info({ sessionName, status }, 'Session state on register');

    // ── Already connected ────────────────────────────────────────────────────
    if (status === 'WORKING') {
      logger.info('Session WORKING — skipping QR');
      return res.json({ csmId: csm.id, sessionName, alreadyConnected: true });
    }

    // ── QR already on screen — just fetch it ────────────────────────────────
    if (status === 'SCAN_QR_CODE') {
      logger.info('Session SCAN_QR_CODE — fetching existing QR');
      const qrDataUrl = await waha.fetchQRBase64(sessionName, 5);
      return res.json({ csmId: csm.id, sessionName, qrDataUrl });
    }

    // ── Still starting — wait for QR ────────────────────────────────────────
    if (status === 'STARTING') {
      logger.info('Session STARTING — waiting for QR');
      const qrDataUrl = await waha.fetchQRBase64(sessionName, 10);
      return res.json({ csmId: csm.id, sessionName, qrDataUrl });
    }

    // ── Session is STOPPED — create and start fresh ──────────────────────────
    if (status === 'STOPPED') {
      logger.info('Session STOPPED — creating fresh');
      await waha.createSession(sessionName);
      await waha.startSession(sessionName);
      const qrDataUrl = await waha.fetchQRBase64(sessionName, 10);
      return res.json({ csmId: csm.id, sessionName, qrDataUrl });
    }

    // ── FAILED or unknown — delete and recreate ──────────────────────────────
    logger.info({ status }, 'Session in bad state — deleting and recreating');
    await waha.deleteSession(sessionName);
    await new Promise(r => setTimeout(r, 3000)); // wait for WAHA to clean up
    await waha.createSession(sessionName);
    await waha.startSession(sessionName);
    const qrDataUrl = await waha.fetchQRBase64(sessionName, 10);
    return res.json({ csmId: csm.id, sessionName, qrDataUrl });

  } catch (err) {
    logger.error({ err: err.message }, 'register failed');
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
