'use strict';
const cron = require('node-cron');
const db = require('../db/supabase');
const slack = require('../slack/notifier');
const logger = require('../logger');

// Every 5 minutes: check for SLA breaches across all pending messages
function startSLAChecker() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const pending = await db.getPendingMessages();
      if (pending.length === 0) return;

      const now = Date.now();
      for (const msg of pending) {
        const timer = msg.sla_timers?.[0];
        if (!timer) continue;

        const isBreached = now > new Date(timer.sla_deadline).getTime();
        if (!isBreached || timer.breach_alerted) continue;

        const csm = await db.getCSMById(msg.csm_id);
        if (!csm) continue;

        await slack.alertSLABreach(csm, msg);
        await db.markSLAAlerted(msg.id, 'breach');
        logger.info({ message_id: msg.id, group: msg.group_name, csm: csm.name }, 'SLA breach alerted');
      }
    } catch (err) {
      logger.error({ err: err.message }, 'SLA checker error');
    }
  }, { timezone: 'Asia/Kolkata' });

  logger.info('SLA checker running (every 5 min, IST)');
}

// 9:00 AM IST — morning brief for all connected CSMs
function startMorningBrief() {
  cron.schedule('0 9 * * *', async () => {
    logger.info('Sending morning briefs');
    try {
      const csms = await db.getAllCSMs();
      for (const csm of csms) {
        if (csm.wa_status !== 'connected') continue;
        const messages = await db.getRecentMessagesForCSM(csm.id, 16);
        const pending = messages.filter(m => m.status === 'pending');
        await slack.sendMorningBrief(csm, pending);
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Morning brief error');
    }
  }, { timezone: 'Asia/Kolkata' });

  logger.info('Morning brief scheduled (9:00 AM IST)');
}

// 6:00 PM IST — EOD brief for all connected CSMs
function startEODBrief() {
  cron.schedule('0 18 * * *', async () => {
    logger.info('Sending EOD briefs');
    try {
      const csms = await db.getAllCSMs();
      for (const csm of csms) {
        if (csm.wa_status !== 'connected') continue;
        const messages = await db.getRecentMessagesForCSM(csm.id, 9); // last 9 hours
        const answered = messages.filter(m => m.response_time_s != null);
        const avgResponseMin = answered.length
          ? Math.floor(answered.reduce((s, m) => s + m.response_time_s, 0) / answered.length / 60)
          : 0;

        // A real breach = still pending AND past its SLA deadline — not just "pending and not low urgency".
        // SLA window here matches createSLATimer() in db/supabase.js (fixed 1 hour). If that ever
        // becomes configurable per CSM, this constant must be updated to match.
        const now = Date.now();
        const SLA_MS = 60 * 60 * 1000;
        const breaches = messages.filter(m =>
          m.status === 'pending' && (now - new Date(m.received_at).getTime()) > SLA_MS
        ).length;

        await slack.sendEODBrief(csm, {
          total: messages.length,
          answered: answered.length,
          breaches,
          open: messages.filter(m => m.status === 'pending').length,
          avgResponseMin
        });
      }
    } catch (err) {
      logger.error({ err: err.message }, 'EOD brief error');
    }
  }, { timezone: 'Asia/Kolkata' });

  logger.info('EOD brief scheduled (6:00 PM IST)');
}

module.exports = { startSLAChecker, startMorningBrief, startEODBrief };
