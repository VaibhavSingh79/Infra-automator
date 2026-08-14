import React from 'react';

/* StatCard — the quiet metric box (number + label). Flat, hairline
   border, one neutral color. No colored icons competing for attention. */
export function StatCard({ value, label }) {
  return (
    <div style={{
      border: '0.5px solid var(--border-color)',
      borderRadius: 'var(--radius-lg)',
      padding: '13px 15px',
      background: 'var(--bg-elevated)',
    }}>
      <div style={{ fontSize: '21px', fontWeight: 500, letterSpacing: '-0.4px', color: 'var(--text-main)' }}>{value}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{label}</div>
    </div>
  );
}

/* Pill — small status chip. `tone` decides the (semantic) color;
   default is a neutral gray chip. Orange 'accent' tone is reserved
   for the single running/active state. */
export function Pill({ children, tone = 'neutral', icon = null }) {
  const tones = {
    neutral: { color: 'var(--text-muted)', bg: 'var(--bg-field)',   border: 'var(--border-field)' },
    success: { color: 'var(--btn-green)',  bg: 'var(--success-bg)',  border: 'var(--success-border)' },
    accent:  { color: 'var(--accent)',     bg: 'var(--accent-bg)',   border: 'var(--accent-border)' },
    danger:  { color: 'var(--btn-danger)', bg: 'var(--warning-bg)',  border: 'var(--border-field)' },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      fontSize: '11px', color: t.color, background: t.bg,
      border: `0.5px solid ${t.border}`, padding: '2px 9px', borderRadius: '20px',
    }}>
      {icon}{children}
    </span>
  );
}