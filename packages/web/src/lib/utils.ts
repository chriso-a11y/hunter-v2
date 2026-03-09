import { formatDistanceToNow, format } from 'date-fns';
import { CandidateState } from './api';

export function timeAgo(dateStr: string): string {
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
}

export function formatDate(dateStr: string): string {
  return format(new Date(dateStr), 'MMM d, yyyy h:mm a');
}

export const STATE_LABELS: Record<CandidateState, string> = {
  new: 'New',
  sms_sent: 'Contacted',
  screening: 'Screening',
  qualified: 'Qualified',
  scheduled: 'Scheduled',
  interviewed: 'Interviewed',
  hired: 'Hired',
  rejected: 'Rejected',
  declined: 'Declined',
  opted_out: 'Opted Out',
};

export const STATE_COLORS: Record<CandidateState, string> = {
  new: '#3b82f6',
  sms_sent: '#8b5cf6',
  screening: '#f59e0b',
  qualified: '#F37124',
  scheduled: '#22c55e',
  interviewed: '#06b6d4',
  hired: '#22c55e',
  rejected: '#ef4444',
  declined: '#94a3b8',
  opted_out: '#64748b',
};

export function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

export const PIPELINE_COLUMNS: CandidateState[] = [
  'new',
  'sms_sent',
  'screening',
  'qualified',
  'scheduled',
  'interviewed',
];

export const TERMINAL_STATES: CandidateState[] = ['hired', 'rejected', 'declined', 'opted_out'];
