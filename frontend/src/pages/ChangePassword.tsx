// First-login password change. Shown whenever the server says the account must choose a new password.
import { useState, FormEvent } from 'react';
import api from '../services/api';

export default function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (next.length < 12) { setError('Use at least 12 characters.'); return; }
    if (next !== confirm) { setError('The two new passwords do not match.'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/auth/change-password', { current_password: current, new_password: next });
      localStorage.setItem('token', data.token);
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not change the password. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '80px auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Choose a new password</h1>
      <p style={{ marginBottom: 20, color: '#555' }}>For security, you must set a new password before you continue.</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} required className="form-input" />
        <input type="password" autoComplete="new-password" placeholder="New password (12+ characters)" value={next} onChange={(e) => setNext(e.target.value)} required className="form-input" />
        <input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className="form-input" />
        {error && <div role="alert" style={{ color: '#b00020' }}>{error}</div>}
        <button type="submit" disabled={busy} className="login-submit">{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </div>
  );
}
