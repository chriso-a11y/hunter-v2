import React from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import Pipeline from './pages/Pipeline';
import CandidateDetail from './pages/CandidateDetail';
import Positions from './pages/Positions';
import Settings from './pages/Settings';

const navItems = [
  { to: '/', label: '📋 Pipeline', end: true },
  { to: '/positions', label: '💼 Positions' },
  { to: '/settings', label: '⚙️ Settings' },
];

export default function App() {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        width: 'var(--sidebar-w)',
        background: 'var(--card)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>
            🎯 Hunter
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Frontline Adjusters
          </div>
        </div>
        <nav style={{ padding: '8px 0', flex: 1 }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }) => ({
                display: 'block',
                padding: '10px 16px',
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                background: isActive ? 'rgba(243, 113, 36, 0.08)' : 'transparent',
                borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                fontSize: 13,
                fontWeight: 500,
                textDecoration: 'none',
                transition: 'all 0.15s',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-dim)' }}>
          Hunter v2
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/" element={<Pipeline />} />
          <Route path="/candidates/:id" element={<CandidateDetail />} />
          <Route path="/positions" element={<Positions />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
