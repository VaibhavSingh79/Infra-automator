import React, { useState, useMemo, useEffect } from 'react';
import PipelineStatus from './PipelineStatus';
import { StatCard, Pill } from './ui';
import axios from 'axios';
import {
  Cloud, UploadCloud, FileText, CheckCircle, XCircle, Circle, Loader2, Server, Layout,
  GitBranch, Network, Shield, Database, Save, Trash2, AlertOctagon, Rocket,
  BookOpen, Settings, Key, ChevronDown, ChevronUp, Globe, Router, Terminal,
  Copy, Check, LogOut, Lock, MapPin
} from 'lucide-react';
import './App.css';

// ─── Config: all from env (Vite). No hardcoded account values. ───
const COGNITO_REGION    = import.meta.env.VITE_COGNITO_REGION;
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;
const COGNITO_POOL_ID   = import.meta.env.VITE_COGNITO_POOL_ID; // reserved for future use
const DEPLOY_ROLE_NAME  = import.meta.env.VITE_DEPLOY_ROLE_NAME || 'InfraOrchestrator-Deploy-Role';
const DEPLOY_BRANCH     = import.meta.env.VITE_DEPLOY_BRANCH || 'main';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 60000,
});

// ─── Cognito helpers ───
async function cognitoSignIn(email, password) {
  const res = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.__type || 'Authentication failed');
  if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') throw new Error('FORCE_CHANGE_PASSWORD');
  return data.AuthenticationResult;
}

async function cognitoSignUp(email, password) {
  const res = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.SignUp',
    },
    body: JSON.stringify({
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.__type || 'Sign up failed');
  return data;
}

async function cognitoConfirmSignUp(email, code) {
  const res = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.ConfirmSignUp',
    },
    body: JSON.stringify({
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.__type || 'Confirmation failed');
  return data;
}

// ─── Login Screen ───
function LoginScreen({ onLogin }) {
  const [tab, setTab]             = useState('signin');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [code, setCode]           = useState('');
  const [status, setStatus]       = useState('idle');
  const [error, setError]         = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const resetForm = () => { setError(''); setSuccessMsg(''); setPassword(''); setConfirmPw(''); setCode(''); };

  const handleSignIn = async () => {
    if (!email || !password) { setError('Enter your email and password.'); return; }
    if (!email.endsWith('@minfytech.com')) { setError('Access restricted to @minfytech.com accounts.'); return; }
    setStatus('loading'); setError('');
    try {
      const tokens = await cognitoSignIn(email, password);
      onLogin({ email, tokens });
    } catch (e) {
      setStatus('idle');
      if (e.message === 'FORCE_CHANGE_PASSWORD') {
        setError('Temporary password detected. Please sign up to set a permanent password.');
      } else if (e.message?.includes('not confirmed')) {
        setError('Account not confirmed. Check your email for the verification code.');
        setTab('verify');
      } else {
        setError(e.message || 'Login failed. Check your credentials.');
      }
    }
  };

  const handleSignUp = async () => {
    if (!email || !password || !confirmPw) { setError('All fields are required.'); return; }
    if (!email.endsWith('@minfytech.com')) { setError('Access restricted to @minfytech.com accounts.'); return; }
    if (password !== confirmPw) { setError('Passwords do not match.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (!/[A-Z]/.test(password)) { setError('Password must contain at least one uppercase letter.'); return; }
    if (!/[0-9]/.test(password)) { setError('Password must contain at least one number.'); return; }
    setStatus('loading'); setError('');
    try {
      await cognitoSignUp(email, password);
      setStatus('idle');
      setSuccessMsg(`Verification code sent to ${email}`);
      setTab('verify');
    } catch (e) {
      setStatus('idle');
      if (e.message?.includes('already exists') || e.message?.includes('UsernameExistsException')) {
        setError('An account with this email already exists. Try signing in.');
      } else {
        setError(e.message || 'Sign up failed.');
      }
    }
  };

  const handleVerify = async () => {
    if (!code || code.length !== 6) { setError('Enter the 6-digit code from your email.'); return; }
    setStatus('loading'); setError('');
    try {
      await cognitoConfirmSignUp(email, code);
      const tokens = await cognitoSignIn(email, password);
      onLogin({ email, tokens });
    } catch (e) {
      setStatus('idle');
      setError(e.message || 'Verification failed. Check the code and try again.');
    }
  };

  const tabStyle = (active) => ({
    flex: 1, padding: '9px', border: 'none', borderRadius: '6px', fontSize: '13px',
    fontWeight: '500', cursor: 'pointer', transition: 'all 0.15s',
    background: active ? 'var(--bg-elevated)' : 'transparent',
    color: active ? 'var(--text-main)' : 'var(--text-subtle)',
  });

  const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '7px', border: '0.5px solid var(--border-field)', background: 'var(--bg-field)', color: 'var(--text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-main)' }}>
      <div style={{ width: '100%', maxWidth: '380px', padding: '0 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '8px' }}>
            <Cloud color="var(--accent)" size={26} strokeWidth={2.5} />
            <span style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-main)', letterSpacing: '-0.4px' }}>InfraOrchestrator</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>Internal platform — Minfytech Engineering</p>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-color)', borderRadius: '12px', padding: '28px' }}>
          {tab !== 'verify' && (
            <div style={{ display: 'flex', background: 'var(--bg-field)', borderRadius: '8px', padding: '4px', marginBottom: '22px', border: '0.5px solid var(--border-color)' }}>
              <button style={tabStyle(tab === 'signin')} onClick={() => { setTab('signin'); resetForm(); }}>Sign In</button>
              <button style={tabStyle(tab === 'signup')} onClick={() => { setTab('signup'); resetForm(); }}>Sign Up</button>
            </div>
          )}

          {tab === 'verify' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
              <CheckCircle size={15} color="var(--btn-green)" />
              <span style={{ fontWeight: '500', fontSize: '14px' }}>Check your email</span>
            </div>
          )}

          {successMsg && (
            <div style={{ marginBottom: '16px', padding: '10px 12px', borderRadius: '7px', background: 'var(--success-bg)', border: '0.5px solid var(--success-border)', color: 'var(--btn-green)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}>
              <CheckCircle size={13} /> {successMsg}
            </div>
          )}

          {tab === 'signin' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>Work email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSignIn()} placeholder="you@minfytech.com" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSignIn()} placeholder="••••••••" style={inputStyle} />
              </div>
            </div>
          )}

          {tab === 'signup' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>Work email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@minfytech.com" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 chars, 1 uppercase, 1 number" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>Confirm password</label>
                <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSignUp()} placeholder="••••••••" style={inputStyle} />
              </div>
            </div>
          )}

          {tab === 'verify' && (
            <div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px', marginTop: 0 }}>
                We sent a 6-digit code to <strong style={{ color: 'var(--text-main)' }}>{email}</strong>. Enter it below to activate your account.
              </p>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>Verification code</label>
              <input type="text" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={e => e.key === 'Enter' && handleVerify()} placeholder="123456" maxLength={6}
                style={{ ...inputStyle, fontSize: '20px', fontFamily: "'Geist Mono', monospace", letterSpacing: '6px', textAlign: 'center' }} />
            </div>
          )}

          {error && (
            <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '7px', background: 'var(--warning-bg)', border: '0.5px solid var(--border-field)', color: 'var(--btn-danger)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '7px' }}>
              <AlertOctagon size={13} /> {error}
            </div>
          )}

          <button
            onClick={tab === 'signin' ? handleSignIn : tab === 'signup' ? handleSignUp : handleVerify}
            disabled={status === 'loading'}
            style={{ width: '100%', marginTop: '20px', padding: '11px', borderRadius: '7px', border: 'none', background: 'var(--accent)', color: '#0B0E14', fontSize: '13px', fontWeight: '600', cursor: status === 'loading' ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: status === 'loading' ? 0.7 : 1 }}
          >
            {status === 'loading' ? <Loader2 size={14} className="spin" /> : <Lock size={14} />}
            {status === 'loading' ? 'Please wait…' : tab === 'signin' ? 'Sign in' : tab === 'signup' ? 'Create account' : 'Verify & sign in'}
          </button>

          {tab === 'verify' && (
            <button onClick={() => { setTab('signup'); resetForm(); }} style={{ width: '100%', marginTop: '10px', padding: '8px', border: 'none', background: 'none', color: 'var(--text-subtle)', fontSize: '12px', cursor: 'pointer' }}>
              ← Back to sign up
            </button>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-subtle)', marginTop: '16px' }}>
          Access restricted to @minfytech.com accounts only
        </p>
      </div>
    </div>
  );
}

// ── Helpers ──
function deriveResourceCounts(generatedFiles, vpcArray) {
  const files = Array.isArray(generatedFiles) ? generatedFiles : [];
  const tfFiles = files.filter(f => f && (f.endsWith('.tf') || f.includes('.tf')));
  let subnetCount = 0, natCount = 0, igwCount = 0, rtCount = 0;
  vpcArray.forEach(vpc => {
    subnetCount += vpc.subnets?.length || 0;
    if (vpc.nat_gateway === true || String(vpc.nat_gateway).toLowerCase() === 'yes') { natCount += 1; rtCount += 2; } else { rtCount += 1; }
    igwCount += 1;
  });
  return { vpcCount: vpcArray.length, subnetCount, natCount, igwCount, rtCount, tfFileCount: tfFiles.length };
}

// Neutral chip — no rainbow. Used for VPC/NAT/IGW/count tags.
function Tag({ children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: '5px', fontSize: '10px', fontWeight: 500,
      background: 'var(--bg-field)', color: 'var(--text-muted)',
      border: '0.5px solid var(--border-field)', fontFamily: "'Geist Mono', monospace",
    }}>{children}</span>
  );
}

function StatusBanner({ status, message }) {
  if (!message) return null;
  const cfg = {
    error:   { color: 'var(--btn-danger)', bg: 'var(--warning-bg)',  border: 'var(--border-field)',  icon: <AlertOctagon size={14}/> },
    warning: { color: 'var(--warning-text)',bg: 'var(--warning-bg)',  border: 'var(--border-field)',  icon: <AlertOctagon size={14}/> },
    success: { color: 'var(--btn-green)',  bg: 'var(--success-bg)',   border: 'var(--success-border)', icon: <CheckCircle size={14}/> },
  };
  const s = cfg[status] || cfg.success;
  return (
    <div style={{ marginTop: '14px', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', background: s.bg, color: s.color, border: `0.5px solid ${s.border}` }}>
      {s.icon}{message}
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: '10px', color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: '500', marginBottom: '8px' }}>{children}</div>;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <button onClick={handleCopy} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '5px', border: '0.5px solid var(--border-field)', background: copied ? 'var(--success-bg)' : 'var(--bg-elevated)', color: copied ? 'var(--btn-green)' : 'var(--text-muted)', fontSize: '11px', fontWeight: '500', cursor: 'pointer', transition: 'all 0.15s' }}>
      {copied ? <Check size={11} /> : <Copy size={11} />}{copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// Cross-account setup. Creates InfraOrchestrator-Deploy-Role (the fixed name the
// backend expects), trusting the central orchestrator role.
function CrossAccountSetup({ centralOidcRoleArn, repoUrl, patToken, onArnConfirmed }) {
  const [accountId, setAccountId]         = useState('');
  const [crossRoleArn, setCrossRoleArn]   = useState('');
  const [setupStatus, setSetupStatus]     = useState('idle');
  const [setupMessage, setSetupMessage]   = useState('');
  const [scriptVisible, setScriptVisible] = useState(false);

  const derivedArn = accountId ? `arn:aws:iam::${accountId}:role/${DEPLOY_ROLE_NAME}` : '';

  const setupScript = accountId ? `ROLE_NAME="${DEPLOY_ROLE_NAME}"
CENTRAL_ROLE="${centralOidcRoleArn}"

TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"'"$CENTRAL_ROLE"'"},"Action":"sts:AssumeRole"}]}'

if aws iam get-role --role-name "$ROLE_NAME" > /dev/null 2>&1; then
  echo "Role exists - updating trust policy..."
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST"
else
  echo "Creating $ROLE_NAME..."
  aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "$TRUST" \\
    --description "Assumed by InfraOrchestrator central role to deploy Terraform"
fi

# Demo default: PowerUserAccess. Scope down to only what you provision.
aws iam attach-role-policy --role-name "$ROLE_NAME" \\
  --policy-arn "arn:aws:iam::aws:policy/PowerUserAccess" 2>/dev/null || true

echo ""
echo "Done. Your deploy role ARN:"
echo "arn:aws:iam::${accountId}:role/${DEPLOY_ROLE_NAME}"` : '';

  const handleGenerateScript = () => {
    if (!accountId || !/^\d{12}$/.test(accountId.trim())) { setSetupStatus('error'); setSetupMessage('Enter a valid 12-digit AWS Account ID.'); return; }
    setScriptVisible(true); setSetupStatus('idle'); setSetupMessage(''); setCrossRoleArn(derivedArn);
  };

  const handleConfirmSetup = async () => {
    if (!crossRoleArn) { setSetupStatus('error'); setSetupMessage('Role ARN is required.'); return; }
    setSetupStatus('loading'); setSetupMessage('');
    try {
      const res = await api.post('/api/v1/git/setup-cross-account', { account_id: accountId, cross_account_role_arn: crossRoleArn, repo_url: repoUrl, pat_token: patToken });
      setSetupStatus('success');
      setSetupMessage(res.data.message || 'Cross-account role validated.');
      onArnConfirmed(accountId);
    } catch (e) {
      setSetupStatus('error');
      setSetupMessage(e.response?.data?.detail || e.message || 'Failed to confirm cross-account setup.');
    }
  };

  const isDone = setupStatus === 'success';

  return (
    <div className="card fade-in" style={{ borderColor: isDone ? 'var(--success-border)' : 'var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '5px' }}>
        <Terminal size={15} color={isDone ? 'var(--btn-green)' : 'var(--text-muted)'} />
        <span style={{ fontWeight: '500', fontSize: '14px' }}>Cross-account AWS setup</span>
        <Tag>one-time</Tag>
      </div>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '18px', marginTop: 0 }}>
        Lets InfraOrchestrator deploy Terraform into your AWS account via a trusted IAM role — no long-lived keys.
      </p>
      <div style={{ marginBottom: '14px' }}>
        <label style={{ display: 'block', marginBottom: '7px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>Step 1 — your target AWS account ID</label>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input type="text" value={accountId} onChange={e => { setAccountId(e.target.value.trim()); setScriptVisible(false); setCrossRoleArn(''); setSetupStatus('idle'); setSetupMessage(''); }} placeholder="123456789012" maxLength={12}
            style={{ flex: 1, padding: '10px 12px', borderRadius: '7px', border: '0.5px solid var(--border-field)', background: 'var(--bg-field)', color: 'var(--text-main)', fontSize: '13px', fontFamily: "'Geist Mono', monospace", outline: 'none', boxSizing: 'border-box' }} />
          <button onClick={handleGenerateScript} className="btn-github" style={{ whiteSpace: 'nowrap' }}>
            <Terminal size={13} /> Generate script
          </button>
        </div>
      </div>
      {scriptVisible && (
        <div className="fade-in" style={{ marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>Step 2 — run this once in your AWS account terminal</label>
            <CopyButton text={setupScript} />
          </div>
          <pre style={{ margin: 0, padding: '16px', borderRadius: '8px', background: 'var(--bg-field)', border: '0.5px solid var(--border-color)', color: 'var(--text-muted)', fontFamily: "'Geist Mono', monospace", fontSize: '11px', lineHeight: '1.65', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{setupScript}</pre>
          <p style={{ fontSize: '11px', color: 'var(--text-subtle)', marginTop: '8px', marginBottom: 0 }}>
            Requires AWS CLI with permission to create an IAM role in account <code>{accountId}</code>. Takes ~10 seconds.
          </p>
        </div>
      )}
      {scriptVisible && (
        <div className="fade-in">
          <label style={{ display: 'block', marginBottom: '7px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>Step 3 — confirm the deploy role ARN (auto-filled)</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input type="text" value={crossRoleArn} onChange={e => { setCrossRoleArn(e.target.value); setSetupStatus('idle'); setSetupMessage(''); }} placeholder={`arn:aws:iam::123456789012:role/${DEPLOY_ROLE_NAME}`}
              style={{ flex: 1, padding: '10px 12px', borderRadius: '7px', border: `0.5px solid ${isDone ? 'var(--success-border)' : 'var(--border-field)'}`, background: 'var(--bg-field)', color: isDone ? 'var(--btn-green)' : 'var(--text-main)', fontSize: '12px', fontFamily: "'Geist Mono', monospace", outline: 'none', boxSizing: 'border-box' }} />
            <button onClick={handleConfirmSetup} disabled={setupStatus === 'loading' || isDone}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', borderRadius: '7px', border: isDone ? '0.5px solid var(--success-border)' : 'none', background: isDone ? 'var(--success-bg)' : 'var(--btn-green)', color: isDone ? 'var(--btn-green)' : '#0B0E14', fontSize: '12px', fontWeight: '500', cursor: isDone ? 'default' : 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' }}>
              {setupStatus === 'loading' ? <Loader2 size={13} className="spin" /> : <CheckCircle size={13} />}
              {setupStatus === 'loading' ? 'Validating…' : isDone ? 'Confirmed' : 'Confirm setup'}
            </button>
          </div>
          <StatusBanner status={setupStatus} message={setupMessage} />
        </div>
      )}
    </div>
  );
}

// ─── Main App ───
export default function App() {
  const [user, setUser]                       = useState(null);
  const [targetAccountId, setTargetAccountId] = useState('');
  const [activeTab, setActiveTab]             = useState('provision');
  const [repoUrl, setRepoUrl]                 = useState('');
  const [patToken, setPatToken]               = useState('');
  const [configStatus, setConfigStatus]       = useState('idle');
  const [configMessage, setConfigMessage]     = useState('');
  const [hasVerified, setHasVerified] = useState(false);
  const [pipelineSignal, setPipelineSignal] = useState(0);

  const [file, setFile]                       = useState(null);
  const [loading, setLoading]                 = useState(false);
  const [result, setResult]                   = useState(null);
  const [jobId, setJobId]                     = useState(null);
  const [deploymentState, setDeploymentState] = useState('idle');
  const [gitStatus, setGitStatus]             = useState('');
  const [gitError, setGitError]               = useState(false);
  const [destroyFlowState, setDestroyFlowState] = useState('idle');
  const [destroyStatus, setDestroyStatus]     = useState('');
  const [destroyError, setDestroyError]       = useState(false);
  const [tfState, setTfState]                 = useState(null);
  const [stateLoading, setStateLoading]       = useState(false);
  const [stateSaving, setStateSaving]         = useState(false);
  const [stateStatus, setStateStatus]         = useState('');
  const [expandedVpc, setExpandedVpc]         = useState(null);

  const centralOidcRoleArn = import.meta.env.VITE_ORCHESTRATOR_ROLE_ARN || '';

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('infra_session');
      if (stored) {
        const { email, tokens } = JSON.parse(stored);
        const payload = JSON.parse(atob(tokens.AccessToken.split('.')[1]));
        if (payload.exp * 1000 > Date.now()) {
          api.defaults.headers.common['Authorization'] = `Bearer ${tokens.AccessToken}`;
          setUser({ email, tokens });
        } else {
          sessionStorage.removeItem('infra_session');
        }
      }
    } catch {
      sessionStorage.removeItem('infra_session');
    }
  }, []);

  const handleLogin = ({ email, tokens }) => {
    sessionStorage.setItem('infra_session', JSON.stringify({ email, tokens }));
    api.defaults.headers.common['Authorization'] = `Bearer ${tokens.AccessToken}`;
    setUser({ email, tokens });
  };

  const handleSignOut = () => {
    sessionStorage.removeItem('infra_session');
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
  };

  const vpcArray = result?.data_extracted?.vpcs || result?.vpcs || [];
  const counts = useMemo(() => deriveResourceCounts(result?.generated_files, vpcArray), [result]);
  const primaryRegion = vpcArray[0]?.region || null;

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  const inputBase = { width: '100%', padding: '10px 10px 10px 38px', borderRadius: '7px', border: '0.5px solid var(--border-field)', background: 'var(--bg-field)', color: 'var(--text-main)', boxSizing: 'border-box', fontSize: '13px' };

  const gitCreds = () => ({ repo_url: repoUrl, branch_name: DEPLOY_BRANCH, pat_token: patToken, commit_message: 'feat: auto-generated infrastructure from Excel' });

  const handleVerifyCredentials = async () => {
    if (!repoUrl || !patToken) { setConfigStatus('error'); setConfigMessage("Enter both Repository URL and PAT Token."); return; }
    setConfigStatus('loading'); setConfigMessage('');
    try {
      const res = await api.post("/api/v1/github/validate", { repo_url: repoUrl, branch_name: DEPLOY_BRANCH, pat_token: patToken });
      setConfigStatus(res.data.status); setConfigMessage(res.data.message);
      if (res.data.status === 'success') {
        setHasVerified(true);
        try { await api.post("/api/v1/git/bootstrap", { repo_url: repoUrl, branch_name: DEPLOY_BRANCH, pat_token: patToken, commit_message: "bootstrap" }); }
        catch (e) { console.warn("Bootstrap skipped:", e); }
      }
    } catch (e) { setConfigStatus('error'); setConfigMessage(e.response?.data?.detail || e.message || "Validation failed."); }
  };

  const handleFileChange = (e) => {
    if (e.target.files?.[0]) { setFile(e.target.files[0]); setResult(null); setJobId(null); setDeploymentState('idle'); setGitStatus(''); setExpandedVpc(null); }
  };

  const handleUpload = async () => {
    if (!file) return alert("Select an Excel file first.");
    if (!targetAccountId || !/^\d{12}$/.test(targetAccountId)) return alert("Complete the Cross-Account Setup (12-digit account ID) first.");
    if (!repoUrl) return alert("Enter and verify your GitHub repository first.");
    setLoading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("account_id", targetAccountId);
    fd.append("repo_url", repoUrl);
    try {
      const res = await api.post("/api/v1/upload/infrastructure-data", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(res.data);
      setJobId(res.data.job_id);
    } catch (e) { alert("Upload error: " + (e.response?.data?.detail || e.message)); }
    finally { setLoading(false); }
  };

  const handleGitPush = async () => {
    if (configStatus !== 'success') return alert("Verify GitHub connection first.");
    if (!jobId) return alert("Generate the infrastructure first.");
    setDeploymentState('planning'); setGitStatus(''); setGitError(false);
    try {
      const res = await api.post("/api/v1/git/push", { job_id: jobId, creds: gitCreds() });
      setGitStatus(res.data.message); setGitError(false); setDeploymentState('pending_approval');
      setPipelineSignal(s => s + 1);
    } catch (e) { setGitStatus(`Push failed: ${e.response?.data?.detail || e.message}`); setGitError(true); setDeploymentState('idle'); }
  };

  const handleApproveAndApply = async () => {
    setDeploymentState('applying'); setGitStatus(''); setGitError(false);
    try {
      const res = await api.post("/api/v1/github/apply", { repo_url: repoUrl, branch_name: DEPLOY_BRANCH, pat_token: patToken });
      setGitStatus(res.data.message); setGitError(false); setDeploymentState('success');
      setPipelineSignal(s => s + 1);
    } catch (e) { setGitStatus(`Apply failed: ${e.response?.data?.detail || e.message}`); setGitError(true); setDeploymentState('pending_approval'); }
  };

  const handleDestroy = async () => {
    if (configStatus !== 'success') return alert("Verify GitHub connection first.");
    if (!window.confirm("WARNING: This will permanently destroy all AWS resources. Are you absolutely sure?")) return;
    setDestroyFlowState('pending_approval'); setDestroyStatus('');
  };

  const handleApproveDestroy = async () => {
    setDestroyFlowState('destroying'); setDestroyStatus('Executing destruction pipeline…'); setDestroyError(false);
    try {
      const res = await api.post("/api/v1/git/destroy-trigger", { repo_url: repoUrl, branch_name: DEPLOY_BRANCH, pat_token: patToken });
      setDestroyStatus(res.data.message); setDestroyError(false); setDestroyFlowState('success');
      setPipelineSignal(s => s + 1);
    } catch (e) { setDestroyStatus(e.response?.data?.detail || e.message); setDestroyError(true); setDestroyFlowState('pending_approval'); }
  };

  const handleFetchState = async () => {
    setStateLoading(true); setStateStatus('');
    try { const res = await api.get("/api/v1/state/fetch"); setTfState(JSON.stringify(res.data.data, null, 2)); }
    catch (e) { setStateStatus(`Error: ${e.response?.data?.detail || e.message}`); }
    finally { setStateLoading(false); }
  };

  const handleSaveState = async () => {
    setStateSaving(true); setStateStatus('');
    try {
      const parsed = JSON.parse(tfState);
      const res = await api.post("/api/v1/state/update", { state_data: parsed });
      setStateStatus(`Saved — ${res.data.message} (serial ${res.data.new_serial})`);
    } catch (e) { setStateStatus(`Error: ${e.response?.data?.detail || e.message}`); }
    finally { setStateSaving(false); }
  };

  const steps = [
    { id: 'planning', label: 'Plan' },
    { id: 'pending_approval', label: 'Review' },
    { id: 'applying', label: 'Provision' },
    { id: 'success', label: 'Deployed' },
  ];
  const destroySteps = [
    { id: 'planning', label: 'Teardown plan' },
    { id: 'pending_approval', label: 'Review' },
    { id: 'destroying', label: 'Destroying' },
    { id: 'success', label: 'Removed' },
  ];

  // Horizontal stepper — icons, no emoji, one accent for active.
  function Stepper({ steps, currentState, dangerMode = false }) {
    const activeColor = dangerMode ? 'var(--btn-danger)' : 'var(--accent)';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '20px 0', flexWrap: 'wrap' }}>
        {steps.map((step, idx) => {
          const stateIdx = steps.findIndex(s => s.id === currentState);
          const isActive = currentState === step.id;
          const isPast = stateIdx > idx || (currentState === 'success' && step.id === 'success');
          let color = 'var(--text-subtle)';
          if (isActive) color = activeColor;
          if (isPast) color = 'var(--btn-green)';
          return (
            <React.Fragment key={step.id}>
              {idx > 0 && <span style={{ width: '18px', height: '0.5px', background: 'var(--border-field)' }} />}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color, fontWeight: isActive ? 500 : 400 }}>
                {isPast ? <CheckCircle size={14} /> : isActive ? <Loader2 size={14} className="spin" /> : <Circle size={14} />}
                {step.label}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  const navItems = [
    { id: 'provision', icon: <Layout size={15} />, label: 'Provisioning', group: 'Dashboard' },
    { id: 'state',     icon: <Database size={15} />, label: 'State', group: 'Dashboard' },
    { id: 'danger',    icon: <AlertOctagon size={15} />, label: 'Danger Zone', group: 'Settings' },
    { id: 'manual',    icon: <BookOpen size={15} />, label: 'Documentation', group: 'Resources' },
  ];

  return (
    <div className="app-wrapper">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Cloud color="var(--accent)" size={20} strokeWidth={2.5} />
          InfraOrchestrator
        </div>
        {['Dashboard', 'Settings', 'Resources'].map(group => (
          <React.Fragment key={group}>
            <div className="sidebar-heading">{group}</div>
            {navItems.filter(n => n.group === group).map(({ id, icon, label }) => (
              <div key={id} className={`nav-item ${activeTab === id ? 'active' : ''}`} onClick={() => setActiveTab(id)}>{icon} {label}</div>
            ))}
          </React.Fragment>
        ))}

        <div style={{ marginTop: 'auto', padding: '12px 6px 4px', borderTop: '0.5px solid var(--border-color)' }}>
          {configStatus === 'success' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: 'var(--btn-green)', marginBottom: '8px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--btn-green)' }} />
              Connected
            </div>
          )}
          <div style={{ fontSize: '11px', color: 'var(--text-subtle)', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
            {user.email}
          </div>
          <button onClick={handleSignOut} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-subtle)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <LogOut size={12} /> Sign out 
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div style={{ maxWidth: '1120px' }}>

        {activeTab === 'provision' && (
          <div className="fade-in">
            <div className="header" style={{ marginBottom: '18px' }}>
              <h1>Provisioning</h1>
              <p>Turn an Excel blueprint into deployed AWS infrastructure.</p>
            </div>

            {/* Status bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', border: '0.5px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '11px 16px', background: 'var(--bg-card)', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--text-subtle)', letterSpacing: '0.4px' }}>REPOSITORY</div>
                  <div style={{ fontSize: '13px', fontFamily: "'Geist Mono', monospace", color: 'var(--text-main)' }}>{repoUrl ? repoUrl.replace('https://github.com/', '') : '—'}</div>
                </div>
                {targetAccountId && (<><span style={{ width: '0.5px', height: '26px', background: 'var(--border-field)' }} />
                  <div><div style={{ fontSize: '10px', color: 'var(--text-subtle)', letterSpacing: '0.4px' }}>ACCOUNT</div><div style={{ fontSize: '13px', fontFamily: "'Geist Mono', monospace" }}>{targetAccountId}</div></div></>)}
                {primaryRegion && (<><span style={{ width: '0.5px', height: '26px', background: 'var(--border-field)' }} />
                  <div><div style={{ fontSize: '10px', color: 'var(--text-subtle)', letterSpacing: '0.4px' }}>REGION</div><div style={{ fontSize: '13px', fontFamily: "'Geist Mono', monospace" }}>{primaryRegion}</div></div></>)}
              </div>
              {configStatus === 'success'
                ? <Pill tone="success" icon={<CheckCircle size={11} />}>Verified</Pill>
                : <Pill tone="neutral">Not connected</Pill>}
            </div>

            {/* Config + cross-account split */}
            <div style={{ display: 'grid', gridTemplateColumns: hasVerified ? '1fr 1fr' : '1fr', gap: '14px', alignItems: 'start' }}>
              <div className="card" style={{ marginBottom: 0, borderColor: configStatus === 'success' ? 'var(--success-border)' : 'var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                    <Settings size={15} color={configStatus === 'success' ? 'var(--btn-green)' : 'var(--text-muted)'} />
                    <span style={{ fontWeight: '500', fontSize: '14px' }}>Configuration</span>
                  </div>
                  <button onClick={handleVerifyCredentials} disabled={configStatus === 'loading'} className="btn-github" style={{ padding: '6px 12px', fontSize: '12px' }}>
                    {configStatus === 'loading' ? <Loader2 size={13} className="spin" /> : configStatus === 'success' ? <CheckCircle size={13} color="var(--btn-green)" /> : <Cloud size={13} />}
                    {configStatus === 'loading' ? 'Verifying…' : configStatus === 'success' ? 'Verified' : 'Verify connection'}
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '7px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>Target GitHub repository</label>
                    <input type="text" value={repoUrl} onChange={e => { setRepoUrl(e.target.value); setConfigStatus('idle'); setConfigMessage(''); }} placeholder="https://github.com/username/repo-name"
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '7px', border: '0.5px solid var(--border-field)', background: 'var(--bg-field)', color: 'var(--text-main)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '7px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '500' }}>Personal access token</label>
                    <div style={{ position: 'relative' }}>
                      <input type="password" value={patToken} onChange={e => { setPatToken(e.target.value); setConfigStatus('idle'); setConfigMessage(''); }} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" style={{ ...inputBase }} />
                      <Key size={14} color="var(--text-subtle)" style={{ position: 'absolute', left: '12px', top: '11px', pointerEvents: 'none' }} />
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--text-subtle)', marginTop: '6px', marginBottom: 0 }}>Tokens are kept in browser memory only — never persisted.</p>
                  </div>
                </div>
                <StatusBanner status={configStatus} message={configMessage} />
              </div>

              {hasVerified && (
                <CrossAccountSetup
                  centralOidcRoleArn={centralOidcRoleArn}
                  repoUrl={repoUrl}
                  patToken={patToken}
                  onArnConfirmed={(acctId) => setTargetAccountId(acctId)}
                />
              )}
            </div>

            {/* Upload */}
            <div className="card">
              <div className="upload-zone">
                <input type="file" accept=".xlsx,.csv" onChange={handleFileChange} />
                <UploadCloud color={file ? 'var(--accent)' : 'var(--text-subtle)'} size={34} style={{ marginBottom: '10px' }} />
                <div style={{ fontWeight: '500', fontSize: '14px', color: file ? 'var(--text-main)' : 'var(--text-muted)' }}>{file ? file.name : 'Drag & drop Excel file here'}</div>
                {!file && <div style={{ fontSize: '12px', color: 'var(--text-subtle)', marginTop: '4px' }}>Supports .xlsx and .csv</div>}
              </div>
              <button className="btn-primary" onClick={handleUpload} disabled={loading || !file}>
                {loading ? <Loader2 size={15} className="spin" /> : <Layout size={15} />}
                {loading ? 'Parsing architecture…' : 'Generate infrastructure'}
              </button>
            </div>

            {(result || deploymentState !== 'idle') && (
              <div className="card fade-in">
                {result && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '18px' }}>
                      <CheckCircle color="var(--btn-green)" size={18} />
                      <span style={{ fontWeight: '500', fontSize: '15px', letterSpacing: '-0.2px' }}>Infrastructure blueprint ready</span>
                      <Tag>{counts.tfFileCount} TF files</Tag>
                    </div>
                    <div className="stats-grid">
                      <StatCard value={counts.vpcCount} label="VPCs" />
                      <StatCard value={counts.subnetCount} label="Subnets" />
                      <StatCard value={counts.natCount} label="NAT gateways" />
                      <StatCard value={counts.igwCount} label="Internet gateways" />
                      <StatCard value={counts.rtCount} label="Route tables" />
                      <StatCard value={counts.tfFileCount} label="TF files" />
                    </div>
                    {vpcArray.length > 0 && (
                      <div style={{ marginBottom: '20px' }}>
                        <SectionLabel>VPC resource details — click to expand</SectionLabel>
                        {vpcArray.map((vpc, idx) => {
                          const isOpen = expandedVpc === idx;
                          const publicSubs = (vpc.subnets || []).filter(s => s.route_table_association?.toLowerCase() === 'public');
                          const privateSubs = (vpc.subnets || []).filter(s => s.route_table_association?.toLowerCase() !== 'public');
                          const hasNat = vpc.nat_gateway === true || String(vpc.nat_gateway).toLowerCase() === 'yes';
                          const tfResources = [
                            'aws_vpc', 'aws_internet_gateway', 'aws_route_table.public',
                            ...(hasNat ? ['aws_eip', 'aws_nat_gateway', 'aws_route_table.private'] : []),
                            ...(vpc.subnets || []).map(s => `aws_subnet.${s.name}`),
                          ];
                          return (
                            <div key={idx} style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border-color)', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
                              <div onClick={() => setExpandedVpc(isOpen ? null : idx)} style={{ padding: '12px 15px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <Tag>VPC</Tag>
                                  <span style={{ fontWeight: '500', fontSize: '13px', fontFamily: "'Geist Mono', monospace" }}>{vpc.vpc_name}</span>
                                  <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: '12px', color: 'var(--accent)' }}>{vpc.vpc_cidr}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <span style={{ fontSize: '11px', color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: '4px' }}><MapPin size={11} />{vpc.region}</span>
                                  {hasNat && <Tag>NAT</Tag>}
                                  <Tag>IGW</Tag>
                                  <span style={{ color: 'var(--text-subtle)' }}>{isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                                </div>
                              </div>
                              {isOpen && (
                                <div style={{ borderTop: '0.5px solid var(--border-color)', padding: '16px 15px' }}>
                                  <div style={{ display: 'flex', gap: '26px', marginBottom: '16px', flexWrap: 'wrap' }}>
                                    {[{ label: 'Account', value: vpc.account_name }, { label: 'Org unit', value: vpc.organization_unit }, { label: 'Region', value: vpc.region }, { label: 'VPC CIDR', value: vpc.vpc_cidr, mono: true }, { label: 'NAT gateway', value: hasNat ? 'Yes' : 'No', color: hasNat ? 'var(--btn-green)' : 'var(--text-muted)' }, { label: 'Subnets', value: vpc.subnets?.length || 0 }].map((item, i) => (
                                      <div key={i}>
                                        <div style={{ fontSize: '9.5px', color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }}>{item.label}</div>
                                        <div style={{ fontSize: '13px', color: item.color || (item.mono ? 'var(--accent)' : 'var(--text-main)'), fontFamily: item.mono ? "'Geist Mono', monospace" : 'inherit', fontWeight: '500' }}>{item.value}</div>
                                      </div>
                                    ))}
                                  </div>
                                  <div style={{ marginBottom: '16px' }}>
                                    <SectionLabel>Terraform resources ({tfResources.length})</SectionLabel>
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                      {tfResources.map((r, i) => <Tag key={i}>{r}</Tag>)}
                                    </div>
                                  </div>
                                  {vpc.subnets?.length > 0 && (
                                    <div>
                                      <SectionLabel>Subnets — {publicSubs.length} public · {privateSubs.length} private</SectionLabel>
                                      <div style={{ borderRadius: '6px', overflow: 'hidden', border: '0.5px solid var(--border-color)' }}>
                                        <table className="resource-table">
                                          <thead><tr><th>Subnet name</th><th>CIDR block</th><th>Type</th><th>Public IP</th></tr></thead>
                                          <tbody>
                                            {vpc.subnets.map((subnet, si) => {
                                              const isPub = subnet.route_table_association?.toLowerCase() === 'public';
                                              return (
                                                <tr key={si}>
                                                  <td style={{ color: 'var(--text-main)' }}>{subnet.name}</td>
                                                  <td style={{ color: 'var(--accent-blue)' }}>{subnet.cidr}</td>
                                                  <td><span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '10px', background: isPub ? 'var(--success-bg)' : 'var(--bg-field)', color: isPub ? 'var(--btn-green)' : 'var(--text-muted)', border: `0.5px solid ${isPub ? 'var(--success-border)' : 'var(--border-field)'}`, fontWeight: '500' }}>{subnet.route_table_association || 'Private'}</span></td>
                                                  <td style={{ color: 'var(--text-subtle)' }}>{isPub ? 'Auto-assign' : 'Disabled'}</td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <hr />
                  </>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <div style={{ fontWeight: '500', fontSize: '14px', marginBottom: '3px' }}>Deployment pipeline</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Push generated Terraform and run via GitHub Actions.</div>
                  </div>
                  {deploymentState === 'idle' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {configStatus !== 'success' && <span style={{ fontSize: '12px', color: 'var(--warning-text)', display: 'flex', alignItems: 'center', gap: '5px' }}><AlertOctagon size={13} /> Verify connection first</span>}
                      <button className="btn-primary" style={{ marginTop: 0 }} onClick={handleGitPush} disabled={configStatus !== 'success' || !jobId}>
                        <GitBranch size={15} /> Run plan
                      </button>
                    </div>
                  )}
                </div>
                {deploymentState !== 'idle' && <Stepper steps={steps} currentState={deploymentState} />}
                {deploymentState === 'pending_approval' && (
                  <div style={{ padding: '16px', background: 'var(--bg-elevated)', borderRadius: '8px', border: '0.5px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}><CheckCircle size={14} color="var(--btn-green)" /> Plan completed. Ready for approval.</div>
                    <button onClick={handleApproveAndApply} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '9px 18px', borderRadius: '7px', border: 'none', background: 'var(--btn-green)', color: '#0B0E14', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>
                      <Rocket size={15} /> Approve & apply
                    </button>
                  </div>
                )}
                {gitStatus && (
                  <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: gitError ? 'var(--btn-danger)' : 'var(--btn-green)' }}>
                    {gitError ? <XCircle size={14} /> : <CheckCircle size={14} />}{gitStatus}
                  </div>
                )}
                {(jobId || deploymentState !== 'idle') && (
                  <PipelineStatus api={api} activeSignal={pipelineSignal}
                    workflow="terraform-plan.yml,terraform-apply.yml" />
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'state' && (
          <div className="fade-in">
            <div className="header" style={{ marginBottom: '18px' }}>
              <h1>State management</h1>
              <p>Pull and manually edit the raw Terraform state file from S3.</p>
            </div>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: tfState !== null ? '18px' : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                  <Database size={15} color="var(--text-muted)" />
                  <span style={{ fontWeight: '500', fontSize: '14px' }}>Terraform state editor</span>
                </div>
                <button onClick={handleFetchState} disabled={stateLoading} className="btn-github">
                  {stateLoading ? <Loader2 className="spin" size={14} /> : <Database size={14} />} Fetch state
                </button>
              </div>
              {stateStatus && (
                <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: stateStatus.startsWith('Error') ? 'var(--btn-danger)' : 'var(--btn-green)' }}>
                  {stateStatus.startsWith('Error') ? <XCircle size={14} /> : <CheckCircle size={14} />}{stateStatus}
                </div>
              )}
              {tfState !== null && (
                <div style={{ position: 'relative', marginTop: '16px' }}>
                  <textarea value={tfState} onChange={e => setTfState(e.target.value)} style={{ width: '100%', height: '460px', background: 'var(--bg-field)', color: 'var(--text-main)', fontFamily: "'Geist Mono', monospace", fontSize: '12px', padding: '16px', borderRadius: '8px', border: '0.5px solid var(--border-color)', boxSizing: 'border-box', resize: 'vertical', lineHeight: '1.6' }} />
                  <button onClick={handleSaveState} disabled={stateSaving} style={{ position: 'absolute', bottom: '16px', right: '16px', display: 'flex', alignItems: 'center', gap: '7px', padding: '8px 15px', borderRadius: '6px', border: 'none', background: 'var(--btn-green)', color: '#0B0E14', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                    {stateSaving ? <Loader2 className="spin" size={13} /> : <Save size={13} />} Save to S3
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'danger' && (
          <div className="fade-in">
            <div className="header" style={{ marginBottom: '18px' }}>
              <h1 style={{ color: 'var(--btn-danger)' }}>Danger Zone</h1>
              <p>Trigger a Terraform destroy to remove all provisioned AWS resources.</p>
            </div>
            <div className="card" style={{ borderColor: 'var(--border-field)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '3px' }}>
                    <AlertOctagon size={15} color="var(--btn-danger)" />
                    <span style={{ fontWeight: '500', fontSize: '14px', color: 'var(--btn-danger)' }}>Destroy infrastructure</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Removes everything tracked in Terraform state. Irreversible.</div>
                </div>
                {destroyFlowState === 'idle' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {configStatus !== 'success' && <span style={{ fontSize: '12px', color: 'var(--warning-text)' }}>Requires verified connection</span>}
                    <button onClick={handleDestroy} disabled={configStatus !== 'success'} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 16px', borderRadius: '7px', border: 'none', background: 'var(--btn-danger)', color: '#fff', fontWeight: '500', fontSize: '13px', cursor: configStatus !== 'success' ? 'not-allowed' : 'pointer', opacity: configStatus !== 'success' ? 0.4 : 1 }}>
                      <Trash2 size={15} /> Initiate teardown
                    </button>
                  </div>
                )}
              </div>
              {destroyFlowState !== 'idle' && <Stepper steps={destroySteps} currentState={destroyFlowState} dangerMode />}
              {destroyFlowState === 'pending_approval' && (
                <div style={{ padding: '16px', background: 'var(--warning-bg)', borderRadius: '8px', border: '0.5px solid var(--border-field)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ color: 'var(--btn-danger)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}><AlertOctagon size={14} /> Resources are ready to be permanently destroyed.</div>
                  <button onClick={handleApproveDestroy} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '9px 18px', borderRadius: '7px', border: 'none', background: 'var(--btn-danger)', color: '#fff', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>
                    <AlertOctagon size={15} /> Approve destruction
                  </button>
                </div>
              )}
              {destroyStatus && destroyFlowState !== 'pending_approval' && (
                <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: destroyError ? 'var(--btn-danger)' : (destroyFlowState === 'success' ? 'var(--btn-green)' : 'var(--text-muted)') }}>
                  {destroyError ? <XCircle size={14} /> : destroyFlowState === 'success' ? <CheckCircle size={14} /> : <Loader2 size={14} className="spin" />}{destroyStatus}
                </div>
              )}
              {destroyFlowState !== 'idle' && (
                <PipelineStatus api={api} activeSignal={pipelineSignal}
                  title="Live teardown" workflow="terraform-destroy.yml" />
              )}
            </div>
          </div>
        )}

        {activeTab === 'manual' && (
          <div className="fade-in">
            <div className="header" style={{ marginBottom: '18px' }}>
              <h1>Documentation</h1>
              <p>How the platform works, end to end.</p>
            </div>
            <div className="card">
              <div style={{ lineHeight: '1.75' }}>
                {[
                  { num: '01', title: 'Prerequisites', content: (
                    <ul style={{ color: 'var(--text-muted)', paddingLeft: '18px', margin: '8px 0 0' }}>
                      <li>Sign in with your <strong style={{ color: 'var(--text-main)' }}>@minfytech.com</strong> account.</li>
                      <li>Create an empty repository on GitHub.</li>
                      <li>Generate a fine-grained PAT scoped to that repo with <strong style={{ color: 'var(--text-main)' }}>contents</strong> and <strong style={{ color: 'var(--text-main)' }}>workflow</strong> access.</li>
                      <li>Have AWS CLI with permission to create an IAM role in your target account.</li>
                    </ul>
                  )},
                  { num: '02', title: 'Platform configuration', content: <p style={{ color: 'var(--text-muted)', margin: '8px 0 0' }}>Enter your GitHub repo URL and PAT, then click <strong style={{ color: 'var(--text-main)' }}>Verify connection</strong>. The platform bootstraps the GitOps workflows and sets their Actions variables using OIDC — no static AWS keys.</p> },
                  { num: '03', title: 'Cross-account AWS setup', content: <p style={{ color: 'var(--text-muted)', margin: '8px 0 0' }}>Enter your target AWS Account ID and click <strong style={{ color: 'var(--text-main)' }}>Generate script</strong>. Run the one-time script to create the <code>InfraOrchestrator-Deploy-Role</code>, which trusts the central orchestrator role. Confirm to validate. No long-lived keys.</p> },
                  { num: '04', title: 'Infrastructure generation', content: <p style={{ color: 'var(--text-muted)', margin: '8px 0 0' }}>Upload your Excel blueprint. The engine parses VPCs, subnets, NAT gateways and route tables into Terraform and returns a job token. Click any VPC row to expand the full resource breakdown.</p> },
                  { num: '05', title: 'CI/CD deployment lifecycle', content: (
                    <ul style={{ color: 'var(--text-muted)', paddingLeft: '18px', margin: '8px 0 0' }}>
                      <li><strong style={{ color: 'var(--text-main)' }}>Run plan</strong> — pushes the generated HCL to <code>main</code> and triggers a plan via GitHub Actions.</li>
                      <li><strong style={{ color: 'var(--text-main)' }}>Approve &amp; apply</strong> — triggers <code>terraform apply</code> via workflow_dispatch. Terraform applies only the delta against existing state.</li>
                    </ul>
                  )},
                  { num: '06', title: 'Security model', content: <p style={{ color: 'var(--text-muted)', margin: '8px 0 0' }}>Cognito handles authentication — only <strong style={{ color: 'var(--text-main)' }}>@minfytech.com</strong> accounts can sign up (enforced server-side). Every API request is validated against the Cognito JWT. Deployments run via GitHub OIDC into your own account — no static AWS credentials stored anywhere.</p> },
                  { num: '07', title: 'Infrastructure teardown', content: <p style={{ color: 'var(--text-muted)', margin: '8px 0 0' }}>The Danger Zone triggers <code>terraform destroy</code> via GitHub Actions, removing all provisioned resources tracked in Terraform state. Irreversible — requires confirmation.</p> },
                ].map(({ num, title, content }) => (
                  <div key={num} style={{ display: 'flex', gap: '16px', marginBottom: '22px' }}>
                    <div style={{ fontSize: '11px', fontWeight: '500', color: 'var(--text-subtle)', fontFamily: "'Geist Mono', monospace", minWidth: '24px', paddingTop: '2px' }}>{num}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '500', fontSize: '14px', color: 'var(--text-main)', marginBottom: '2px' }}>{title}</div>
                      {content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        </div>
      </main>
    </div>
  );
}