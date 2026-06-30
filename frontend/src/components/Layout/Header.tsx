import { Search, Plus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import '../../css/Layout/Header.css';

interface HeaderProps {
  greeting?: boolean;
  action?: { label: string; onClick: () => void };
}

export default function Header({ greeting = false, action }: HeaderProps) {
  const { user } = useAuth();

  return (
    <div className="page-header">
      <div>
        {greeting && user ? (
          <>
            <h1 className="page-header__greeting">Hi, {user.name.split(' ')[0]}!</h1>
            <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>Let's take a look at your projects today</p>
          </>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="page-header__search">
          <Search size={14} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Search anything...</span>
        </div>
        {action && (
          <button onClick={action.onClick} className="btn-primary">
            <Plus size={15} />
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
