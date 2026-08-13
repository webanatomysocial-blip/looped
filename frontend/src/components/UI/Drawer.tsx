import { RiCloseLine } from 'react-icons/ri';

interface DrawerProps {
  title: string;
  label?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function Drawer({ title, label, onClose, children }: DrawerProps) {
  return (
    <div className="drawer-overlay">
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer-panel">
        <div className="drawer-header">
          {label && <div className="drawer-header__label">{label}</div>}
          <div className="drawer-header__row">
            <span className="drawer-header__title">{title}</span>
            <button type="button" className="drawer-close" onClick={onClose}>
              <RiCloseLine size={14} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
