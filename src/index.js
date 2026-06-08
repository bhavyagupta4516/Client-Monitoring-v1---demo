'use strict';
require('dotenv').config();

const express = require('express');
const path = require('path');
const logger = require('./logger');
const { startSLAChecker, startMorningBrief, startEODBrief } = require('./sla/tracker');

// Validate critical env vars at startup — fail fast with a clear message
const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'WAHA_BASE_URL', 'WAHA_API_KEY', 'SLACK_BOT_TOKEN'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[FATAL] Missing env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in all values.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'views')));

// ─── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/onboard',   require('./routes/onboard'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/webhooks',      require('./routes/webhook'));

// ─── Pages ─────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) =>
  res.sendFile(path.join(__dirname, 'views', 'onboard.html'))
);
app.get('/dashboard', (_req, res) =>
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'))
);

// Reconnect flow — shows QR for a CSM whose session dropped
app.get('/reconnect/:csmId', async (req, res) => {
  const db = require('./db/supabase');
  const csm = await db.getCSMById(req.params.csmId);
  if (!csm) return res.status(404).send('CSM not found');
  // Redirect to onboard page with session pre-filled (re-uses the QR step)
  res.redirect(`/?reconnect=1&session=${csm.waha_session}&csm=${csm.id}`);
});

// ─── Health check (used by Railway + monitoring) ────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime_seconds: Math.floor(process.uptime()),
    ts: new Date().toISOString()
  });
});

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start background jobs ────────────────────────────────────────────────────
startSLAChecker();
startMorningBrief();
startEODBrief();

// ─── Listen ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, 'WA Monitor started');
  logger.info({ url: process.env.APP_URL || `http://localhost:${PORT}` }, 'App URL');
});

// ─── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down gracefully');
  process.exit(0);
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'Unhandled promise rejection');
});
