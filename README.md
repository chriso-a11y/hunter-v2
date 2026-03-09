# Hunter v2 — Autonomous SMS Recruiting Agent

Autonomous SMS-first recruiting system for Frontline Adjusters / Greater Good Restoration.

## What it does

1. **Ingests job applications** via Gmail (Pub/Sub push notifications)
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
- **Calendar:** Google Calendar API (OAuth2 — same credentials as Gmail)
- **AI:** Anthropic Claude (claude-sonnet-4-6)
- **Notifications:** Telegram Bot

---

## Project Structure

```
hunter-v2/
  packages/
    api/          ← Hono API (port 3001)
    web/          ← React frontend (port 5173 dev)
  Dockerfile.api
  Dockerfile.web
  railway.toml
  pnpm-workspace.yaml
```

---

## Local Development

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL (local or Railway)

### Setup

```bash
# Install dependencies
pnpm install

# Configure environment
cp packages/api/.env.example packages/api/.env
# Edit .env with your values (see Environment Variables below)

# Initialize database
psql $DATABASE_URL -f packages/api/src/db/schema.sql

# Start API (terminal 1)
pnpm dev:api

# Start Web (terminal 2)
pnpm dev:web
```

---

## Environment Variables

Set these in Railway dashboard (API service). All are required unless marked optional.

### Database

| Variable | Description |
|---|---|
| `DATABASE_URL` | Railway PostgreSQL URL (auto-set if you link the DB) |

### Google / Gmail / Calendar

All Google integrations use the **same OAuth2 credentials**. No service account needed.

| Variable | Description |
|---|---|
| `GMAIL_CLIENT_ID` | Google OAuth2 client ID |
| `GMAIL_CLIENT_SECRET` | Google OAuth2 client secret |
| `GMAIL_REFRESH_TOKEN` | OAuth2 refresh token (long-lived, from OAuth2 playground) |
| `GMAIL_PUBSUB_TOPIC` | Pub/Sub topic name: `projects/my-project-1711681385577/topics/gmail-push` |
| `GOOGLE_CALENDAR_ID` | Calendar to use — set to `primary` |

### AI

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |

### SMS (Twilio)

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM_NUMBER` | Twilio phone number in E.164 format |

### Notifications

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Telegram chat/user ID to notify |

### App

| Variable | Default | Description |
|---|---|---|
| `AUTH_PASSWORD` | — | Password for API Bearer auth (`Authorization: Bearer <password>`) |
| `PORT` | `3001` | API listen port |
| `WEB_URL` | — | Frontend URL for CORS (your Railway web service URL) |

### Frontend (Railway Web service env vars)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Full URL of your API service, e.g. `https://hunter-api.railway.app/api` |
| `VITE_AUTH_PASSWORD` | Same as `AUTH_PASSWORD` above |

---

## Railway Deployment

### 1. Create project & add PostgreSQL

```
railway new
# In dashboard: Add Plugin → PostgreSQL
```

### 2. Run schema

```bash
# From local with DATABASE_URL from Railway
psql $DATABASE_URL -f packages/api/src/db/schema.sql
```

### 3. Deploy API service

- Root directory: `/` (monorepo root)
- Dockerfile: `Dockerfile.api`
- Set all environment variables listed above
- Health check: `GET /health`

### 4. Deploy Web service

- Root directory: `/` (monorepo root)
- Dockerfile: `Dockerfile.web`
- Set `VITE_API_URL` and `VITE_AUTH_PASSWORD`

### 5. Configure Twilio webhook

In Twilio console → Phone Numbers → your number → Messaging:

- **Webhook URL:** `https://your-api.railway.app/api/webhook/twilio`
- **Method:** HTTP POST

### 6. Configure Gmail Pub/Sub

**One-time GCP setup:**

```bash
# Create topic (already done: my-project-1711681385577/topics/gmail-push)
# Grant publisher role to Gmail push service account:
gcloud pubsub topics add-iam-policy-binding gmail-push \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

# Create push subscription
gcloud pubsub subscriptions create gmail-push-sub \
  --topic=gmail-push \
  --push-endpoint=https://your-api.railway.app/api/webhook/gmail \
  --ack-deadline=30
```

**Activate Gmail watch** (expires every 7 days — set up a Railway cron or call manually):

```bash
curl -X POST https://your-api.railway.app/api/webhook/gmail/watch \
  -H "Authorization: Bearer hunter2026"
```

> **Note:** Gmail watches expire after 7 days. Set a weekly cron in Railway to re-activate, or call `/api/webhook/gmail/watch` manually after each expiry.

### 7. Obtain Gmail OAuth2 refresh token

Use the [Google OAuth2 Playground](https://developers.google.com/oauthplayground/):

1. Authorize scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/calendar`
2. Use your Client ID / Secret from Google Cloud Console
3. Exchange auth code → copy the refresh token

---

## Candidate State Machine

```
                        ┌─ declined (knockout fail)
new → sms_sent → screening → qualified → scheduled → interviewed → hired
 │                                                
 └─ rejected  (fit score < threshold, auto email decline)
 └─ opted_out (STOP/UNSUBSCRIBE keyword received)
```

---

## Knock-out Questions

Configured per position in the DB (editable via the Positions UI). Each question has:
- `question`: The text asked via SMS
- `disqualify_on`: `"no"` or `"yes"` — which answer disqualifies the candidate

Claude detects intent (yes/no/unsure) from natural language replies. Unclear answers prompt a gentle clarification.

---

## API Authentication

All `/api/*` routes (except webhooks) require:

```
Authorization: Bearer hunter2026
```

---

## Frontend

Dark-themed dashboard at port 5173 (dev) or your Railway web URL.

| Page | Description |
|---|---|
| `/` | Kanban pipeline board |
| `/candidates/:id` | Candidate detail — messages, state, notes |
| `/positions` | Manage open roles & knockout questions |
| `/settings` | Scoring thresholds, calendar config |
