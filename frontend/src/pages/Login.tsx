import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, BriefcaseBusiness, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { DEMO_USERS, type Role } from '../types';
import { useApp } from '../store/AppContext';
import { apiEnabled, apiRequest, apiTokenKey } from '../utils/api';

type LoginResponse = { accessToken: string; mustChangePassword: boolean; user: { role: string; fullName: string } };
const uiRole = (role: string): Role => role === 'BDLead' ? 'BD Lead' : role as Role;

export default function Login() {
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get('email') ?? localStorage.getItem('bdcrm-remembered-email') ?? 'user@bdcrm.demo');
  const [rememberEmail, setRememberEmail] = useState(() => Boolean(localStorage.getItem('bdcrm-remembered-email')));
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset' | 'change'>(new URLSearchParams(window.location.search).has('token') ? 'reset' : 'login');
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { setRole, refreshFromApi } = useApp();

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    if (rememberEmail) localStorage.setItem('bdcrm-remembered-email', email); else localStorage.removeItem('bdcrm-remembered-email');
    try {
      if (mode === 'forgot') {
        await apiRequest('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
        setMessage('If this account is active, we sent a password reset link.');
      } else if (mode === 'reset') {
        await apiRequest('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, token: params.get('token') ?? '', newPassword }) });
        setMessage('Password reset. You can now sign in.'); setMode('login');
      } else if (mode === 'change') {
        await apiRequest('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: password, newPassword }) });
        sessionStorage.removeItem(apiTokenKey); setPassword(''); setNewPassword(''); setMessage('Password changed. Please sign in again.'); setMode('login');
      } else if (apiEnabled) {
        const response = await apiRequest<LoginResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        sessionStorage.setItem(apiTokenKey, response.accessToken); sessionStorage.setItem('bdcrm-api-role', uiRole(response.user.role)); sessionStorage.setItem('bdcrm-api-name', response.user.fullName); setRole(uiRole(response.user.role));
        if (!response.mustChangePassword) await refreshFromApi();
        if (response.mustChangePassword) setMode('change'); else nav('/');
      } else {
        const user = DEMO_USERS.find(item => item.email.toLowerCase() === email.toLowerCase());
        if (!user) throw new Error('Choose one of the demo accounts below.');
        sessionStorage.setItem('bdcrm-demo-session', 'true'); sessionStorage.setItem('bdcrm-demo-role', user.role); sessionStorage.setItem('bdcrm-demo-name', user.name);
        setRole(user.role); nav('/');
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to continue.'); }
    finally { setBusy(false); }
  }

  const heading = mode === 'forgot' ? 'Reset your password' : mode === 'reset' ? 'Choose a new password' : mode === 'change' ? 'Change your password' : 'Welcome back';
  const action = busy ? 'Please wait…' : mode === 'login' ? (apiEnabled ? 'Sign in' : 'Continue to demo') : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Reset password' : 'Save new password';

  return <main className="login-shell">
    <section className="login-story" aria-label="BD CRM overview">
      <div className="login-story-glow login-story-glow-one"/><div className="login-story-glow login-story-glow-two"/>
      <div className="login-brand"><span className="brand-mark"><span>bd</span><i/></span><span className="login-brand-copy"><b>BD CRM</b><small>RELATIONSHIP DESK</small></span></div>
      <div className="login-story-copy"><span className="login-kicker"><i/> BUSINESS DEVELOPMENT WORKSPACE</span><h1>Every relationship.<br/><em>Moving forward.</em></h1><p>Keep account intelligence, stakeholder conversations, and hiring opportunities connected in one clear workspace.</p>
        <div className="login-story-points"><div><UsersRound size={17}/><span><b>Know your network</b><small>See the people behind every account.</small></span></div><div><BriefcaseBusiness size={17}/><span><b>Move work forward</b><small>Track meetings, follow-ups, and open roles.</small></span></div></div>
      </div>
      <div className="login-story-footer"><ShieldCheck size={15}/> Secure access for your BD team <i/> Built for focused follow-through</div>
    </section>
    <section className="login-panel"><form className="login-form" onSubmit={submit}>
      <div className="login-identity"><span className="login-user-icon"><UserRound size={31} strokeWidth={1.65}/></span><span className="login-eyebrow">BD CRM · RELATIONSHIP DESK</span><h2>{heading}</h2><p>{mode === 'login' ? 'Sign in to continue to your relationship desk.' : mode === 'forgot' ? 'Enter your work email and we’ll send a secure reset link.' : mode === 'reset' ? 'Create a new password for your account.' : 'Set a new password to secure your account.'}</p></div>
      {mode !== 'change' && <div className="login-line-field"><Mail size={17}/><input id="login-email" aria-label="Work email" type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" placeholder="Email ID"/>{mode === 'reset' && <input className="hidden" value={params.get('token') ?? ''} readOnly />}</div>}
      {(mode === 'change' || (mode === 'login' && apiEnabled)) && <div className="login-line-field"><LockKeyhole size={17}/><input id="login-password" aria-label={mode === 'change' ? 'Current password' : 'Password'} type={show ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} required autoComplete="current-password" placeholder={mode === 'change' ? 'Current password' : 'Password'}/><button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>}
      {(mode === 'reset' || mode === 'change') && <div className="login-line-field"><LockKeyhole size={17}/><input id="new-password" aria-label="New password" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={12} required autoComplete="new-password" placeholder="New password"/></div>}
      {(mode === 'reset' || mode === 'change') && <p className="login-password-hint">At least 12 characters, including uppercase, lowercase, a number, and a symbol.</p>}
      {error && <p role="alert" className="login-alert login-alert-error">{error}</p>}{message && <p role="status" className="login-alert login-alert-success">{message}</p>}
      {mode === 'login' && <div className="login-options"><label><input type="checkbox" checked={rememberEmail} onChange={event => setRememberEmail(event.target.checked)}/><span>Remember me</span></label>{apiEnabled && <button type="button" className="login-text-button" onClick={() => setMode('forgot')}>Forgot password?</button>}</div>}
      <button className="login-submit" disabled={busy}>{action}<ArrowRight size={17}/></button>
      {mode !== 'login' && mode !== 'change' && <button type="button" className="login-text-button" onClick={() => setMode('login')}>Back to sign in</button>}
      {!apiEnabled && mode === 'login' && <div className="demo-account-box"><div className="demo-account-heading"><span>DEMO ACCESS · NO PASSWORD NEEDED</span><small>Select a persona to sign in</small></div><div className="demo-account-list">{DEMO_USERS.map(user => <button type="button" key={user.email} className={email.toLowerCase() === user.email.toLowerCase() ? 'is-selected' : ''} aria-pressed={email.toLowerCase() === user.email.toLowerCase()} onClick={() => setEmail(user.email)}><span>{user.name}</span><small>{user.role}</small></button>)}</div><p>Demo changes are saved in this browser only. Demo mode does not verify passwords.</p></div>}
      <div className="login-footnote">BD CRM <i/> Relationship Desk</div>
    </form></section>
  </main>;
}
