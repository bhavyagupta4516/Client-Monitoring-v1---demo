'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/supabase');
const classifier = require('../classifier/keyword');
const slack = require('../slack/notifier');
const logger = require('../logger');

/**
 * POST /webhooks/waha
 * WAHA fires this for every WhatsApp event.
 * We respond 200 immediately — processing happens async so WAHA doesn't retry.
 */
router.post('/waha', (req, res) => {
  res.status(200).json({ ok: true }); // respond first
  handleEvent(req.body).catch(err =>
    logger.error({ err: err.message }, 'Unhandled webhook error')
  );
});

async function handleEvent({ event, session, payload }) {
  if (!event || !session) return;

  // ── Session status ──────────────────────────────────────────────────────────
  if (event === 'session.status') {
    const status = payload?.status;
    logger.info({ session, status }, 'WA session status');

    const dbStatus = status === 'WORKING' ? 'connected' : 'disconnected';
    await db.updateCSMStatus(session, dbStatus);

    if (status === 'FAILED' || status === 'STOPPED') {
      const csm = await db.getCSMBySession(session);
      if (csm?.slack_user_id) {
        const reconnectUrl = `${process.env.APP_URL}/reconnect/${csm.id}`;
        await slack.alertSessionDisconnected(csm, reconnectUrl);
      }
    }
    return;
  }

  // ── Incoming message ────────────────────────────────────────────────────────
  if (event === 'message') {
    const msg = payload;
    if (!msg) return;

    // If the CSM sent this message, check if it's a reply to a pending client message
    if (msg.fromMe) {
      if (msg.quotedMsgId || msg.replyTo?.id) {
        const quotedId = msg.quotedMsgId || msg.replyTo.id;
        await db.markMessageAnswered(quotedId);
        logger.info({ quotedId, session }, 'CSM replied — thread marked answered');
      }
      return;
    }

    // Only care about group messages (JID ends in @g.us)
    const groupJid = msg.to || msg.from;
    if (!groupJid?.endsWith('@g.us')) return;

    // Find the CSM who owns this session
    const csm = await db.getCSMBySession(session);
    if (!csm) {
      logger.warn({ session }, 'No CSM found for session — ignoring message');
      return;
    }

    // Skip if this group isn't being monitored
    const monitored = await db.isGroupMonitored(csm.id, groupJid);
    if (!monitored) return;

    // Skip empty/media-only messages
    const body = (msg.body || '').trim();
    if (!body) return;

    // Classify
    const classification = classifier.classify(body);

    // Skip pure acknowledgements — no action needed
    if (classifier.isAcknowledgement(classification)) {
      logger.info({ session, group: groupJid }, 'Acknowledgement — skipped');
      return;
    }

    // Determine group name from payload (WAHA may include chat name)
    const groupName = msg.chatName || msg._data?.pushName || groupJid;
    const senderPhone = msg.participant || msg.from || 'unknown';
    const senderName = msg._data?.notifyName || null;
    const receivedAt = new Date((msg.timestamp || Date.now() / 1000) * 1000).toISOString();

    // Save to DB
    const saved = await db.saveMessage({
      csmId: csm.id,
      groupJid,
      groupName,
      waMessageId: msg.id,
      senderPhone,
      senderName,
      body,
      ...classification,
      receivedAt
    });

    if (!saved) return; // duplicate message — already processed

    // Create SLA timer
    await db.createSLATimer(saved.id, saved.received_at);

    logger.info({
      csm: csm.name,
      group: groupName,
      intent: classification.intent,
      urgency: classification.urgency
    }, 'Message saved');

    // Immediate Slack alert for urgent/escalation messages
    if (classifier.isImmediateAlert(classification)) {
      await slack.alertUrgentMessage(csm, { ...saved, group_name: groupName });
    }
  }
}

module.exports = router;
