import { useState } from 'react';

export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '6px 14px' }} onClick={handleCopy}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
