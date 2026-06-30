import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import '../css/pages/Login.css';

const DEMO_ACCOUNTS = [
  { role: 'Admin',    email: 'admin@agency.com',    password: 'Admin@123',    color: '#E8424A' },
  { role: 'Manager',  email: 'manager@agency.com',  password: 'Manager@123',  color: '#F47326' },
  { role: 'Employee', email: 'employee@agency.com', password: 'Employee@123', color: '#4A90E2' },
  { role: 'Client',   email: 'client@agency.com',   password: 'Client@123',   color: '#4caf7d' },
];

export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
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

  const quickLogin = async (e: string, p: string) => {
    setError('');
    setLoading(true);
    try {
      await login(e, p);
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
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', marginBottom: 4 }}>Welcome back</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 24 }}>Sign in to your workspace</p>

          {error && <div className="modal-error" style={{ marginBottom: 16 }}>{error}</div>}

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
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div style={{ paddingTop: 4 }}>
              <button type="submit" disabled={loading} className="login-submit">
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>

          {/* Demo quick-login */}
          <div className="login-demo">
            <p className="login-demo__label">Demo accounts</p>
            <div className="login-demo__grid">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.role}
                  className="login-demo__btn"
                  disabled={loading}
                  onClick={() => quickLogin(a.email, a.password)}
                >
                  <span className="login-demo__dot" style={{ background: a.color }} />
                  {a.role}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
