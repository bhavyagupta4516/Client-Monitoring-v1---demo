'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/supabase');

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

module.exports = router;
