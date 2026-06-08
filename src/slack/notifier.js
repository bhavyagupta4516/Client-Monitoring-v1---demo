'use strict';
const { WebClient } = require('@slack/web-api');
const logger = require('../logger');

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// ─── Core send ────────────────────────────────────────────────────────────────

async function sendDM(slackUserId, text, blocks = null) {
  if (!slackUserId) {
    logger.warn('sendDM: no slackUserId — skipping');
    return;
  }
  try {
    const params = { channel: slackUserId, text };
    if (blocks) params.blocks = blocks;
    await slack.chat.postMessage(params);
  } catch (err) {
    logger.error({ err: err.message, slackUserId }, 'sendDM failed');
  }
}

// ─── Alert types ──────────────────────────────────────────────────────────────

async function alertUrgentMessage(csm, message) {
  const emoji = message.urgency === 'critical' ? '🔴' : '🟠';
  const title = `${emoji} *${message.urgency === 'critical' ? 'CRITICAL' : 'Urgent'} — ${message.group_name}*`;

  await sendDM(csm.slack_user_id, title, [
    { type: 'section', text: { type: 'mrkdwn', text: title } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Message:*\n> ${trunc(message.body, 200)}` },
        { type: 'mrkdwn', text: `*From:*\n${message.sender_name || message.sender_phone}` },
        { type: 'mrkdwn', text: `*Intent:*\n${message.intent}` },
        { type: 'mrkdwn', text: `*Urgency:*\n${message.urgency}` }
      ]
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Received: ${toIST(message.received_at)} | Reply on WhatsApp now` }]
    }
  ]);

  // Also notify manager on escalations
  if (message.intent === 'escalation' && csm.manager_slack_id) {
    await sendDM(
      csm.manager_slack_id,
      `🔺 *Escalation on ${csm.name}'s account*\nGroup: *${message.group_name}*\n> ${trunc(message.body, 200)}\n_${toIST(message.received_at)}_`
    );
  }
}

async function alertSLABreach(csm, message) {
  const minutesElapsed = Math.floor((Date.now() - new Date(message.received_at)) / 60000);

  await sendDM(
    csm.slack_user_id,
    `⚠️ *SLA Breach — ${message.group_name}*\nNo reply for *${minutesElapsed} minutes*.\n> ${trunc(message.body, 150)}\n_Received: ${toIST(message.received_at)}_`
  );

  if (csm.manager_slack_id) {
    await sendDM(
      csm.manager_slack_id,
      `⚠️ *SLA Breach on ${csm.name}'s account*\nGroup: ${message.group_name} · No reply for ${minutesElapsed} min\n> ${trunc(message.body, 150)}`
    );
  }
}

async function alertSessionDisconnected(csm, reconnectUrl) {
  await sendDM(
    csm.slack_user_id,
    `⚡ *WhatsApp Disconnected — WA Monitor paused*\nYour connection dropped. Monitoring is paused until you reconnect.\n<${reconnectUrl}|Click here to reconnect> (takes ~30 seconds)`
  );
}

async function sendMorningBrief(csm, pendingMessages) {
  if (!csm.slack_user_id) return;
  const firstName = csm.name.split(' ')[0];

  if (pendingMessages.length === 0) {
    await sendDM(csm.slack_user_id, `☀️ Good morning, ${firstName}! No open threads. Clean slate today.`);
    return;
  }

  const byGroup = pendingMessages.reduce((acc, m) => {
    acc[m.group_name] = (acc[m.group_name] || 0) + 1;
    return acc;
  }, {});
  const groupLines = Object.entries(byGroup).map(([g, n]) => `• ${g} — ${n} unanswered`).join('\n');
  const oldest = pendingMessages.reduce((a, b) =>
    new Date(a.received_at) < new Date(b.received_at) ? a : b
  );
  const oldestHrs = Math.floor((Date.now() - new Date(oldest.received_at)) / 3600000);

  await sendDM(
    csm.slack_user_id,
    `☀️ *Good morning, ${firstName}!*\n*${pendingMessages.length} open thread${pendingMessages.length > 1 ? 's' : ''}* from yesterday:\n${groupLines}\nOldest message: ${oldestHrs}h ago. Reply before 10 AM to clear SLA.`
  );
}

async function sendEODBrief(csm, stats) {
  if (!csm.slack_user_id) return;
  const firstName = csm.name.split(' ')[0];

  await sendDM(
    csm.slack_user_id,
    `🌙 *End of Day — ${firstName}*\n` +
    `Messages: ${stats.total} received · ${stats.answered} replied · ${stats.breaches} SLA breach${stats.breaches !== 1 ? 'es' : ''}\n` +
    `Avg response: ${stats.avgResponseMin} min\n` +
    (stats.open > 0
      ? `⚠️ *${stats.open} open thread${stats.open > 1 ? 's' : ''} still pending* — you'll get alerts if clients reply tonight.`
      : `✅ All caught up!`)
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trunc(text, max) {
  if (!text) return '(no text)';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function toIST(isoString) {
  return new Date(isoString).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit',
    day: 'numeric', month: 'short'
  });
}

module.exports = {
  alertUrgentMessage, alertSLABreach, alertSessionDisconnected,
  sendMorningBrief, sendEODBrief
};
