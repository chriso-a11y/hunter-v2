import React from 'react';
import { scoreColor } from '../lib/utils';

interface Props {
  score: number;
  size?: number;
}

export default function ScoreRing({ score, size = 36 }: Props) {
  const r = (size / 2) - 4;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = scoreColor(score);

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={3} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeDasharray={`${fill} ${circ - fill}`}
          strokeLinecap="round"
        />
      </svg>
      <span style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size < 40 ? 9 : 12,
        fontWeight: 700,
        color,
      }}>
        {score}
      </span>
    </div>
  );
}
