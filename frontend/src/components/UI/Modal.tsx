import { ReactNode } from 'react';
import { RiCloseLine } from 'react-icons/ri';
import '../../css/UI/Modal.css';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** false: a click outside does not close it (forms, so typed work is not lost) */
  dismissible?: boolean;
}

export default function Modal({ title, onClose, children, size = 'md', dismissible = true }: ModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-backdrop" onClick={dismissible ? onClose : undefined} />
      <div className={`modal-box modal-box--${size}`}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button onClick={onClose} className="modal-close-btn">
            <RiCloseLine size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
