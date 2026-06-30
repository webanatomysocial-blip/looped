import Layout from '../components/Layout/Layout';
import Header from '../components/Layout/Header';
import Avatar from '../components/UI/Avatar';
import { useAuth } from '../contexts/AuthContext';
import '../css/pages/Settings.css';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator', manager: 'Manager', employee: 'Employee', client: 'Client',
};

export default function Settings() {
  const { user } = useAuth();
  return (
    <Layout>
      <div className="page-wrap">
        <Header />
        <div style={{ marginBottom: 20 }}>
          <h2 className="page-title">Settings</h2>
          <p className="page-subtitle">Your account details</p>
        </div>

        <div className="settings-grid">
          <div className="settings-card">
            <p className="settings-card__title">Profile</p>
            <div className="settings-avatar-row">
              {user && <Avatar name={user.name} color={user.avatar_color} size="lg" />}
              <div className="settings-avatar-info">
                <p className="settings-avatar-info__name">{user?.name}</p>
                <span className="settings-avatar-info__role">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</span>
              </div>
            </div>

            <div className="settings-field">
              <p className="settings-field__label">Email</p>
              <p className="settings-field__value">{user?.email}</p>
            </div>
            <div className="settings-field">
              <p className="settings-field__label">Role</p>
              <div className={`settings-role-pill settings-role-pill--${user?.role}`}>
                {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
              </div>
            </div>
          </div>

          <div className="settings-card">
            <p className="settings-card__title">Account</p>
            <p style={{ fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
              Contact your admin to update your account details or change your password.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
