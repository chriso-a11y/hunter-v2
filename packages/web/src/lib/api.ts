const BASE = import.meta.env.VITE_API_URL ?? '/api';
const PASSWORD = import.meta.env.VITE_AUTH_PASSWORD ?? '';

function headers(): HeadersInit {
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (PASSWORD) h['Authorization'] = `Bearer ${PASSWORD}`;
  return h;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers(), ...options?.headers },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

export const api = {
  candidates: {
    list: (state?: string) =>
      request<Candidate[]>(`/candidates${state ? `?state=${state}` : ''}`),
    get: (id: string) => request<CandidateDetail>(`/candidates/${id}`),
    update: (id: string, data: Partial<Candidate>) =>
      request<Candidate>(`/candidates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/candidates/${id}`, { method: 'DELETE' }),
  },
  positions: {
    list: () => request<Position[]>('/positions'),
    create: (data: Partial<Position>) =>
      request<Position>('/positions', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Position>) =>
      request<Position>(`/positions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  settings: {
    get: () => request<Record<string, unknown>>('/settings'),
    update: (data: Record<string, unknown>) =>
      request<{ ok: boolean }>('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  },
};

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
  position_title?: string;
  name: string;
  email: string;
  phone: string | null;
  resume_text: string | null;
  fit_score: number;
  state: CandidateState;
  knockout_responses: Record<string, string>;
  knockout_pass: boolean | null;
  calendar_event_id: string | null;
  interview_at: string | null;
  notes: string | null;
  source: string;
  opted_out: boolean;
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

export interface CandidateDetail extends Candidate {
  messages: Message[];
}
