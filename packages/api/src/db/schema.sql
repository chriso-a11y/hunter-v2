-- Hunter v2 Database Schema
-- Run this against your Railway PostgreSQL instance

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  description TEXT,
  knockout_questions JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID REFERENCES positions(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  resume_text TEXT,
  raw_email TEXT,
  fit_score INTEGER DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'new',
  knockout_responses JSONB DEFAULT '{}',
  knockout_pass BOOLEAN,
  calendar_event_id TEXT,
  interview_at TIMESTAMPTZ,
  notes TEXT,
  source TEXT DEFAULT 'careers_form',
  opted_out BOOLEAN DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id),
  direction TEXT NOT NULL,
  channel TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id),
  candidate_phone TEXT NOT NULL,
  message TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', -- pending | approved | editing | edited | skipped | auto_sent
  telegram_message_id INTEGER,
  edited_message TEXT,
  position_title TEXT,
  conversation_context TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '4 hours',
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS feedback_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES candidates(id),
  position_title TEXT,
  conversation_context TEXT,
  hunter_draft TEXT NOT NULL,
  chris_edit TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_candidates_state ON candidates(state);
CREATE INDEX IF NOT EXISTS idx_candidates_phone ON candidates(phone);
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);
CREATE INDEX IF NOT EXISTS idx_messages_candidate_id ON messages(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidates_deleted_at ON candidates(deleted_at);
CREATE INDEX IF NOT EXISTS idx_pending_messages_state ON pending_messages(state);
CREATE INDEX IF NOT EXISTS idx_pending_messages_expires_at ON pending_messages(expires_at);

-- Seed positions
INSERT INTO positions (title, department, description, knockout_questions)
VALUES
  ('Sales Rep', 'sales', 'Field sales representative — storm damage restoration',
   '[
     {"question": "Do you have a valid driver''s license?", "disqualify_on": "no"},
     {"question": "Are you comfortable with commission-based pay?", "disqualify_on": "no"},
     {"question": "Are you available to start within 6 weeks?", "disqualify_on": "no"}
   ]'::jsonb),
  ('Bookkeeper', 'office', 'Part-time bookkeeper — QuickBooks, AP/AR experience preferred',
   '[
     {"question": "Do you have QuickBooks experience?", "disqualify_on": "no"},
     {"question": "Are you available for at least 20 hours/week?", "disqualify_on": "no"},
     {"question": "Are you able to work from our Glen Ellyn, IL office?", "disqualify_on": "no"}
   ]'::jsonb)
ON CONFLICT DO NOTHING;

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('scoring_threshold', '30'::jsonb),
  ('calendar_days_ahead', '5'::jsonb),
  ('calendar_slots_count', '3'::jsonb),
  ('business_hours_start', '9'::jsonb),
  ('business_hours_end', '17'::jsonb),
  ('notifications_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
