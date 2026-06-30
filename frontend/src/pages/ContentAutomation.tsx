import { useState, useRef, KeyboardEvent } from 'react';
import { Sparkles, X, Copy, Check, RefreshCw } from 'lucide-react';
import Layout from '../components/Layout/Layout';
import Header from '../components/Layout/Header';
import { contentApi } from '../services/api';
import '../css/pages/ContentAutomation.css';

const CONTENT_TYPES = [
  { value: 'blog_post',   label: 'Blog Post' },
  { value: 'instagram',   label: 'Instagram Caption' },
  { value: 'facebook',    label: 'Facebook Post' },
  { value: 'twitter',     label: 'Twitter / X' },
  { value: 'linkedin',    label: 'LinkedIn Post' },
  { value: 'email',       label: 'Email Copy' },
  { value: 'whatsapp',    label: 'WhatsApp Broadcast' },
  { value: 'ad_copy',     label: 'Ad Copy' },
  { value: 'seo_meta',    label: 'SEO Meta Tags' },
  { value: 'newsletter',  label: 'Newsletter' },
];

const TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly',     label: 'Friendly' },
  { value: 'casual',       label: 'Casual' },
  { value: 'persuasive',   label: 'Persuasive' },
  { value: 'creative',     label: 'Creative' },
  { value: 'formal',       label: 'Formal' },
];

export default function ContentAutomation() {
  const [keywords, setKeywords]     = useState<string[]>([]);
  const [inputVal, setInputVal]     = useState('');
  const [contentType, setContentType] = useState('instagram');
  const [tone, setTone]             = useState('professional');
  const [extraContext, setExtraContext] = useState('');
  const [output, setOutput]         = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [copied, setCopied]         = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addKeyword = (raw: string) => {
    const word = raw.trim().replace(/,+$/, '');
    if (word && !keywords.includes(word)) {
      setKeywords((k) => [...k, word]);
    }
    setInputVal('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addKeyword(inputVal);
    } else if (e.key === 'Backspace' && !inputVal && keywords.length) {
      setKeywords((k) => k.slice(0, -1));
    }
  };

  const removeKeyword = (kw: string) => setKeywords((k) => k.filter((w) => w !== kw));

  const generate = async () => {
    if (!keywords.length) { setError('Add at least one keyword.'); return; }
    setError('');
    setLoading(true);
    setOutput('');
    try {
      const res = await contentApi.generate({ keywords, content_type: contentType, tone, extra_context: extraContext });
      setOutput(res.data.content);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Generation failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const copyOutput = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Layout>
      <div className="page-wrap">
        <Header />
        <div className="ca-page">
          <div className="ca-page__left">
            <h2 className="page-title">Content Automation</h2>
            <p className="page-subtitle">Enter keywords and let AI generate ready-to-use content.</p>

            {/* Keywords */}
            <div className="ca-section">
              <label className="form-label">Keywords</label>
              <div
                className="ca-keyword-box form-input"
                onClick={() => inputRef.current?.focus()}
              >
                {keywords.map((kw) => (
                  <span key={kw} className="ca-keyword-pill">
                    {kw}
                    <button type="button" onClick={() => removeKeyword(kw)} className="ca-keyword-pill__remove">
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <input
                  ref={inputRef}
                  className="ca-keyword-input"
                  placeholder={keywords.length === 0 ? 'Type a keyword and press Enter or comma…' : ''}
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={() => { if (inputVal.trim()) addKeyword(inputVal); }}
                />
              </div>
            </div>

            {/* Content type */}
            <div className="ca-section">
              <label className="form-label">Content type</label>
              <div className="ca-type-grid">
                {CONTENT_TYPES.map((ct) => (
                  <button
                    key={ct.value}
                    type="button"
                    className={`ca-type-btn${contentType === ct.value ? ' active' : ''}`}
                    onClick={() => setContentType(ct.value)}
                  >
                    {ct.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tone */}
            <div className="ca-section">
              <label className="form-label">Tone</label>
              <div className="ca-tone-row">
                {TONES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    className={`ca-tone-btn${tone === t.value ? ' active' : ''}`}
                    onClick={() => setTone(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Extra context */}
            <div className="ca-section">
              <label className="form-label">Additional context <span className="ca-optional">(optional)</span></label>
              <textarea
                className="form-input"
                rows={3}
                style={{ resize: 'vertical' }}
                placeholder="e.g. target audience, brand voice, product details, CTA…"
                value={extraContext}
                onChange={(e) => setExtraContext(e.target.value)}
              />
            </div>

            {error && <p className="ca-error">{error}</p>}

            <button
              className="btn-primary ca-generate-btn"
              onClick={generate}
              disabled={loading}
            >
              {loading
                ? <><RefreshCw size={15} className="ca-spin" /> Generating…</>
                : <><Sparkles size={15} /> Generate content</>}
            </button>
          </div>

          {/* Output */}
          <div className="ca-page__right">
            <div className="ca-output-card">
              <div className="ca-output-header">
                <span className="ca-output-label">
                  {output ? CONTENT_TYPES.find((c) => c.value === contentType)?.label : 'Output'}
                </span>
                {output && (
                  <div className="ca-output-actions">
                    <button className="ca-icon-btn" onClick={generate} title="Regenerate">
                      <RefreshCw size={14} />
                    </button>
                    <button className="ca-icon-btn" onClick={copyOutput} title="Copy">
                      {copied ? <Check size={14} style={{ color: 'var(--green)' }} /> : <Copy size={14} />}
                    </button>
                  </div>
                )}
              </div>
              <div className="ca-output-body">
                {loading && (
                  <div className="ca-loading">
                    <div className="ca-loading__dots">
                      <span /><span /><span />
                    </div>
                    <p>Generating content…</p>
                  </div>
                )}
                {!loading && !output && (
                  <div className="ca-empty">
                    <Sparkles size={32} className="ca-empty__icon" />
                    <p>Add keywords and click <strong>Generate content</strong></p>
                  </div>
                )}
                {!loading && output && (
                  <pre className="ca-output-text">{output}</pre>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
