# Setup Checklist — WA Monitor
Follow these steps in order. Each step links to exactly what to click.

---

## Phase 1 — Create Accounts (do this first, ~30 min total)

### ✅ Step 1 · Supabase (Database)
1. Go to [supabase.com](https://supabase.com) → Sign Up (free, no CC)
2. New Project → Name: `wa-monitor` · Region: `Southeast Asia (Singapore)`
3. Set a password → Save it → wait ~2 min
4. Left sidebar → **SQL Editor** → New Query → paste the schema below → Run:

```sql
CREATE TABLE csms (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  phone            TEXT NOT NULL,
  slack_user_id    TEXT,
  manager_slack_id TEXT,
  manager_name     TEXT,
  waha_session     TEXT UNIQUE,
  wa_status        TEXT DEFAULT 'disconnected',
  timezone         TEXT DEFAULT 'Asia/Kolkata',
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE monitored_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  csm_id     UUID REFERENCES csms(id) ON DELETE CASCADE,
  group_jid  TEXT NOT NULL,
  group_name TEXT NOT NULL,
  active     BOOLEAN DEFAULT true,
  UNIQUE(csm_id, group_jid)
);

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  csm_id          UUID REFERENCES csms(id),
  group_jid       TEXT NOT NULL,
  group_name      TEXT,
  wa_message_id   TEXT UNIQUE NOT NULL,
  sender_phone    TEXT NOT NULL,
  sender_name     TEXT,
  body            TEXT,
  intent          TEXT DEFAULT 'general',
  sentiment       TEXT DEFAULT 'neutral',
  urgency         TEXT DEFAULT 'low',
  status          TEXT DEFAULT 'pending',
  received_at     TIMESTAMPTZ NOT NULL,
  answered_at     TIMESTAMPTZ,
  response_time_s INT
);

CREATE TABLE sla_timers (
  message_id         UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  sla_deadline       TIMESTAMPTZ NOT NULL,
  breach_alerted     BOOLEAN DEFAULT false,
  escalation_alerted BOOLEAN DEFAULT false
);

CREATE INDEX idx_messages_csm_status ON messages(csm_id, status);
CREATE INDEX idx_sla_breach ON sla_timers(breach_alerted, sla_deadline);
```

5. Sidebar → **Settings** → **API** → Copy and save:
   - `Project URL` (looks like `https://xxxxx.supabase.co`)
   - `service_role` key (the long `eyJ...` string — NOT the anon key)

---

### ✅ Step 2 · Slack App
1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name: `WA Monitor` · Workspace: pick Limechat's Slack → Create
3. Left sidebar → **OAuth & Permissions** → Scopes → Bot Token Scopes → Add:
   - `chat:write`
   - `users:read`
   - `users:read.email`
4. Left sidebar → **Install App** → Install to Workspace → Allow
5. Copy and save:
   - **Bot User OAuth Token** (starts `xoxb-`)
   - Left sidebar → **Basic Information** → **Signing Secret**

---

### ✅ Step 3 · GitHub Repo
1. Go to [github.com](https://github.com) → New repository
2. Name: `wa-monitor` · Private · No README → Create
3. On your computer, open Terminal in the `wa-monitor/` folder:
```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/wa-monitor.git
git push -u origin main
```

---

### ✅ Step 4 · Railway
1. Go to [railway.app](https://railway.app) → Sign Up with GitHub (no CC needed for first month)
2. **New Project** → **Empty Project** → name it `wa-monitor`

---

## Phase 2 — Deploy WAHA (~10 min)

1. Inside Railway project → **+ New** → **Docker Image**
2. Image name: `devlikeapro/waha:noweb`
3. Port: `3000`
4. **Variables** tab → add:

| Variable | Value |
|----------|-------|
| `WHATSAPP_DEFAULT_ENGINE` | `NOWEB` |
| `WAHA_LOG_LEVEL` | `error` |
| `WAHA_DASHBOARD_ENABLED` | `false` |
| `WHATSAPP_API_KEY` | `pick-any-secret-key` (e.g. `waha-limechat-2024`) |

5. Click **Deploy** → wait for green ✅
6. Note the internal hostname shown in Settings (e.g. `waha.railway.internal`)

> Do NOT add `WHATSAPP_HOOK_URL` yet — we need the Node.js app URL first.

---

## Phase 3 — Deploy Node.js App (~10 min)

1. In same Railway project → **+ New** → **GitHub Repo** → select `wa-monitor`
2. Railway auto-detects the Dockerfile → **Deploy**
3. After deploy → **Settings** → **Domains** → **Generate Domain** → copy the URL
   (looks like `https://wa-monitor-production.up.railway.app`)

4. **Variables** tab → add all of these:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | your Supabase service_role key |
| `WAHA_BASE_URL` | `http://waha.railway.internal:3000` |
| `WAHA_API_KEY` | same secret key you set on WAHA |
| `SLACK_BOT_TOKEN` | `xoxb-...` |
| `SLACK_SIGNING_SECRET` | from Slack Basic Information |
| `APP_URL` | your Railway app URL (from step 3 above) |
| `NODE_ENV` | `production` |

5. Railway auto-redeploys → wait for green ✅

---

## Phase 4 — Connect WAHA to Your App (~2 min)

Now that we have the Node.js URL, go back to the WAHA service:

1. Railway → WAHA service → **Variables** → Add:

| Variable | Value |
|----------|-------|
| `WHATSAPP_HOOK_URL` | `https://your-app.up.railway.app/webhooks/waha` |
| `WHATSAPP_HOOK_EVENTS` | `message,session.status` |

2. WAHA restarts automatically.

---

## Phase 5 — Test End to End (~15 min)

### Smoke test
Open `https://your-app.up.railway.app` → onboarding page should load.

### Full flow test
1. Complete onboarding with your own details
2. Scan QR with WhatsApp → should show "Connected ✅"
3. Select a test group (create one with 2 phones if needed)
4. Enter your Slack Member ID → Finish
5. From a second phone, send a message to the test group
6. Check Railway logs (Node.js service → Logs) — should see `Message saved`
7. Check dashboard → message should appear with classification
8. Send a message containing the word "urgent" → Slack DM should arrive within seconds

### SLA test (confirm alerts work)
1. Send a message to the test group
2. Do NOT reply for 5 minutes
3. Slack DM should arrive: "⚠️ SLA Breach..."

---

## How to Push Updates Later

```bash
# Make a change to any file locally, then:
git add .
git commit -m "describe what you changed"
git push origin main
# Railway auto-detects the push and redeploys in ~90 seconds
```

## Checking Logs

In Railway → your Node.js service → **Logs** tab. Filter by typing in the search box.

---

## If Something Goes Wrong

| Problem | Check |
|---------|-------|
| QR not showing | Railway → WAHA logs — look for errors |
| "Cannot connect to WAHA" | Is `WAHA_BASE_URL` set to `http://waha.railway.internal:3000`? |
| No Slack alerts | Is `SLACK_BOT_TOKEN` correct? Did you add `chat:write` scope? |
| Session not saving | Did you run the SQL schema in Supabase? |
| Webhook not firing | Is `WHATSAPP_HOOK_URL` set on WAHA service? Does it point to `/webhooks/waha`? |
