# Hunter v2 — Autonomous SMS Recruiting Agent

Autonomous SMS-first recruiting system for Frontline Adjusters / Greater Good Restoration.

## What it does

1. **Ingests job applications** via Gmail (Pub/Sub push)
2. **Scores candidates** 0–100 with Claude AI
3. **Auto-declines** low-fit candidates via email
4. **Initiates SMS outreach** to qualified candidates as "Hunter Jacobs"
5. **Conducts knockout screening** via conversational SMS (powered by Claude)
6. **Schedules interviews** by fetching real calendar availability and booking
7. **Notifies Chris** via Telegram when interviews are confirmed

---

## Stack

- **API:** Hono + Node.js (TypeScript)
- **Frontend:** React + Vite (TypeScript)
- **Database:** PostgreSQL (Railway)
- **SMS:** Twilio
- **Email:** Gmail API (OAuth2)
- **Calendar:** Google Calendar API
- **AI:** Anthropic Claude (claude-sonnet-4-6)
- **Notifications:** Telegram Bot

---

## Local Development

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL (local or Railway)

### Setup

```bash
# Clone and install
cd packages/api
cp .env.example .env
# Fill in your .env values

# Install all deps
cd ../..
pnpm install

# Run DB schema
psql $DATABASE_URL -f packages/api/src/db/schema.sql

# Start API
pnpm dev:api

# Start Web (separate terminal)
pnpm dev:web
```

---

## Environment Variables

### Required (must be set in Railway)

| Variable | Description |
|---|---|
| `DATABASE_URL` | Railway PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `GMAIL_CLIENT_ID` | Google OAuth2 client ID |
| `GMAIL_CLIENT_SECRET` | Google OAuth2 client secret |
| `GMAIL_REFRESH_TOKEN` | OAuth2 refresh token for Gmail access |

### Pre-filled (already in code)

| Variable | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | `AC6fbfad33c3c4a6499cd273be413188e2` |
| `TWILIO_AUTH_TOKEN` | *(set)* |
| `TWILIO_FROM_NUMBER` | `+16306265015` |
| `TELEGRAM_BOT_TOKEN` | *(set)* |
| `TELEGRAM_CHAT_ID` | `8638812387` |
| `AUTH_PASSWORD` | `hunter2026` |
| `GMAIL_PUBSUB_TOPIC` | `projects/my-project-1711681385577/topics/gmail-push` |
| `GOOGLE_CALENDAR_ID` | `primary` |
| `PORT` | `3001` |

### Optional

| Variable | Description |
|---|---|
| `GOOGLE_CALENDAR_SERVICE_ACCOUNT` | Service account JSON for calendar (falls back to Gmail OAuth) |
| `WEB_URL` | Frontend URL for CORS (Railway web service URL) |

---

## Railway Deployment

### 1. Create Railway project

```bash
# Install Railway CLI
npm install -g @railway/cli
railway login
railway init
```

### 2. Add PostgreSQL service

In the Railway dashboard → Add Plugin → PostgreSQL. Copy the `DATABASE_URL`.

### 3. Deploy API service

- Set build to use `Dockerfile.api`
- Add all environment variables in Railway dashboard
- Set `PORT=3001`

### 4. Deploy Web service

- Set build to use `Dockerfile.web`
- Set `VITE_API_URL` to your API Railway URL
- Set `VITE_AUTH_PASSWORD=hunter2026`

### 5. Initialize database

SSH into Railway or run via local with Railway's DATABASE_URL:

```bash
psql $DATABASE_URL -f packages/api/src/db/schema.sql
```

### 6. Configure Twilio webhook

In Twilio console → Phone Numbers → `+16306265015` → Messaging:
- Set webhook URL to: `https://your-api.railway.app/api/webhook/twilio`
- Method: HTTP POST

### 7. Configure Gmail Pub/Sub

1. Create a Google Cloud Pub/Sub topic: `gmail-push`
2. Grant `gmail-api-push@system.gserviceaccount.com` Pub/Sub Publisher role
3. Create a push subscription pointing to: `https://your-api.railway.app/api/webhook/gmail`
4. Set up OAuth2 credentials for Gmail API access
5. Get refresh token using OAuth2 playground or your own flow

### 8. Set up Gmail watch

Call the `/api/webhook/gmail` setup route, or configure a cron to call `watchInbox()` weekly (Gmail watches expire after 7 days).

---

## Candidate State Machine

```
new → sms_sent → screening → qualified → scheduled → interviewed → hired
                     ↓
                  declined
     ↓
  rejected (low fit score auto-decline)
opted_out (STOP keyword)
```

---

## Knock-out Questions

Configured per position. Each question has a `disqualify_on` field (`"yes"` or `"no"`). Claude detects candidate intent and routes accordingly. Unclear answers prompt a clarification request.

---

## API Authentication

All `/api/*` routes (except webhooks) require:
```
Authorization: Bearer hunter2026
```

---

## Frontend

Access the dashboard at `http://localhost:5173` (dev) or your Railway web URL.

Pages:
- **Pipeline** — Kanban board, real-time candidate tracking
- **Candidate Detail** — Full profile, SMS/email thread, state controls
- **Positions** — Manage open roles and knockout questions  
- **Settings** — Scoring thresholds, calendar config, notification preferences
