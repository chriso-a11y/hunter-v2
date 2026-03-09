import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, CandidateDetail as CandidateDetailType, CandidateState, Message } from '../lib/api';
import { STATE_LABELS, formatDate, scoreColor, timeAgo } from '../lib/utils';
import Badge from '../components/Badge';
import ScoreRing from '../components/ScoreRing';

const ALL_STATES: CandidateState[] = [
  'new', 'sms_sent', 'screening', 'qualified',
  'scheduled', 'interviewed', 'hired', 'rejected', 'declined',
];

export default function CandidateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<CandidateDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.candidates.get(id).then((c) => {
      setCandidate(c);
      setNotes(c.notes ?? '');
    }).finally(() => setLoading(false));
  }, [id]);

  const handleStateChange = async (state: CandidateState) => {
    if (!candidate) return;
    setSaving(true);
    const updated = await api.candidates.update(candidate.id, { state }).catch(() => null);
    if (updated) setCandidate({ ...candidate, ...updated });
    setSaving(false);
  };

  const handleSaveNotes = async () => {
    if (!candidate) return;
    setSaving(true);
    const updated = await api.candidates.update(candidate.id, { notes }).catch(() => null);
    if (updated) setCandidate({ ...candidate, ...updated });
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!candidate || !confirm(`Delete ${candidate.name}? This cannot be undone.`)) return;
    await api.candidates.delete(candidate.id);
    navigate('/');
  };

  if (loading) return <div style={{ padding: 32, color: 'var(--text-muted)' }}>Loading...</div>;
  if (!candidate) return <div style={{ padding: 32, color: 'var(--danger)' }}>Candidate not found</div>;

  const smsMessages = candidate.messages.filter((m) => m.channel === 'sms');
  const emailMessages = candidate.messages.filter((m) => m.channel === 'email');

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
        <button
          onClick={() => navigate('/')}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, padding: 0 }}
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>{candidate.name}</h1>
            <Badge state={candidate.state} />
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            {candidate.position_title ?? 'Unknown Role'} · Added {timeAgo(candidate.created_at)}
          </div>
        </div>
        <ScoreRing score={candidate.fit_score} size={52} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Contact Info */}
          <Card title="Contact">
            <InfoRow label="Email" value={<a href={`mailto:${candidate.email}`}>{candidate.email}</a>} />
            <InfoRow label="Phone" value={candidate.phone ?? '—'} />
            <InfoRow label="Source" value={candidate.source} />
            {candidate.interview_at && (
              <InfoRow label="Interview" value={formatDate(candidate.interview_at)} />
            )}
            <InfoRow label="Fit Score" value={
              <span style={{ color: scoreColor(candidate.fit_score), fontWeight: 700 }}>
                {candidate.fit_score}/100
              </span>
            } />
          </Card>

          {/* State Control */}
          <Card title="Update State">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ALL_STATES.map((s) => (
                <button
                  key={s}
                  onClick={() => handleStateChange(s)}
                  disabled={saving || s === candidate.state}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: `1px solid ${s === candidate.state ? 'var(--accent)' : 'var(--border)'}`,
                    background: s === candidate.state ? 'rgba(243,113,36,0.12)' : 'var(--bg)',
                    color: s === candidate.state ? 'var(--accent)' : 'var(--text-muted)',
                    fontSize: 11,
                    fontWeight: s === candidate.state ? 700 : 400,
                    cursor: s === candidate.state ? 'default' : 'pointer',
                  }}
                >
                  {STATE_LABELS[s]}
                </button>
              ))}
            </div>
          </Card>

          {/* Notes */}
          <Card title="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              placeholder="Add notes about this candidate..."
              style={{ resize: 'vertical' }}
            />
            <button
              onClick={handleSaveNotes}
              disabled={saving}
              style={{
                marginTop: 8,
                padding: '7px 14px',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 6,
                color: 'white',
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              {saving ? 'Saving...' : 'Save Notes'}
            </button>
          </Card>

          {/* Resume */}
          {candidate.resume_text && (
            <Card title="Application / Resume">
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 12,
                color: 'var(--text-muted)',
                maxHeight: 300,
                overflowY: 'auto',
                lineHeight: 1.6,
              }}>
                {candidate.resume_text}
              </pre>
            </Card>
          )}
        </div>

        {/* Right column — conversations */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* SMS thread */}
          <Card title={`SMS Thread (${smsMessages.length})`}>
            {smsMessages.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>No SMS messages yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                {smsMessages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
              </div>
            )}
          </Card>

          {/* Email thread */}
          <Card title={`Email (${emailMessages.length})`}>
            {emailMessages.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>No emails yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                {emailMessages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
              </div>
            )}
          </Card>

          {/* Danger zone */}
          <Card title="Danger Zone">
            <button
              onClick={handleDelete}
              style={{
                padding: '7px 14px',
                background: 'transparent',
                border: '1px solid var(--danger)',
                borderRadius: 6,
                color: 'var(--danger)',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Delete Candidate
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--card)',
      borderRadius: 10,
      border: '1px solid var(--border)',
      padding: '14px 16px',
    }}>
      <h3 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function MessageBubble({ message: msg }: { message: Message }) {
  const isOutbound = msg.direction === 'outbound';
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isOutbound ? 'flex-end' : 'flex-start',
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '8px 12px',
        borderRadius: isOutbound ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
        background: isOutbound ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
        color: isOutbound ? 'white' : 'var(--text)',
        fontSize: 12.5,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {msg.body}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, padding: '0 4px' }}>
        {msg.channel === 'sms' ? '💬' : '📧'} {formatDate(msg.created_at)}
      </div>
    </div>
  );
}
