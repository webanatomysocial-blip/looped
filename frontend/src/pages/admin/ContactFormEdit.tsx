import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../../components/Layout/Layout';
import Breadcrumb from '../../components/ContactForms/Breadcrumb';
import CopyButton from '../../components/ContactForms/CopyButton';
import { contactFormsApi } from '../../services/api';
import '../../css/pages/ContactForms.css';

interface Field { name: string; label: string; type: string; required: boolean }

const FIELD_TYPES = ['text', 'email', 'tel', 'textarea'];

const TEMPLATE_PLACEHOLDER = `<form class="wa-contact-form">
  <input name="name" placeholder="Name" required>
  <input name="email" type="email" placeholder="Email" required>
  <textarea name="message" placeholder="Message" required></textarea>
  <button type="submit">Send</button>
</form>`;

function parseFieldsFromTemplate(html: string): Field[] {
  if (!html.trim()) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const scope = doc.querySelector('form') || doc;
  const controls = scope.querySelectorAll('input[name], textarea[name], select[name]');
  const seen = new Set<string>();
  const fields: Field[] = [];

  controls.forEach((el) => {
    const name = el.getAttribute('name');
    if (!name || seen.has(name)) return;
    seen.add(name);

    const tag = el.tagName.toLowerCase();
    const rawType = tag === 'textarea' ? 'textarea' : el.getAttribute('type') || 'text';
    const type = FIELD_TYPES.includes(rawType) ? rawType : 'text';
    const label =
      (el.id && scope.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()) ||
      el.getAttribute('placeholder') ||
      name;

    fields.push({ name, label, type, required: el.hasAttribute('required') });
  });

  return fields;
}

export default function ContactFormEdit() {
  const { id, formId } = useParams<{ id: string; formId: string }>();
  const projectId = Number(id);
  const [form, setForm] = useState<any>(null);
  const [project, setProject] = useState<{ id: number; name: string } | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [toEmails, setToEmails] = useState('');
  const [template, setTemplate] = useState('');
  const [tab, setTab] = useState<'template' | 'fields'>('template');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    contactFormsApi.getForm(Number(formId)).then((res) => {
      const data = res.data;
      setForm(data);
      setFields(data.fields);
      setToEmails(data.toEmails ?? data.to_emails ?? '');
      setTemplate(data.template);
    });
    contactFormsApi.getProject(projectId).then((res) => setProject(res.data));
  }, [projectId, formId]);

  const usingTemplate = template.trim().length > 0;
  const derivedFields = useMemo(
    () => (usingTemplate ? parseFieldsFromTemplate(template) : fields),
    [usingTemplate, template, fields]
  );

  function updateField(index: number, patch: Partial<Field>) {
    setFields((prev) => prev.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  function addField() {
    setFields((prev) => [...prev, { name: '', label: '', type: 'text', required: true }]);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const fieldsToSave = usingTemplate ? parseFieldsFromTemplate(template) : fields;
    await contactFormsApi.updateForm(Number(formId), { fields: fieldsToSave, toEmails, template });
    setFields(fieldsToSave);
    setSaving(false);
    setSaved(true);
  }

  if (!form) {
    return (
      <Layout>
        <div className="cf-page"><p className="cf-empty">Loading...</p></div>
      </Layout>
    );
  }

  const embedSnippet = `<div id="wa-form-${formId}"></div>
<script src="${window.location.origin}/embed.js" data-form-id="${formId}"></script>`;

  return (
    <Layout>
      <div className="cf-page">
        <Breadcrumb
          items={[
            { label: 'Contact Forms', href: '/contact-forms' },
            { label: project?.name || '...', href: `/contact-forms/${projectId}` },
            { label: form.name },
          ]}
        />
        <div className="cf-header">
          <h1>{form.name}</h1>
          <a href={`/contact-forms/${projectId}/forms/${formId}/test`} className="btn-secondary">Test Form</a>
        </div>

        <h2 className="cf-section-title">Recipients</h2>
        <input
          className="cf-recipients"
          placeholder="e.g. sales@example.com, ops@example.com"
          value={toEmails}
          onChange={(e) => setToEmails(e.target.value)}
        />
        <p className="cf-hint">Comma-separated. Submissions from this form email here.</p>

        <div className="cf-tabs">
          <button type="button" className={tab === 'template' ? 'cf-tab cf-tab-active' : 'cf-tab'} onClick={() => setTab('template')}>Template</button>
          <button type="button" className={tab === 'fields' ? 'cf-tab cf-tab-active' : 'cf-tab'} onClick={() => setTab('fields')}>Fields</button>
        </div>

        {tab === 'template' && (
          <>
            <div className="cf-template-grid">
              <div className="cf-editor-panel">
                <div className="cf-editor-panel-header"><span className="cf-editor-panel-title">template.html</span></div>
                <textarea
                  className="cf-template-input"
                  placeholder={TEMPLATE_PLACEHOLDER}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="cf-preview-panel">
                <div className="cf-preview-panel-header"><span className="cf-preview-url-bar">Live preview</span></div>
                <iframe className="cf-template-preview" srcDoc={template || TEMPLATE_PLACEHOLDER} title="Form preview" />
              </div>
            </div>
            <p className="cf-hint">Paste your form's HTML. Field names and required checks are detected automatically.</p>
          </>
        )}

        {tab === 'fields' && usingTemplate && (
          <div className="cf-fields">
            <p className="cf-hint">Detected automatically from your template. Edit the Template tab to change these.</p>
            <div className="cf-list">
              {derivedFields.length === 0 && (
                <p className="cf-empty">No named inputs found. Add <code>name</code> attributes to your template's fields.</p>
              )}
              {derivedFields.map((f) => (
                <div key={f.name} className="cf-card">
                  <div className="cf-card-title">{f.name}</div>
                  <div className="cf-card-meta">{f.label} · {f.type}{f.required ? ' · required' : ''}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'fields' && !usingTemplate && (
          <div className="cf-fields">
            {fields.map((field, i) => (
              <div key={i} className="cf-field-row">
                <input placeholder="field name (e.g. email)" value={field.name} onChange={(e) => updateField(i, { name: e.target.value })} />
                <input placeholder="label" value={field.label} onChange={(e) => updateField(i, { label: e.target.value })} />
                <select value={field.type} onChange={(e) => updateField(i, { type: e.target.value })}>
                  {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <label className="cf-field-required">
                  <input type="checkbox" checked={field.required} onChange={(e) => updateField(i, { required: e.target.checked })} />
                  required
                </label>
                <button type="button" className="btn-danger" onClick={() => removeField(i)}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn-secondary" onClick={addField}>+ Add field</button>
          </div>
        )}

        {!(tab === 'fields' && usingTemplate) && (
          <div className="cf-actions">
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
            {saved && <span className="cf-saved">Saved.</span>}
          </div>
        )}

        <div className="cf-embed-header">
          <h2 className="cf-section-title">Embed snippet</h2>
          <CopyButton text={embedSnippet} />
        </div>
        <pre className="cf-embed">{embedSnippet}</pre>
      </div>
    </Layout>
  );
}
