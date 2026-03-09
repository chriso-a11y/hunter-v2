import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.settings.get().then(setSettings).finally(() => setLoading(false));
  }, []);

  const set = (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    await api.settings.update(settings).catch(console.error);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return <div style={{ padding: 32, color: 'var(--text-muted)' }}>Loading...</div>;

  const numVal = (key: string, fallback: number) => {
    const v = settings[key];
    return typeof v === 'number' ? v : fallback;
  };

  const boolVal = (key: string, fallback: boolean) => {
    const v = settings[key];
    return typeof v === 'boolean' ? v : fallback;
  };

  return (
    <div style={{ padding: '24px', maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Settings</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Section title="Candidate Scoring">
          <Field label="Minimum fit score to proceed (0–100)" hint="Candidates below this score get auto-declined">
            <input
              type="number"
              min={0} max={100}
              value={numVal('scoring_threshold', 30)}
              onChange={(e) => set('scoring_threshold', parseInt(e.target.value))}
            />
          </Field>
        </Section>

        <Section title="Calendar">
          <Field label="Days ahead to look for slots" hint="How many business days forward to search for interview times">
            <input
              type="number"
              min={1} max={30}
              value={numVal('calendar_days_ahead', 5)}
              onChange={(e) => set('calendar_days_ahead', parseInt(e.target.value))}
            />
          </Field>
          <Field label="Number of slots to offer" hint="How many time options to present to qualified candidates">
            <input
              type="number"
              min={1} max={5}
              value={numVal('calendar_slots_count', 3)}
              onChange={(e) => set('calendar_slots_count', parseInt(e.target.value))}
            />
          </Field>
          <Field label="Business hours start (hour, 0–23 CST)" hint="e.g., 9 = 9:00 AM">
            <input
              type="number"
              min={0} max={23}
              value={numVal('business_hours_start', 9)}
              onChange={(e) => set('business_hours_start', parseInt(e.target.value))}
            />
          </Field>
          <Field label="Business hours end (hour, 0–23 CST)" hint="e.g., 17 = 5:00 PM (slots will end by this time)">
            <input
              type="number"
              min={0} max={23}
              value={numVal('business_hours_end', 17)}
              onChange={(e) => set('business_hours_end', parseInt(e.target.value))}
            />
          </Field>
        </Section>

        <Section title="Notifications">
          <Field label="Telegram notifications" hint="Send interview alerts and candidate updates to Telegram">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={boolVal('notifications_enabled', true)}
                onChange={(e) => set('notifications_enabled', e.target.checked)}
              />
              <span>Enabled</span>
            </label>
          </Field>
        </Section>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '8px 20px',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 6,
              color: 'white',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {saved && <span style={{ color: 'var(--success)', fontSize: 13 }}>✓ Saved</span>}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '16px 18px',
    }}>
      <h3 style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{label}</label>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>{hint}</div>}
      {children}
    </div>
  );
}
