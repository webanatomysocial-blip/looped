import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../services/api';
import '../css/pages/Login.css';


export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // "Forgot password?" — email a one-time reset link
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [resetMsg, setResetMsg] = useState('');

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setResetMsg(''); setLoading(true);
    try {
      const r = await authApi.forgotPassword(email);
      setResetMsg(r.data?.message || 'If an account exists for that email, a reset link has been sent.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not send the reset link. Try again.');
    } finally { setLoading(false); }
  };
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  if (user) return <Navigate to={user.role === 'client' ? '/projects' : '/dashboard'} replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo__icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L4 6v6c0 5.1 3.5 9.8 8 11 4.5-1.2 8-5.9 8-11V6L12 2z" fill="white" opacity="0.9"/>
              <path d="M9 12l2 2 4-4" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1>Workdeck</h1>
          <p>Agency Project Management</p>
        </div>

        <div className="card" style={{ padding: '28px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>{mode === 'login' ? 'Welcome back' : 'Reset your password'}</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 24 }}>{mode === 'login' ? 'Sign in to your workspace' : "Enter your account email and we'll send you a reset link."}</p>

          {error && <div className="modal-error" style={{ marginBottom: 16 }}>{error}</div>}

          {mode === 'forgot' ? (
            <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {resetMsg && <div role="status" style={{ fontSize: 13, color: '#166534', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, padding: '10px 12px' }}>{resetMsg} Check your inbox (and spam folder).</div>}
              <div>
                <label className="form-label" htmlFor="forgot-email">Email</label>
                <input id="forgot-email" type="email" className="form-input" placeholder="you@agency.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </div>
              <div style={{ paddingTop: 4 }}>
                <button type="submit" disabled={loading} className="login-submit">{loading ? 'Sending…' : 'Send reset link'}</button>
              </div>
              <button type="button" onClick={() => { setMode('login'); setError(''); setResetMsg(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ink-muted)', fontWeight: 600 }}>
                ← Back to sign in
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                placeholder="you@agency.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label className="form-label" htmlFor="login-password">Password</label>
                <button type="button" onClick={() => { setMode('forgot'); setError(''); setResetMsg(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent, #2563eb)', padding: 0 }}>
                  Forgot password?
                </button>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  style={{ paddingRight: 44 }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', color: 'var(--ink-muted)', padding: 0 }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div style={{ paddingTop: 4 }}>
              <button type="submit" disabled={loading} className="login-submit">
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
          )}


        </div>
      </div>
    </div>
  );
}
