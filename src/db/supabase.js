'use strict';
const { createClient } = require('@supabase/supabase-js');
const logger = require('../logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── CSMs ─────────────────────────────────────────────────────────────────────

async function createCSM({ name, email, phone, wahaSession }) {
  const { data, error } = await supabase
    .from('csms')
    .upsert(
      { name, email, phone, waha_session: wahaSession },
      { onConflict: 'email', ignoreDuplicates: false }
    )
    .select()
    .single();
  if (error) throw new Error(`createCSM: ${error.message}`);
  return data;
}

async function getCSMBySession(wahaSession) {
  const { data } = await supabase
    .from('csms')
    .select('*')
    .eq('waha_session', wahaSession)
    .single();
  return data || null;
}

async function getCSMById(id) {
  const { data } = await supabase
    .from('csms')
    .select('*')
    .eq('id', id)
    .single();
  return data || null;
}

async function updateCSMStatus(wahaSession, status) {
  await supabase
    .from('csms')
    .update({ wa_status: status })
    .eq('waha_session', wahaSession);
}

async function updateCSMSlack(csmId, { slackUserId, managerSlackId, managerName }) {
  const { error } = await supabase
    .from('csms')
    .update({
      slack_user_id: slackUserId,
      manager_slack_id: managerSlackId || null,
      manager_name: managerName || null
    })
    .eq('id', csmId);
  if (error) throw new Error(`updateCSMSlack: ${error.message}`);
}

async function getAllCSMs() {
  const { data } = await supabase.from('csms').select('*');
  return data || [];
}

// ─── Groups ───────────────────────────────────────────────────────────────────

async function saveMonitoredGroups(csmId, groups) {
  const rows = groups.map(g => ({
    csm_id: csmId,
    group_jid: g.group_jid,
    group_name: g.group_name
  }));
  const { error } = await supabase
    .from('monitored_groups')
    .upsert(rows, { onConflict: 'csm_id,group_jid' });
  if (error) throw new Error(`saveMonitoredGroups: ${error.message}`);
}

async function getMonitoredGroups(csmId) {
  const { data } = await supabase
    .from('monitored_groups')
    .select('*')
    .eq('csm_id', csmId)
    .eq('active', true);
  return data || [];
}

async function isGroupMonitored(csmId, groupJid) {
  const { data } = await supabase
    .from('monitored_groups')
    .select('id')
    .eq('csm_id', csmId)
    .eq('group_jid', groupJid)
    .eq('active', true)
    .single();
  return !!data;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

async function saveMessage({
  csmId, groupJid, groupName, waMessageId,
  senderPhone, senderName, body,
  intent, sentiment, urgency, receivedAt
}) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      csm_id: csmId,
      group_jid: groupJid,
      group_name: groupName,
      wa_message_id: waMessageId,
      sender_phone: senderPhone,
      sender_name: senderName || null,
      body,
      intent,
      sentiment,
      urgency,
      received_at: receivedAt
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return null; // duplicate — silently skip
    throw new Error(`saveMessage: ${error.message}`);
  }
  return data;
}

async function markMessageAnswered(waMessageId) {
  const now = new Date();
  const { data: msg } = await supabase
    .from('messages')
    .select('id, received_at')
    .eq('wa_message_id', waMessageId)
    .single();

  if (!msg) return;

  const responseTimeSec = Math.floor((now - new Date(msg.received_at)) / 1000);
  await supabase
    .from('messages')
    .update({
      status: 'answered',
      answered_at: now.toISOString(),
      response_time_s: responseTimeSec
    })
    .eq('id', msg.id);

  await supabase.from('sla_timers').delete().eq('message_id', msg.id);
}

async function getPendingMessages() {
  const { data } = await supabase
    .from('messages')
    .select('*, sla_timers(*)')
    .eq('status', 'pending');
  return data || [];
}

async function getRecentMessagesForCSM(csmId, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('csm_id', csmId)
    .gte('received_at', since)
    .order('received_at', { ascending: false });
  return data || [];
}

// ─── SLA Timers ───────────────────────────────────────────────────────────────

async function createSLATimer(messageId, receivedAt) {
  const deadline = new Date(new Date(receivedAt).getTime() + 60 * 60 * 1000); // +1 hour
  const { error } = await supabase
    .from('sla_timers')
    .insert({ message_id: messageId, sla_deadline: deadline.toISOString() });
  if (error && error.code !== '23505') {
    logger.warn({ error: error.message }, 'createSLATimer: insert failed');
  }
}

async function markSLAAlerted(messageId, type) {
  const field = type === 'breach' ? 'breach_alerted' : 'escalation_alerted';
  await supabase
    .from('sla_timers')
    .update({ [field]: true })
    .eq('message_id', messageId);
}

module.exports = {
  createCSM, getCSMBySession, getCSMById,
  updateCSMStatus, updateCSMSlack, getAllCSMs,
  saveMonitoredGroups, getMonitoredGroups, isGroupMonitored,
  saveMessage, markMessageAnswered, getPendingMessages, getRecentMessagesForCSM,
  createSLATimer, markSLAAlerted
};
