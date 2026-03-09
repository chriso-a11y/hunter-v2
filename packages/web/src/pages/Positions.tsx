import React, { useEffect, useState } from 'react';
import { api, Position, KnockoutQuestion } from '../lib/api';

export default function Positions() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.positions.list().then(setPositions).finally(() => setLoading(false));
  }, []);

  const toggleStatus = async (pos: Position) => {
    const newStatus = pos.status === 'active' ? 'paused' : 'active';
    const updated = await api.positions.update(pos.id, { status: newStatus });
    setPositions((prev) => prev.map((p) => (p.id === pos.id ? updated : p)));
  };

  const handleSave = async (id: string, data: Partial<Position>) => {
    const updated = await api.positions.update(id, data);
    setPositions((prev) => prev.map((p) => (p.id === id ? updated : p)));
    setEditing(null);
  };

  const handleCreate = async (data: Partial<Position>) => {
    const created = await api.positions.create(data);
    setPositions((prev) => [...prev, created]);
    setCreating(false);
  };

  if (loading) return <div style={{ padding: 32, color: 'var(--text-muted)' }}>Loading...</div>;

  return (
    <div style={{ padding: '24px', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Positions</h1>
        <button
          onClick={() => setCreating(true)}
          style={{
            padding: '7px 16px',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 6,
            color: 'white',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          + New Position
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {positions.map((pos) =>
          editing === pos.id ? (
            <PositionEditor
              key={pos.id}
              position={pos}
              onSave={(data) => handleSave(pos.id, data)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <PositionCard
              key={pos.id}
              position={pos}
              onEdit={() => setEditing(pos.id)}
              onToggle={() => toggleStatus(pos)}
            />
          )
        )}
      </div>

      {creating && (
        <div style={{ marginTop: 16 }}>
          <PositionEditor
            onSave={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}
    </div>
  );
}

function PositionCard({
  position: pos,
  onEdit,
  onToggle,
}: {
  position: Position;
  onEdit: () => void;
  onToggle: () => void;
}) {
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '16px 18px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{pos.title}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
            {pos.department} · {pos.description}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={onToggle}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: `1px solid ${pos.status === 'active' ? 'var(--success)' : 'var(--border)'}`,
              background: 'transparent',
              color: pos.status === 'active' ? 'var(--success)' : 'var(--text-muted)',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {pos.status === 'active' ? '● Active' : '○ Paused'}
          </button>
          <button
            onClick={onEdit}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: 11,
            }}
          >
            Edit
          </button>
        </div>
      </div>

      {pos.knockout_questions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, marginBottom: 6 }}>
            KNOCKOUT QUESTIONS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pos.knockout_questions.map((q, i) => (
              <div key={i} style={{
                background: 'var(--bg)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span>{q.question}</span>
                <span style={{
                  fontSize: 10,
                  color: 'var(--danger)',
                  background: 'rgba(239,68,68,0.1)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  marginLeft: 8,
                  whiteSpace: 'nowrap',
                }}>
                  ✗ if "{q.disqualify_on}"
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PositionEditor({
  position,
  onSave,
  onCancel,
}: {
  position?: Position;
  onSave: (data: Partial<Position>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(position?.title ?? '');
  const [department, setDepartment] = useState(position?.department ?? 'sales');
  const [description, setDescription] = useState(position?.description ?? '');
  const [questions, setQuestions] = useState<KnockoutQuestion[]>(
    position?.knockout_questions ?? []
  );

  const addQuestion = () => {
    setQuestions([...questions, { question: '', disqualify_on: 'no' }]);
  };

  const updateQuestion = (i: number, field: keyof KnockoutQuestion, value: string) => {
    setQuestions(questions.map((q, idx) =>
      idx === i ? { ...q, [field]: value } : q
    ));
  };

  const removeQuestion = (i: number) => {
    setQuestions(questions.filter((_, idx) => idx !== i));
  };

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--accent)',
      borderRadius: 10,
      padding: '18px',
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
        {position ? 'Edit Position' : 'New Position'}
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sales Rep" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Department</label>
          <select value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="sales">Sales</option>
            <option value="office">Office</option>
            <option value="operations">Operations</option>
            <option value="management">Management</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Description</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of the role" />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>KNOCKOUT QUESTIONS</label>
          <button
            onClick={addQuestion}
            style={{ fontSize: 11, background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', color: 'var(--text-muted)' }}
          >
            + Add
          </button>
        </div>
        {questions.map((q, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <input
              value={q.question}
              onChange={(e) => updateQuestion(i, 'question', e.target.value)}
              placeholder="Question text..."
              style={{ flex: 1 }}
            />
            <select
              value={q.disqualify_on}
              onChange={(e) => updateQuestion(i, 'disqualify_on', e.target.value)}
              style={{ width: 80 }}
            >
              <option value="no">if no</option>
              <option value="yes">if yes</option>
            </select>
            <button
              onClick={() => removeQuestion(i)}
              style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 16, padding: '0 4px', flexShrink: 0 }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onSave({ title, department, description, knockout_questions: questions })}
          style={{
            padding: '7px 16px',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 6,
            color: 'white',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Save
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: '7px 16px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
