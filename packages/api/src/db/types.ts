export interface KnockoutQuestion {
  question: string;
  disqualify_on: 'yes' | 'no';
}

export interface Position {
  id: string;
  title: string;
  department: string;
  description: string | null;
  knockout_questions: KnockoutQuestion[];
  status: 'active' | 'paused' | 'filled';
  created_at: string;
  updated_at: string;
}

export type CandidateState =
  | 'new'
  | 'sms_sent'
  | 'screening'
  | 'qualified'
  | 'scheduled'
  | 'interviewed'
  | 'hired'
  | 'rejected'
  | 'declined'
  | 'opted_out';

export interface Candidate {
  id: string;
  position_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  resume_text: string | null;
  raw_email: string | null;
  fit_score: number;
  state: CandidateState;
  knockout_responses: Record<string, string>;
  knockout_pass: boolean | null;
  calendar_event_id: string | null;
  interview_at: string | null;
  notes: string | null;
  source: string;
  opted_out: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  candidate_id: string;
  direction: 'inbound' | 'outbound';
  channel: 'sms' | 'email';
  body: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type PendingMessageState = 'pending' | 'approved' | 'editing' | 'edited' | 'skipped' | 'auto_sent';

export interface PendingMessage {
  id: string;
  candidate_id: string;
  candidate_phone: string;
  message: string;
  state: PendingMessageState;
  telegram_message_id: number | null;
  edited_message: string | null;
  position_title: string | null;
  conversation_context: string | null;
  created_at: string;
  expires_at: string;
  sent_at: string | null;
}

export interface FeedbackLog {
  id: string;
  candidate_id: string;
  position_title: string | null;
  conversation_context: string | null;
  hunter_draft: string;
  chris_edit: string;
  created_at: string;
}

export interface CalendarSlot {
  start: Date;
  end: Date;
  label: string; // e.g. "Tuesday Mar 12 at 10:00 AM"
}
