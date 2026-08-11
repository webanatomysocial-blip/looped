import { useState, FormEvent } from 'react';

export default function CreateBox({
  placeholder,
  buttonLabel,
  onCreate,
}: {
  placeholder: string;
  buttonLabel: string;
  onCreate: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) { setError("Name can't be empty."); return; }
    setError('');
    setBusy(true);
    try {
      await onCreate(value.trim());
      setValue('');
    } catch {
      setError('Something went wrong. Try again.');
    }
    setBusy(false);
  }

  return (
    <form className="cf-create-row" onSubmit={handleSubmit}>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoFocus />
      <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating...' : buttonLabel}</button>
      {error && <p className="cf-error">{error}</p>}
    </form>
  );
}
