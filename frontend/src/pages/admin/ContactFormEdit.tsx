import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../../components/Layout/Layout';
import Breadcrumb from '../../components/ContactForms/Breadcrumb';
import CopyButton from '../../components/ContactForms/CopyButton';
import { contactFormsApi, appSettingsApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import '../../css/pages/ContactForms.css';

// ─── Types ───────────────────────────────────────────────────────────────────

type FieldType =
  | 'text' | 'email' | 'tel' | 'number' | 'url' | 'date' | 'time'
  | 'textarea' | 'select' | 'radio' | 'checkbox' | 'acceptance'
  | 'file' | 'password' | 'hidden' | 'html' | 'recaptcha' | 'recaptchav3' | 'step';

interface BuilderField {
  id: string;
  type: FieldType;
  label: string;
  placeholder: string;
  required: boolean;
  width: 25 | 50 | 75 | 100;
  hideLabel?: boolean;
  options?: string;      // comma-separated for select/radio
  selectPlaceholder?: string; // placeholder text for select
  defaultValue?: string; // for hidden / html content
}

interface FormStyle {
  labelColor: string;
  labelBg: string;
  inputBg: string;
  inputBorder: string;
  inputText: string;
  inputRadius: number;
  inputFocusBorder: string;
  placeholderColor: string;
  buttonBg: string;
  buttonHoverBg: string;
  buttonText: string;
  buttonRadius: number;
  formBg: string;
  fontFamily: string;
  submitLabel: string;
  successMessage: string;
}

const DEFAULT_STYLE: FormStyle = {
  labelColor: '#555555',
  labelBg: 'rgba(255,255,255,0.75)',
  inputBg: 'rgba(255,255,255,0.70)',
  inputBorder: 'rgba(255,255,255,0.85)',
  inputText: '#111111',
  inputRadius: 14,
  inputFocusBorder: '#111111',
  placeholderColor: '#aaaaaa',
  buttonBg: '#111111',
  buttonHoverBg: '#333333',
  buttonText: '#ffffff',
  buttonRadius: 99,
  formBg: '#EAEAEC',
  fontFamily: 'Inter, -apple-system, sans-serif',
  submitLabel: 'Send',
  successMessage: "Your message was sent successfully.\nWe'll be in touch soon.",
};

const FIELD_PALETTE: { type: FieldType; label: string; icon: string }[] = [
  { type: 'text',        label: 'Text',          icon: 'T'  },
  { type: 'email',       label: 'Email',         icon: '@'  },
  { type: 'textarea',    label: 'Textarea',      icon: '¶'  },
  { type: 'url',         label: 'URL',           icon: '🔗' },
  { type: 'tel',         label: 'Tel',           icon: '☎'  },
  { type: 'radio',       label: 'Radio',         icon: '◉'  },
  { type: 'select',      label: 'Select',        icon: '▾'  },
  { type: 'checkbox',    label: 'Checkbox',      icon: '☑'  },
  { type: 'acceptance',  label: 'Acceptance',    icon: '✓'  },
  { type: 'number',      label: 'Number',        icon: '#'  },
  { type: 'date',        label: 'Date',          icon: '📅' },
  { type: 'time',        label: 'Time',          icon: '⏱'  },
  { type: 'file',        label: 'File Upload',   icon: '📎' },
  { type: 'password',    label: 'Password',      icon: '🔒' },
  { type: 'html',        label: 'HTML',          icon: '<>' },
  { type: 'hidden',      label: 'Hidden',        icon: '👁' },
  { type: 'recaptcha',   label: 'reCAPTCHA',     icon: '🤖' },
  { type: 'recaptchav3', label: 'reCAPTCHA V3',  icon: '🛡' },
  { type: 'step',        label: 'Step',          icon: '→'  },
];

const WIDTH_OPTIONS: { label: string; value: 25 | 50 | 75 | 100 }[] = [
  { label: '¼', value: 25 },
  { label: '½', value: 50 },
  { label: '¾', value: 75 },
  { label: 'Full', value: 100 },
];

let uidCounter = 0;
function uid() { return `f${Date.now()}_${uidCounter++}`; }

// ─── HTML generator ──────────────────────────────────────────────────────────

function buildPreviewHtml(fields: BuilderField[], style: FormStyle): string {
  const inputStyles = `width:100%;padding:11px 16px;border:1.5px solid ${style.inputBorder};border-radius:${style.inputRadius}px;font-size:14px;font-family:${style.fontFamily};background:${style.inputBg};color:${style.inputText};box-shadow:0 1px 12px rgba(0,0,0,0.04);outline:none;box-sizing:border-box;`;
  const labelStyles = `display:inline-flex;align-items:center;font-size:11px;font-weight:700;color:${style.labelColor};letter-spacing:0.05em;text-transform:uppercase;background:${style.labelBg};border:1px solid rgba(228,228,232,0.9);border-radius:99px;padding:3px 10px;width:fit-content;margin-bottom:6px;`;

  const fieldHtml = fields.map((f) => {
    const wrapStyle = `width:${f.width}%;padding:4px 6px;box-sizing:border-box;`;
    const req = f.required ? ' required' : '';
    let input = '';

    if (f.type === 'textarea') {
      input = `<textarea name="${f.id}" placeholder="${f.placeholder}"${req} style="${inputStyles}min-height:110px;resize:vertical;line-height:1.6;"></textarea>`;

    } else if (f.type === 'select') {
      const opts = (f.options || '').split(',').map((o: string) => o.trim()).filter(Boolean);
      const ph = f.selectPlaceholder || f.placeholder || `Select ${f.label}`;
      const optHtml = `<option value="" disabled selected>${ph}</option>` + opts.map((o: string) => `<option value="${o}">${o}</option>`).join('');
      input = `<select name="${f.id}"${req} style="${inputStyles}">${optHtml}</select>`;

    } else if (f.type === 'radio') {
      const opts = (f.options || '').split(',').map((o: string) => o.trim()).filter(Boolean);
      const radioItems = opts.map((o: string) =>
        `<label style="display:flex;align-items:center;gap:8px;font-size:14px;color:${style.inputText};margin-bottom:6px;"><input type="radio" name="${f.id}" value="${o}"${req} style="width:16px;height:16px;margin:0;accent-color:${style.buttonBg};"> ${o}</label>`
      ).join('');
      input = `<div>${radioItems}</div>`;

    } else if (f.type === 'checkbox') {
      input = `<label style="display:flex;align-items:center;gap:8px;font-size:14px;color:${style.inputText};"><input type="checkbox" name="${f.id}"${req} style="width:16px;height:16px;margin:0;accent-color:${style.buttonBg};"> ${f.placeholder || f.label}</label>`;

    } else if (f.type === 'acceptance') {
      input = `<label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:${style.inputText};line-height:1.5;"><input type="checkbox" name="${f.id}"${req} style="width:16px;height:16px;margin-top:2px;flex-shrink:0;accent-color:${style.buttonBg};"> <span>${f.placeholder || 'I agree to the terms and conditions'}</span></label>`;

    } else if (f.type === 'html') {
      input = `<div style="font-size:14px;color:${style.inputText};line-height:1.6;">${f.defaultValue || '<p>HTML content here</p>'}</div>`;

    } else if (f.type === 'hidden') {
      input = `<input type="hidden" name="${f.id}" value="${f.defaultValue || ''}">`;

    } else if (f.type === 'recaptcha' || f.type === 'recaptchav3') {
      input = `<div style="display:inline-flex;align-items:center;gap:8px;border:1.5px solid ${style.inputBorder};border-radius:${style.inputRadius}px;padding:12px 16px;background:${style.inputBg};font-size:13px;color:${style.inputText};"><span>🤖</span> <span>${f.type === 'recaptchav3' ? 'reCAPTCHA V3 (invisible)' : 'I\'m not a robot'}</span></div>`;

    } else if (f.type === 'step') {
      return `<div style="width:100%;padding:4px 6px;box-sizing:border-box;"><div style="display:flex;align-items:center;gap:12px;padding:14px 0;border-top:2px solid ${style.inputBorder};"><span style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${style.labelColor};">— ${f.label || 'Next Step'} —</span></div></div>`;

    } else if (f.type === 'file') {
      const btnStyle = `display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border:1.5px dashed ${style.inputBorder};border-radius:${style.inputRadius}px;background:${style.inputBg};color:${style.inputText};font-size:13px;font-family:${style.fontFamily};cursor:pointer;width:100%;box-sizing:border-box;`;
      const nameStyle = `font-size:13px;color:${style.inputText};opacity:0.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;`;
      input = `<div style="width:100%;">
  <input type="file" id="${f.id}_input" name="${f.id}"${req} style="display:none;" onchange="document.getElementById('${f.id}_name').textContent=this.files[0]?this.files[0].name:'No file chosen'">
  <label for="${f.id}_input" style="${btnStyle}">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    <span>Choose file</span>
    <span id="${f.id}_name" style="${nameStyle}">No file chosen</span>
  </label>
</div>`;

    } else {
      // text, email, tel, number, url, date, time, password
      input = `<input type="${f.type}" name="${f.id}" placeholder="${f.placeholder}"${req} style="${inputStyles}">`;
    }

    // hidden fields render without label wrapper
    if (f.type === 'hidden') return `<div style="display:none;">${input}</div>`;

    const labelHtml = f.hideLabel ? '' : `<label style="${labelStyles}">${f.label}${f.required ? ' *' : ''}</label>`;
    return `<div style="${wrapStyle}">${labelHtml}<div>${input}</div></div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:${style.fontFamily};background:${style.formBg};padding:24px;-webkit-font-smoothing:antialiased;}
  form{display:flex;flex-wrap:wrap;margin:-4px -6px;max-width:640px;}
  .cf-submit-row{width:100%;padding:8px 6px 0;}
  button[type="submit"]{display:inline-flex;align-items:center;background:${style.buttonBg};color:${style.buttonText};border:none;border-radius:${style.buttonRadius}px;padding:11px 26px;font-size:13px;font-weight:600;font-family:${style.fontFamily};cursor:pointer;transition:background 0.15s;}
  button[type="submit"]:hover{background:${style.buttonHoverBg};}
  input:focus,textarea:focus,select:focus{border-color:${style.inputFocusBorder}!important;box-shadow:0 0 0 3px ${style.inputFocusBorder}22!important;}
  input::placeholder,textarea::placeholder{color:${style.placeholderColor};}
</style></head><body>
<form onsubmit="event.preventDefault()">
${fieldHtml}
<div class="cf-submit-row"><button type="submit">${style.submitLabel}</button></div>
</form>
</body></html>`;
}

function fieldsToSaveFormat(fields: BuilderField[]) {
  return fields.map(f => ({
    name: f.id,
    label: f.label,
    type: f.type,
    required: f.required,
    options: f.options,
    selectPlaceholder: f.selectPlaceholder,
    defaultValue: f.defaultValue,
    width: f.width,
    placeholder: f.placeholder,
    hideLabel: f.hideLabel,
  }));
}

function savedFieldsToBuilder(raw: any[]): BuilderField[] {
  return (raw || []).map(f => ({
    id: f.name || uid(),
    type: f.type || 'text',
    label: f.label || '',
    placeholder: f.placeholder || '',
    required: !!f.required,
    width: f.width || 100,
    options: f.options,
    selectPlaceholder: f.selectPlaceholder,
    defaultValue: f.defaultValue,
    hideLabel: !!f.hideLabel,
  }));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ContactFormEdit() {
  const { id, formId } = useParams<{ id: string; formId: string }>();
  const projectId = Number(id);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [form, setForm] = useState<any>(null);
  const [project, setProject] = useState<{ id: number; name: string } | null>(null);
  const [fields, setFields] = useState<BuilderField[]>([]);
  const [style, setStyle] = useState<FormStyle>(DEFAULT_STYLE);
  const [toEmails, setToEmails] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [otpEnabled, setOtpEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [confirmEmailField, setConfirmEmailField] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmAttachment, setConfirmAttachment] = useState<{ stored: string; original: string } | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [recaptchaKeys, setRecaptchaKeys] = useState({ recaptcha_site_key: '', recaptcha_secret_key: '', recaptcha_v3_site_key: '', recaptcha_v3_secret_key: '' });
  const [savingRecaptcha, setSavingRecaptcha] = useState(false);
  const [savedRecaptcha, setSavedRecaptcha] = useState(false);
  const [showRecaptchaSecrets, setShowRecaptchaSecrets] = useState<Record<string, boolean>>({});
  const [cloning, setCloning] = useState(false);
  const [formName, setFormName] = useState('');
  const [conditions, setConditions] = useState<Array<{ fieldId: string; operator: string; value: string; action: string; targetId: string }>>([]);
  const [tab, setTab] = useState<'builder' | 'style' | 'settings'>('builder');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // drag state
  const dragIdx = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);
  const dragInsertAfter = useRef<boolean>(false);
  const paletteType = useRef<FieldType | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ idx: number; after: boolean } | null>(null);

  useEffect(() => {
    contactFormsApi.getForm(Number(formId)).then((res) => {
      const data = res.data;
      setForm(data);
      setFormName(data.name || '');
      setToEmails(data.toEmails ?? data.to_emails ?? '');
      setRedirectUrl(data.redirect_url || '');
      setOtpEnabled(!!data.otp_enabled);
      setWebhookUrl(data.webhook_url || '');
      setConfirmEmailField(data.confirmation_email_field || '');
      setConfirmMessage(data.confirmation_message || '');
      setConditions(data.conditions || []);
      try { setConfirmAttachment(data.confirmation_attachment ? JSON.parse(data.confirmation_attachment) : null); } catch { setConfirmAttachment(null); }
      // load builder fields; fall back to parsing legacy template
      if (data.fields && data.fields.length > 0 && data.fields[0].width != null) {
        setFields(savedFieldsToBuilder(data.fields));
      } else if (data.fields && data.fields.length > 0) {
        setFields(savedFieldsToBuilder(data.fields));
      }
      // load style if stored in template as JSON comment
      if (data.style_config) {
        try { setStyle({ ...DEFAULT_STYLE, ...JSON.parse(data.style_config) }); } catch {}
      }
    });
    contactFormsApi.getProject(projectId).then((res) => setProject(res.data));
    if (isAdmin) appSettingsApi.get().then((r) => setRecaptchaKeys((prev) => ({ ...prev, ...r.data }))).catch(() => {});
  }, [projectId, formId]);

  const selectedField = fields.find(f => f.id === selectedId) ?? null;

  function updateSelected(patch: Partial<BuilderField>) {
    setFields(prev => prev.map(f => f.id === selectedId ? { ...f, ...patch } : f));
  }

  function removeSelected() {
    setFields(prev => prev.filter(f => f.id !== selectedId));
    setSelectedId(null);
  }

  function addFromPalette(type: FieldType) {
    const palEntry = FIELD_PALETTE.find(p => p.type === type);
    const label = palEntry?.label ?? type;
    const newField: BuilderField = {
      id: uid(), type, label,
      placeholder: type === 'acceptance' ? 'I agree to the terms and conditions' : label,
      required: type === 'acceptance' ? true : false,
      width: ['step', 'html', 'acceptance'].includes(type) ? 100 : 100,
      options: ['select', 'radio'].includes(type) ? 'Option 1, Option 2, Option 3' : undefined,
      selectPlaceholder: type === 'select' ? `Select ${label}` : undefined,
      defaultValue: type === 'html' ? '<p>Enter your HTML content here</p>' : undefined,
    };
    setFields(prev => [...prev, newField]);
    setSelectedId(newField.id);
  }

  // ── drag handlers (palette → canvas) ──
  function onPaletteDragStart(type: FieldType) { paletteType.current = type; dragIdx.current = null; }
  function onCanvasDragStart(i: number) { dragIdx.current = i; paletteType.current = null; }
  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    dragInsertAfter.current = after;
    dragOverIdx.current = i;
    setDropIndicator({ idx: i, after });
  }

  function onDrop(e: React.DragEvent, dropIdx: number) {
    e.preventDefault();
    e.stopPropagation();
    const insertIdx = dragInsertAfter.current ? dropIdx + 1 : dropIdx;
    if (paletteType.current) {
      const label = FIELD_PALETTE.find(p => p.type === paletteType.current!)?.label ?? String(paletteType.current);
      const newField: BuilderField = { id: uid(), type: paletteType.current!, label, placeholder: label, required: false, width: 100 };
      setFields(prev => { const next = [...prev]; next.splice(insertIdx, 0, newField); return next; });
      setSelectedId(newField.id);
      paletteType.current = null;
    } else if (dragIdx.current !== null && dragIdx.current !== dropIdx) {
      setFields(prev => {
        const next = [...prev];
        const [moved] = next.splice(dragIdx.current!, 1);
        // adjust index after removal
        const adj = dragInsertAfter.current && dragIdx.current! < dropIdx ? insertIdx - 1 : insertIdx;
        next.splice(adj, 0, moved);
        return next;
      });
      dragIdx.current = null;
    }
    dragOverIdx.current = null;
    setDropIndicator(null);
  }

  function onDropCanvas(e: React.DragEvent) {
    // dropped on empty canvas area = append
    e.preventDefault();
    if (paletteType.current) {
      addFromPalette(paletteType.current);
      paletteType.current = null;
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const fieldsToSave = fieldsToSaveFormat(fields);
    const styleJson = JSON.stringify(style);
    await contactFormsApi.updateForm(Number(formId), {
      fields: fieldsToSave,
      toEmails,
      template: '',
      redirectUrl,
      otpEnabled,
      style_config: styleJson,
      webhook_url: webhookUrl,
      confirmation_email_field: confirmEmailField,
      confirmation_message: confirmMessage,
      conditions: conditions.length ? conditions : null,
    });
    setSaving(false);
    setSaved(true);
  }

  if (!form) return <Layout><div className="cf-page"><p className="cf-empty">Loading...</p></div></Layout>;

  const previewHtml = buildPreviewHtml(fields, style);
  const embedSnippet = `<div id="wa-form-${formId}"></div>\n<script src="${window.location.origin}/embed.js" data-form-id="${formId}"></script>`;

  return (
    <Layout>
      <div className="cf-page">
        <Breadcrumb
          items={[
            { label: 'Contact Forms', href: '/contact-forms' },
            { label: project?.name || '...', href: `/contact-forms/${projectId}` },
            { label: formName || form.name },
          ]}
        />
        <div className="cf-header">
          <input
            className="cf-name-input"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            onBlur={async () => {
              const trimmed = formName.trim();
              if (!trimmed || trimmed === form.name) return;
              await contactFormsApi.updateForm(Number(formId), { name: trimmed });
              setForm((f: any) => ({ ...f, name: trimmed }));
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href={`/contact-forms/${projectId}/forms/${formId}/test`} className="btn-secondary">Test Form</a>
            <button className="btn-secondary" disabled={cloning} onClick={async () => {
              setCloning(true);
              try {
                const res = await contactFormsApi.cloneForm(projectId, Number(formId));
                window.location.href = `/contact-forms/${projectId}/forms/${res.data.id}`;
              } finally { setCloning(false); }
            }}>{cloning ? 'Cloning…' : 'Clone Form'}</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
            {saved && <span className="cf-saved" style={{ alignSelf: 'center' }}>Saved.</span>}
          </div>
        </div>

        <div className="cf-tabs">
          <button type="button" className={`cf-tab${tab === 'builder' ? ' cf-tab-active' : ''}`} onClick={() => setTab('builder')}>Form Builder</button>
          <button type="button" className={`cf-tab${tab === 'style' ? ' cf-tab-active' : ''}`} onClick={() => setTab('style')}>Style</button>
          <button type="button" className={`cf-tab${tab === 'settings' ? ' cf-tab-active' : ''}`} onClick={() => setTab('settings')}>Settings</button>
        </div>

        {tab === 'builder' && (
          <div className="cfb-layout">
            {/* Left: palette */}
            <div className="cfb-palette">
              <p className="cfb-palette-title">Field Types</p>
              <p className="cfb-palette-hint">Drag onto canvas or click to add</p>
              <div className="cfb-palette-grid">
                {FIELD_PALETTE.map(({ type, label, icon }) => (
                  <div
                    key={type}
                    className="cfb-palette-item"
                    draggable
                    onDragStart={() => onPaletteDragStart(type)}
                    onDragEnd={() => setDropIndicator(null)}
                    onClick={() => addFromPalette(type)}
                  >
                    <span className="cfb-palette-icon">{icon}</span>
                    <span className="cfb-palette-label">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Center: canvas */}
            <div className="cfb-center">
              <div
                className="cfb-canvas"
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDropCanvas}
              >
                {fields.length === 0 && (
                  <div className="cfb-canvas-empty">
                    <span>Drag fields here to build your form</span>
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', margin: '-4px -4px' }}>
                  {fields.map((f, i) => (
                    <div
                      key={f.id}
                      style={{ width: `${f.width}%`, padding: '4px', boxSizing: 'border-box', position: 'relative' }}
                      draggable
                      onDragStart={() => onCanvasDragStart(i)}
                      onDragOver={(e) => onDragOver(e, i)}
                      onDrop={(e) => onDrop(e, i)}
                      onDragEnd={() => setDropIndicator(null)}
                    >
                      {dropIndicator?.idx === i && !dropIndicator.after && (
                        <div style={{ position: 'absolute', top: 4, left: 4, right: 4, height: 3, background: 'var(--blue, #2563eb)', borderRadius: 2, zIndex: 10, pointerEvents: 'none' }} />
                      )}
                      {dropIndicator?.idx === i && dropIndicator.after && (
                        <div style={{ position: 'absolute', bottom: 4, left: 4, right: 4, height: 3, background: 'var(--blue, #2563eb)', borderRadius: 2, zIndex: 10, pointerEvents: 'none' }} />
                      )}
                      <div
                        className={`cfb-field-card${selectedId === f.id ? ' cfb-field-card--selected' : ''}`}
                        onClick={() => setSelectedId(f.id)}
                      >
                        <div className="cfb-field-card-top">
                          <span className="cfb-field-card-type">{f.type}</span>
                          <span className="cfb-field-card-width">{f.width}%</span>
                          <button
                            className="cfb-field-card-del"
                            onClick={(e) => { e.stopPropagation(); setFields(prev => prev.filter(x => x.id !== f.id)); if (selectedId === f.id) setSelectedId(null); }}
                            title="Remove"
                          >×</button>
                        </div>
                        <div className="cfb-field-card-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {f.label || <em style={{ color: '#aaa' }}>Untitled</em>}
                          {f.hideLabel && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', background: '#e0e0e0', color: '#777', borderRadius: 3, padding: '1px 5px', textTransform: 'uppercase' }}>no label</span>}
                        </div>
                        {f.placeholder && f.type !== 'checkbox' && (
                          <div className="cfb-field-card-placeholder">{f.placeholder}</div>
                        )}
                        {f.required && <span className="cfb-field-card-required">required</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="cfb-preview-box">
                <div className="cfb-preview-header">
                  <span className="cfb-preview-label">Live Preview</span>
                </div>
                <iframe title="preview" className="cfb-preview-frame" srcDoc={previewHtml} />
              </div>
            </div>

            {/* Right: field editor */}
            <div className="cfb-props">
              {selectedField ? (
                <>
                  <p className="cfb-props-title">Field Settings</p>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label className="cfb-prop-label">Label</label>
                      <input className="cfb-prop-input" value={selectedField.label} onChange={e => updateSelected({ label: e.target.value })} />
                    </div>
                  </div>

                  {!['html', 'hidden', 'recaptcha', 'recaptchav3', 'step', 'checkbox', 'acceptance'].includes(selectedField.type) && (
                    <label className="cfb-prop-label cfb-prop-toggle-row" style={{ marginTop: 2 }}>
                      <span>Hide Label</span>
                      <span className="cf-toggle-switch" style={{ marginLeft: 'auto' }}>
                        <input type="checkbox" checked={!!selectedField.hideLabel} onChange={e => updateSelected({ hideLabel: e.target.checked })} />
                        <span className="cf-toggle-thumb" />
                      </span>
                    </label>
                  )}

                  {!['html', 'hidden', 'recaptcha', 'recaptchav3', 'step', 'radio'].includes(selectedField.type) && (
                    <>
                      <label className="cfb-prop-label">{selectedField.type === 'checkbox' || selectedField.type === 'acceptance' ? 'Checkbox Text' : 'Placeholder'}</label>
                      <input className="cfb-prop-input" value={selectedField.placeholder} onChange={e => updateSelected({ placeholder: e.target.value })} />
                    </>
                  )}

                  <label className="cfb-prop-label">Width</label>
                  <div className="cfb-width-row">
                    {WIDTH_OPTIONS.map(w => (
                      <button
                        key={w.value}
                        type="button"
                        className={`cfb-width-btn${selectedField.width === w.value ? ' cfb-width-btn--active' : ''}`}
                        onClick={() => updateSelected({ width: w.value })}
                      >{w.label}</button>
                    ))}
                  </div>

                  <label className="cfb-prop-label">Type</label>
                  <select className="cfb-prop-input" value={selectedField.type} onChange={e => updateSelected({ type: e.target.value as FieldType })}>
                    {FIELD_PALETTE.map(p => <option key={p.type} value={p.type}>{p.label}</option>)}
                  </select>

                  {(selectedField.type === 'select' || selectedField.type === 'radio') && (
                    <>
                      <label className="cfb-prop-label">Options (comma-separated)</label>
                      <input className="cfb-prop-input" placeholder="Option A, Option B, Option C" value={selectedField.options || ''} onChange={e => updateSelected({ options: e.target.value })} />
                    </>
                  )}

                  {selectedField.type === 'select' && (
                    <>
                      <label className="cfb-prop-label">Select Placeholder</label>
                      <input className="cfb-prop-input" placeholder={`Select ${selectedField.label}`} value={selectedField.selectPlaceholder || ''} onChange={e => updateSelected({ selectPlaceholder: e.target.value })} />
                    </>
                  )}

                  {selectedField.type === 'html' && (
                    <>
                      <label className="cfb-prop-label">HTML Content</label>
                      <textarea className="cfb-prop-input" rows={5} style={{ resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12 }} value={selectedField.defaultValue || ''} onChange={e => updateSelected({ defaultValue: e.target.value })} />
                    </>
                  )}

                  {selectedField.type === 'hidden' && (
                    <>
                      <label className="cfb-prop-label">Default Value</label>
                      <input className="cfb-prop-input" placeholder="value" value={selectedField.defaultValue || ''} onChange={e => updateSelected({ defaultValue: e.target.value })} />
                    </>
                  )}

                  {!['html', 'hidden', 'recaptcha', 'recaptchav3', 'step'].includes(selectedField.type) && (
                    <label className="cfb-prop-label cfb-prop-toggle-row">
                      <span>Required</span>
                      <span className="cf-toggle-switch" style={{ marginLeft: 'auto' }}>
                        <input type="checkbox" checked={selectedField.required} onChange={e => updateSelected({ required: e.target.checked })} />
                        <span className="cf-toggle-thumb" />
                      </span>
                    </label>
                  )}

                  <button type="button" className="cfb-remove-btn" onClick={removeSelected}>Remove field</button>
                </>
              ) : (
                <div className="cfb-props-empty">
                  <p>Click a field on the canvas to edit its properties</p>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'style' && (
          <div className="cfb-style-layout">
            <div className="cfb-style-panel">
              <p className="cfb-palette-title">Form Style</p>

              <div className="cfb-style-grid">
                <StyleField label="Form Background">
                  <input type="color" className="cfb-color-swatch" value={style.formBg} onChange={e => setStyle(s => ({ ...s, formBg: e.target.value }))} />
                  <input className="cfb-prop-input cfb-color-text" value={style.formBg} onChange={e => setStyle(s => ({ ...s, formBg: e.target.value }))} />
                </StyleField>

                <StyleField label="Label Color">
                  <input type="color" className="cfb-color-swatch" value={style.labelColor} onChange={e => setStyle(s => ({ ...s, labelColor: e.target.value }))} />
                  <input className="cfb-prop-input cfb-color-text" value={style.labelColor} onChange={e => setStyle(s => ({ ...s, labelColor: e.target.value }))} />
                </StyleField>

                <StyleField label="Label Background">
                  <input type="color" className="cfb-color-swatch" value={rgbToHex(style.labelBg)} onChange={e => setStyle(s => ({ ...s, labelBg: e.target.value }))} />
                  <input className="cfb-prop-input cfb-color-text" value={style.labelBg} onChange={e => setStyle(s => ({ ...s, labelBg: e.target.value }))} />
                </StyleField>

                <StyleField label="Input Background">
                  <input type="color" className="cfb-color-swatch" value={rgbToHex(style.inputBg)} onChange={e => setStyle(s => ({ ...s, inputBg: e.target.value }))} />
                  <input className="cfb-prop-input cfb-color-text" value={style.inputBg} onChange={e => setStyle(s => ({ ...s, inputBg: e.target.value }))} />
                </StyleField>

                <StyleField label="Input Border Color">
                  <input type="color" className="cfb-color-swatch" value={rgbToHex(style.inputBorder)} onChange={e => setStyle(s => ({ ...s, inputBorder: e.target.value }))} />
                  <input className="cfb-prop-input cfb-color-text" value={style.inputBorder} onChange={e => setStyle(s => ({ ...s, inputBorder: e.target.value }))} />
                </StyleField>

                <StyleField label="Input Focus Border">
                  <input type="color" className="cfb-color-swatch" value={style.inputFocusBorder} onChange={e => setStyle(s => ({ ...s, inputFocusBorder: e.target.value }))} />
                  <input className="cfb-prop-input cfb-color-text" value={style.inputFocusBorder} onChange={e => setStyle(s => ({ ...s, inputFocusBorder: e.target.value }))} />
                </StyleField>

                <StyleField label="Input Text Color">
                  <input type="color" className="cfb-color-swatch" value={rgbToHex(style.inputText)} onChange={e => setStyle(s => ({ ...s, inputText: e.target.value }))} />
                  <input className="cfb-prop-input cfb-color-text" value={style.inputText} onChange={e => setStyle(s => ({ ...s, inputText: e.target.value }))} />
                </StyleField>

                <StyleField label="Placeholder Color">
                  <input type="color" className="cfb-color-swatch" value={rgbToHex(style.placeholderColor)} onChange={e => setStyle(s => ({ ...s, placeholderColor: e.target.value }))} />
                  <input className="cfb-prop-input cfb-color-text" value={style.placeholderColor} onChange={e => setStyle(s => ({ ...s, placeholderColor: e.target.value }))} />
                </StyleField>

                <StyleField label={`Input Border Radius (${style.inputRadius}px)`}>
                  <input type="range" min={0} max={30} value={style.inputRadius} onChange={e => setStyle(s => ({ ...s, inputRadius: Number(e.target.value) }))} style={{ width: '100%' }} />
                </StyleField>

                <StyleField label="Button Background">
                  <input type="color" className="cfb-color-swatch" value={rgbToHex(style.buttonBg)} onChange={e => setStyle(s => ({ ...s, buttonBg: e.target.value }))} />
                  <input className="cfb-prop-input cfb-color-text" value={style.buttonBg} onChange={e => setStyle(s => ({ ...s, buttonBg: e.target.value }))} />
                </StyleField>

                <StyleField label="Button Hover Color">
                  <input type="color" className="cfb-color-swatch" value={rgbToHex(style.buttonHoverBg)} onChange={e => setStyle(s => ({ ...s, buttonHoverBg: e.target.value }))} />
                  <input className="cfb-prop-input cfb-color-text" value={style.buttonHoverBg} onChange={e => setStyle(s => ({ ...s, buttonHoverBg: e.target.value }))} />
                </StyleField>

                <StyleField label="Button Text Color">
                  <input type="color" className="cfb-color-swatch" value={style.buttonText} onChange={e => setStyle(s => ({ ...s, buttonText: e.target.value }))} />
                  <input className="cfb-prop-input cfb-color-text" value={style.buttonText} onChange={e => setStyle(s => ({ ...s, buttonText: e.target.value }))} />
                </StyleField>

                <StyleField label={`Button Radius (${style.buttonRadius}px)`}>
                  <input type="range" min={0} max={99} value={style.buttonRadius} onChange={e => setStyle(s => ({ ...s, buttonRadius: Number(e.target.value) }))} style={{ width: '100%' }} />
                </StyleField>

                <StyleField label="Submit Button Label">
                  <input className="cfb-prop-input" value={style.submitLabel} onChange={e => setStyle(s => ({ ...s, submitLabel: e.target.value }))} />
                </StyleField>

                <StyleField label="Success Message">
                  <textarea className="cfb-prop-input" rows={3} value={style.successMessage ?? DEFAULT_STYLE.successMessage} onChange={e => setStyle(s => ({ ...s, successMessage: e.target.value }))} style={{ resize: 'vertical' }} />
                </StyleField>
              </div>

              <button type="button" className="cfb-reset-btn" onClick={() => setStyle(DEFAULT_STYLE)}>Reset to defaults</button>
            </div>

            <div className="cfb-style-preview">
              <div className="cfb-preview-header"><span className="cfb-preview-label">Preview</span></div>
              <iframe title="style-preview" className="cfb-preview-frame" srcDoc={previewHtml} />
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="cf-fields">
            <h2 className="cf-section-title">Recipients</h2>
            <input
              className="cf-recipients"
              placeholder="e.g. hello@yourdomain.com, team@yourdomain.com"
              value={toEmails}
              onChange={(e) => setToEmails(e.target.value)}
            />
            <p className="cf-hint">Comma-separated. Submissions from this form email here.</p>

            <h2 className="cf-section-title" style={{ marginTop: 28 }}>OTP Verification</h2>
            <label className="cf-toggle-row">
              <span className="cf-toggle-switch">
                <input type="checkbox" checked={otpEnabled} onChange={(e) => setOtpEnabled(e.target.checked)} />
                <span className="cf-toggle-thumb" />
              </span>
              <span className="cf-toggle-label">Require email OTP before submission</span>
            </label>
            <p className="cf-hint">When enabled, users must verify their email with a one-time code before they can submit.</p>

            <h2 className="cf-section-title" style={{ marginTop: 28 }}>Redirect URL</h2>
            <p className="cf-hint">After a successful submission, redirect the user to this URL. Leave blank to show the default success message.</p>
            <input
              className="cf-recipients"
              placeholder="https://example.com/thank-you"
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
            />

            <h2 className="cf-section-title" style={{ marginTop: 28 }}>Confirmation Email to Submitter</h2>
            <p className="cf-hint">Automatically send a thank-you reply to the person who submitted the form.</p>
            <label className="cf-label" style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600, marginTop: 10 }}>Email field name</label>
            <select
              className="cf-recipients"
              value={confirmEmailField}
              onChange={(e) => setConfirmEmailField(e.target.value)}
              style={{ marginBottom: 8 }}
            >
              <option value="">— Disabled —</option>
              {fields.filter((f) => f.type === 'email').map((f) => (
                <option key={f.id} value={f.id}>{f.label} ({f.id})</option>
              ))}
            </select>
            <label className="cf-label" style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Message body</label>
            <textarea
              className="cf-recipients"
              rows={4}
              placeholder="Thank you for reaching out! We'll get back to you shortly."
              value={confirmMessage}
              onChange={(e) => setConfirmMessage(e.target.value)}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
            <label className="cf-label" style={{ display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 600, marginTop: 10 }}>Attachment (optional)</label>
            <p className="cf-hint" style={{ marginBottom: 8 }}>A file attached to every confirmation email — e.g. a brochure, welcome guide, or price list.</p>
            {confirmAttachment ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-raised)', borderRadius: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13 }}>📎 {confirmAttachment.original}</span>
                <button
                  type="button"
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                  onClick={async () => {
                    await contactFormsApi.deleteConfirmAttachment(Number(formId));
                    setConfirmAttachment(null);
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: uploadingAttachment ? 'not-allowed' : 'pointer', opacity: uploadingAttachment ? 0.6 : 1 }}>
                <input
                  type="file"
                  style={{ display: 'none' }}
                  disabled={uploadingAttachment}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploadingAttachment(true);
                    try {
                      const res = await contactFormsApi.uploadConfirmAttachment(Number(formId), file);
                      setConfirmAttachment(res.data);
                    } finally { setUploadingAttachment(false); }
                    e.target.value = '';
                  }}
                />
                <span className="btn-secondary" style={{ pointerEvents: 'none' }}>
                  {uploadingAttachment ? 'Uploading…' : '↑ Upload File'}
                </span>
              </label>
            )}

            <h2 className="cf-section-title" style={{ marginTop: 28 }}>Webhook</h2>
            <p className="cf-hint">Send a POST request with submission data to this URL on every submission (Zapier, Make, etc.).</p>
            <input
              className="cf-recipients"
              type="url"
              autoComplete="off"
              placeholder="https://hooks.zapier.com/hooks/catch/..."
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />

            <h2 className="cf-section-title" style={{ marginTop: 28 }}>Conditional Logic</h2>
            <p className="cf-hint">Show or hide fields based on other field values. Rules are applied in the embedded form in real-time.</p>
            {conditions.map((cond, i) => {
              const update = (patch: Partial<typeof cond>) => setConditions(prev => prev.map((c, j) => j === i ? { ...c, ...patch } : c));
              const allFields = fields.filter(f => !['step', 'html', 'hidden', 'recaptcha', 'recaptchav3'].includes(f.type));
              return (
                <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px', background: 'var(--surface-raised)', borderRadius: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', minWidth: 24 }}>If</span>
                  <select className="cf-recipients" style={{ flex: 1, minWidth: 100, marginBottom: 0 }} value={cond.fieldId} onChange={e => update({ fieldId: e.target.value })}>
                    <option value="">— Field —</option>
                    {allFields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                  <select className="cf-recipients" style={{ flex: 1, minWidth: 100, marginBottom: 0 }} value={cond.operator} onChange={e => update({ operator: e.target.value })}>
                    <option value="equals">equals</option>
                    <option value="not_equals">not equals</option>
                    <option value="contains">contains</option>
                    <option value="not_empty">is not empty</option>
                    <option value="empty">is empty</option>
                  </select>
                  {!['not_empty', 'empty'].includes(cond.operator) && (
                    <input className="cf-recipients" style={{ flex: 1, minWidth: 80, marginBottom: 0 }} placeholder="value" value={cond.value} onChange={e => update({ value: e.target.value })} />
                  )}
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)' }}>then</span>
                  <select className="cf-recipients" style={{ minWidth: 70, marginBottom: 0 }} value={cond.action} onChange={e => update({ action: e.target.value })}>
                    <option value="show">show</option>
                    <option value="hide">hide</option>
                  </select>
                  <select className="cf-recipients" style={{ flex: 1, minWidth: 100, marginBottom: 0 }} value={cond.targetId} onChange={e => update({ targetId: e.target.value })}>
                    <option value="">— Field —</option>
                    {allFields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                  <button type="button" style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }} onClick={() => setConditions(prev => prev.filter((_, j) => j !== i))}>✕</button>
                </div>
              );
            })}
            <button type="button" className="btn-secondary" style={{ marginTop: 4 }} onClick={() => setConditions(prev => [...prev, { fieldId: '', operator: 'equals', value: '', action: 'show', targetId: '' }])}>
              + Add Condition
            </button>

            {isAdmin && (<>
            <h2 className="cf-section-title" style={{ marginTop: 28 }}>reCAPTCHA Keys</h2>
            <p className="cf-hint">Required when using reCAPTCHA fields in your forms. Keys are shared across all forms.</p>
            {([
              { key: 'recaptcha_site_key',      label: 'v2 Site Key' },
              { key: 'recaptcha_secret_key',    label: 'v2 Secret Key' },
              { key: 'recaptcha_v3_site_key',   label: 'v3 Site Key' },
              { key: 'recaptcha_v3_secret_key', label: 'v3 Secret Key' },
            ] as const).map(({ key, label }) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label className="cf-label" style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>{label}</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    className="cf-recipients"
                    type={showRecaptchaSecrets[key] ? 'text' : 'password'}
                    placeholder={label.includes('Site') ? '6Lc...' : 'Secret...'}
                    value={recaptchaKeys[key]}
                    onChange={(e) => setRecaptchaKeys({ ...recaptchaKeys, [key]: e.target.value })}
                    style={{ flex: 1, marginBottom: 0 }}
                  />
                  <button type="button" style={{ background: 'none', border: '1px solid var(--sand-border)', borderRadius: 6, padding: '0 10px', cursor: 'pointer', fontSize: 13 }} onClick={() => setShowRecaptchaSecrets({ ...showRecaptchaSecrets, [key]: !showRecaptchaSecrets[key] })}>
                    {showRecaptchaSecrets[key] ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
            ))}
            <button
              className="btn-primary"
              style={{ marginTop: 4 }}
              disabled={savingRecaptcha || savedRecaptcha}
              onClick={async () => {
                setSavingRecaptcha(true);
                await appSettingsApi.save(recaptchaKeys);
                setSavingRecaptcha(false); setSavedRecaptcha(true);
                setTimeout(() => setSavedRecaptcha(false), 2000);
              }}
            >
              {savedRecaptcha ? '✓ Saved' : savingRecaptcha ? 'Saving…' : 'Save reCAPTCHA Keys'}
            </button>
            </>)}
          </div>
        )}

        <div className="cf-embed-header" style={{ marginTop: 32 }}>
          <h2 className="cf-section-title">Embed snippet</h2>
          <CopyButton text={embedSnippet} />
        </div>
        <pre className="cf-embed">{embedSnippet}</pre>
      </div>
    </Layout>
  );
}

function StyleField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cfb-style-field">
      <label className="cfb-prop-label">{label}</label>
      <div className="cfb-style-control">{children}</div>
    </div>
  );
}

function rgbToHex(color: string): string {
  if (color.startsWith('#')) return color;
  // attempt rgba → hex (approximate, ignores alpha)
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#ffffff';
  return '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('');
}
