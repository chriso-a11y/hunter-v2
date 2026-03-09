import React from 'react';
import { CandidateState } from '../lib/api';
import { STATE_LABELS, STATE_COLORS } from '../lib/utils';

interface Props {
  state: CandidateState;
  size?: 'sm' | 'md';
}

export default function Badge({ state, size = 'md' }: Props) {
  const color = STATE_COLORS[state];
  return (
    <span style={{
      display: 'inline-block',
      padding: size === 'sm' ? '2px 6px' : '3px 8px',
      borderRadius: 12,
      fontSize: size === 'sm' ? 10 : 11,
      fontWeight: 600,
      background: `${color}22`,
      color,
      border: `1px solid ${color}44`,
      whiteSpace: 'nowrap',
    }}>
      {STATE_LABELS[state]}
    </span>
  );
}
