import { useState } from 'react';
import Modal from '../UI/Modal';

export default function ConfirmDeleteModal({
  itemName,
  requireTyped = false,
  onConfirm,
  onCancel,
}: {
  itemName: string;
  requireTyped?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const disabled = requireTyped && typed !== itemName;

  return (
    <Modal title="Delete?" onClose={onCancel} size="sm">
      <p className="cf-confirm-text">
        This will permanently delete <strong>{itemName}</strong>. This can't be undone.
      </p>
      {requireTyped && (
        <input
          placeholder={`Type "${itemName}" to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
        />
      )}
      <div className="cf-confirm-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-danger" disabled={disabled} onClick={onConfirm}>Delete</button>
      </div>
    </Modal>
  );
}
