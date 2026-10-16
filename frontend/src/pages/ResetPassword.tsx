import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { authApi } from '../services/api';
import '../css/pages/Login.css';

// Opened from the "Reset your password" email: choose a new password with the one-time token
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      const r = await authApi.resetPassword(token, password);
      setDone(r.data?.message || 'Password updated. You can now sign in.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not reset the password. Request a new link.');
    } finally { setLoading(false); }
  };

  const eye = (
    <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: 0 }}>
      {show ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="card" style={{ padding: '28px' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>Choose a new password</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 24 }}>At least 8 characters.</p>

          {!token && <div className="modal-error" style={{ marginBottom: 16 }}>This link is missing its reset code. Request a new one from the sign-in page.</div>}
          {error && <div className="modal-error" style={{ marginBottom: 16 }}>{error}</div>}

          {done ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div role="status" style={{ fontSize: 13, color: '#166534', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, padding: '10px 12px' }}>{done}</div>
              <Link to="/login" className="login-submit" style={{ textAlign: 'center', textDecoration: 'none' }}>Go to sign in</Link>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="form-label" htmlFor="new-password">New password</label>
                <div style={{ position: 'relative' }}>
                  <input id="new-password" type={show ? 'text' : 'password'} className="form-input" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" style={{ paddingRight: 44 }} required autoFocus />
                  {eye}
                </div>
              </div>
              <div>
                <label className="form-label" htmlFor="confirm-password">Confirm new password</label>
                <input id="confirm-password" type={show ? 'text' : 'password'} className="form-input" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required />
              </div>
              <div style={{ paddingTop: 4 }}>
                <button type="submit" disabled={loading || !token} className="login-submit">{loading ? 'Saving…' : 'Set new password'}</button>
              </div>
              <Link to="/login" style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-muted)', fontWeight: 600, textDecoration: 'none' }}>← Back to sign in</Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
