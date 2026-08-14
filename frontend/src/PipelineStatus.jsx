import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Loader2, CheckCircle, XCircle, Circle, Clock, ExternalLink,
  RefreshCw, GitBranch, AlertOctagon, MinusCircle
} from 'lucide-react';

// Bounded polling: live while a run is active, then stop. Never polls an idle
// pipeline forever — that would waste GitHub's rate limit (5000/hr per token).
const POLL_MS = 5000;
const MAX_POLL_MS = 10 * 60 * 1000; // safety cap: stop after 10 min regardless

// Map GitHub (status, conclusion) -> a visual kind.
function kindOf(status, conclusion) {
  if (status === 'completed') {
    if (conclusion === 'success') return 'ok';
    if (conclusion === 'failure' || conclusion === 'timed_out') return 'fail';
    if (conclusion === 'cancelled') return 'cancel';
    if (conclusion === 'skipped') return 'skip';
    return 'done';
  }
  if (status === 'in_progress') return 'run';
  return 'queued'; // queued | waiting | pending | requested
}

const VIS = {
  ok:     { color: '#34d399', label: 'Success' },
  fail:   { color: '#f87171', label: 'Failed' },
  cancel: { color: '#9ca3af', label: 'Cancelled' },
  skip:   { color: '#6b7280', label: 'Skipped' },
  done:   { color: '#9ca3af', label: 'Done' },
  run:    { color: '#60a5fa', label: 'Running' },
  queued: { color: '#fbbf24', label: 'Queued' },
  idle:   { color: 'var(--text-subtle)', label: 'Idle' },
};

function StatusIcon({ kind, size = 15 }) {
  const c = (VIS[kind] || VIS.idle).color;
  if (kind === 'ok')     return <CheckCircle size={size} color={c} />;
  if (kind === 'fail')   return <XCircle size={size} color={c} />;
  if (kind === 'cancel' || kind === 'skip') return <MinusCircle size={size} color={c} />;
  if (kind === 'run')    return <Loader2 size={size} color={c} className="spin" />;
  if (kind === 'queued') return <Clock size={size} color={c} />;
  return <Circle size={size} color={c} />;
}

function Pill({ kind }) {
  const v = VIS[kind] || VIS.idle;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 9px',
      borderRadius: '20px', fontSize: '11px', fontWeight: 600,
      color: v.color, background: `${v.color}1a`, border: `1px solid ${v.color}44`,
    }}>
      <StatusIcon kind={kind} size={11} /> {v.label}
    </span>
  );
}

// A job rendered as a horizontal chain of step-nodes (the "GitHub Actions" look).
function JobChain({ job }) {
  const jobKind = kindOf(job.status, job.conclusion);
  return (
    <div style={{ marginBottom: '14px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <StatusIcon kind={jobKind} />
          <span style={{ fontWeight: 600, fontSize: '13px' }}>{job.name}</span>
        </div>
        {job.html_url && (
          <a href={job.html_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-subtle)', textDecoration: 'none' }}>
            logs <ExternalLink size={11} />
          </a>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
        {(job.steps || []).map((s, i) => {
          const k = kindOf(s.status, s.conclusion);
          const c = (VIS[k] || VIS.idle).color;
          return (
            <React.Fragment key={s.number ?? i}>
              {i > 0 && <span style={{ width: '14px', height: '1px', background: 'var(--border-color)', flexShrink: 0 }} />}
              <span title={s.name} style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 9px',
                borderRadius: '6px', fontSize: '11px', color: c, background: `${c}12`,
                border: `1px solid ${c}33`, whiteSpace: 'nowrap', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                <StatusIcon kind={k} size={11} /> {s.name}
              </span>
            </React.Fragment>
          );
        })}
        {(!job.steps || job.steps.length === 0) && (
          <span style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>No steps reported yet…</span>
        )}
      </div>
    </div>
  );
}

/**
 * PipelineStatus — live view of the latest GitHub Actions run.
 *  props:
 *   - api: the axios instance (already carries the Cognito bearer token)
 *   - activeSignal: bump this number (e.g. after Push/Apply) to (re)start polling
 *   - title: optional heading
 *   - workflow: optional workflow file filter, e.g.
 *       "terraform-plan.yml,terraform-apply.yml" for the provisioning view, or
 *       "terraform-destroy.yml" for teardown. Without it, shows the newest run of
 *       ANY workflow — which is what caused a destroy run to bleed into the apply
 *       view, so both call sites should set this.
 */
export default function PipelineStatus({ api, activeSignal = 0, title = 'Live Pipeline', workflow = '' }) {
  const [data, setData]       = useState(null);   // { run, jobs }
  const [error, setError]     = useState('');
  const [polling, setPolling] = useState(false);
  const [lastAt, setLastAt]   = useState(null);
  const intervalRef = useRef(null);
  const startRef    = useRef(0);

  const load = useCallback(async () => {
    try {
      const qs = workflow ? `?workflow=${encodeURIComponent(workflow)}` : '';
      const res = await api.get(`/api/v1/github/latest-run${qs}`);
      setData(res.data); setError(''); setLastAt(new Date());
      return res.data?.run?.status || 'none';
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to load pipeline status.');
      return 'error';
    }
  }, [api, workflow]);

  const stop = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setPolling(false);
  }, []);

  const start = useCallback(async () => {
    stop();
    setPolling(true);
    startRef.current = Date.now();
    const st = await load();
    // Stop immediately if already finished, errored, or nothing running.
    if (st === 'completed' || st === 'error' || st === 'none') { setPolling(false); return; }
    intervalRef.current = setInterval(async () => {
      const s = await load();
      if (s === 'completed' || s === 'error' || Date.now() - startRef.current > MAX_POLL_MS) {
        stop();
      }
    }, POLL_MS);
  }, [load, stop]);

  // (Re)start whenever a run is triggered, and once on mount. Always clean up.
  useEffect(() => { start(); return stop; /* eslint-disable-next-line */ }, [activeSignal]);

  const run = data?.run;
  const jobs = data?.jobs || [];
  const runKind = run ? kindOf(run.status, run.conclusion) : 'idle';

  return (
    <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <GitBranch size={15} color="var(--accent-blue)" />
          <span style={{ fontWeight: 600, fontSize: '13px' }}>{title}</span>
          {polling && <Loader2 size={12} className="spin" color="var(--text-subtle)" />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {run?.html_url && (
            <a href={run.html_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-subtle)', textDecoration: 'none' }}>
              open in GitHub <ExternalLink size={11} />
            </a>
          )}
          <button onClick={start} disabled={polling} title="Refresh"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, cursor: polling ? 'default' : 'pointer', opacity: polling ? 0.5 : 1 }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: '7px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertOctagon size={13} /> {error}
        </div>
      )}

      {!error && !run && (
        <div style={{ fontSize: '12px', color: 'var(--text-subtle)', padding: '8px 0' }}>
          No pipeline runs yet. Trigger a plan or apply to see it here.
        </div>
      )}

      {!error && run && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontWeight: 600, fontSize: '13px' }}>{run.display_title || run.name}</span>
              {run.run_number != null && <span style={{ fontSize: '11px', color: 'var(--text-subtle)', fontFamily: "'Geist Mono', monospace" }}>#{run.run_number}</span>}
              {run.head_sha && <span style={{ fontSize: '11px', color: 'var(--text-subtle)', fontFamily: "'Geist Mono', monospace" }}>{run.head_sha}</span>}
            </div>
            <Pill kind={runKind} />
          </div>
          {jobs.map((job) => <JobChain key={job.id} job={job} />)}
          {jobs.length === 0 && (
            <div style={{ fontSize: '12px', color: 'var(--text-subtle)' }}>Waiting for jobs to start…</div>
          )}
        </>
      )}

      {lastAt && !error && (
        <div style={{ fontSize: '10px', color: 'var(--text-subtle)', marginTop: '6px', textAlign: 'right' }}>
          {polling ? 'Live · updating every 5s' : 'Updated'} {lastAt.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}