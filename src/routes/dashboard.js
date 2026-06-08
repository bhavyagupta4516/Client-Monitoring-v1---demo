'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/supabase');
const waha = require('../waha/client');

// GET /api/dashboard/:csmId
router.get('/:csmId', async (req, res) => {
  try {
    const { csmId } = req.params;
    const [csm, groups, messages] = await Promise.all([
      db.getCSMById(csmId),
      db.getMonitoredGroups(csmId),
      db.getRecentMessagesForCSM(csmId, 48)
    ]);

    if (!csm) return res.status(404).json({ error: 'CSM not found' });

    // Build summary stats
    const stats = {
      total: messages.length,
      pending: messages.filter(m => m.status === 'pending').length,
      answered: messages.filter(m => m.status === 'answered').length,
      escalations: messages.filter(m => m.intent === 'escalation').length,
      bugs: messages.filter(m => m.intent === 'bug').length
    };

    return res.json({
      csm: { id: csm.id, name: csm.name, status: csm.wa_status },
      groups,
      messages,
      stats
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/:csmId/groups/available
// Fetches all WAHA groups for this CSM, flagging which are already monitored
router.get('/:csmId/groups/available', async (req, res) => {
  try {
    const { csmId } = req.params;
    const csm = await db.getCSMById(csmId);
    if (!csm) return res.status(404).json({ error: 'CSM not found' });

    const [allGroups, monitored] = await Promise.all([
      waha.getGroups(csm.waha_session),
      db.getMonitoredGroups(csmId)
    ]);

    const monitoredJids = new Set(monitored.map(g => g.group_jid));
    return res.json(
      allGroups.map(g => ({ ...g, already_monitored: monitoredJids.has(g.group_jid) }))
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/dashboard/:csmId/groups
// Add one or more groups to monitor
router.post('/:csmId/groups', async (req, res) => {
  try {
    const { csmId } = req.params;
    const { groups } = req.body;
    if (!groups?.length) return res.status(400).json({ error: 'groups[] required' });
    await db.saveMonitoredGroups(csmId, groups);
    return res.json({ ok: true, saved: groups.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/dashboard/:csmId/groups
// Deactivate (stop monitoring) a group — keeps history, sets active=false
router.delete('/:csmId/groups', async (req, res) => {
  try {
    const { csmId } = req.params;
    const { groupJid } = req.body;
    if (!groupJid) return res.status(400).json({ error: 'groupJid required' });
    await db.deactivateGroup(csmId, groupJid);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
