import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Candidate, CandidateState } from '../lib/api';
import { PIPELINE_COLUMNS, TERMINAL_STATES, STATE_LABELS, timeAgo } from '../lib/utils';
import Badge from '../components/Badge';
import ScoreRing from '../components/ScoreRing';

export default function Pipeline() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.candidates.list().then(setCandidates).finally(() => setLoading(false));
    const interval = setInterval(() => {
      api.candidates.list().then(setCandidates);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const byState = (state: CandidateState) =>
    candidates.filter((c) => c.state === state);

  const terminalCandidates = candidates.filter((c) =>
    TERMINAL_STATES.includes(c.state)
  );

  if (loading) {
    return (
      <div style={{ padding: 32, color: 'var(--text-muted)' }}>Loading pipeline...</div>
    );
  }

  return (
    <div style={{ padding: '20px 24px', height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Pipeline</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{candidates.length} total candidates</p>
        </div>
        <button
          onClick={() => setShowTerminal(!showTerminal)}
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 14px',
            color: 'var(--text-muted)',
            fontSize: 12,
          }}
        >
          {showTerminal ? 'Hide' : 'Show'} Closed ({terminalCandidates.length})
        </button>
      </div>

      {/* Kanban board */}
      <div style={{
        display: 'flex',
        gap: 12,
        overflowX: 'auto',
        flex: 1,
        paddingBottom: 8,
      }}>
        {PIPELINE_COLUMNS.map((col) => {
          const colCandidates = byState(col);
          return (
            <div key={col} style={{
              minWidth: 220,
              maxWidth: 260,
              background: 'var(--card)',
              borderRadius: 10,
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '100%',
            }}>
              <div style={{
                padding: '12px 14px 10px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {STATE_LABELS[col]}
                </span>
                <span style={{
                  background: 'var(--border)',
                  borderRadius: 10,
                  padding: '1px 8px',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                }}>
                  {colCandidates.length}
                </span>
              </div>
              <div style={{ padding: '8px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {colCandidates.map((c) => (
                  <CandidateCard key={c.id} candidate={c} onClick={() => navigate(`/candidates/${c.id}`)} />
                ))}
                {colCandidates.length === 0 && (
                  <div style={{ padding: '16px 8px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
                    Empty
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Terminal states */}
      {showTerminal && terminalCandidates.length > 0 && (
        <div style={{ background: 'var(--card)', borderRadius: 10, border: '1px solid var(--border)', padding: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-muted)' }}>
            Closed ({terminalCandidates.length})
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {terminalCandidates.map((c) => (
              <CandidateCard key={c.id} candidate={c} onClick={() => navigate(`/candidates/${c.id}`)} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CandidateCard({
  candidate: c,
  onClick,
  compact = false,
}: {
  candidate: Candidate;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: compact ? '8px 10px' : '10px 12px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        width: compact ? 200 : 'auto',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)';
        (e.currentTarget as HTMLDivElement).style.background = 'rgba(243,113,36,0.05)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <ScoreRing score={c.fit_score} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {c.name}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            {c.position_title ?? 'Unknown'}
          </div>
        </div>
      </div>
      {!compact && (
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Badge state={c.state} size="sm" />
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {timeAgo(c.created_at)}
          </span>
        </div>
      )}
      {compact && (
        <div style={{ marginTop: 4 }}>
          <Badge state={c.state} size="sm" />
        </div>
      )}
    </div>
  );
}
