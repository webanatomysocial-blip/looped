import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../../components/Layout/Layout';
import Breadcrumb from '../../components/ContactForms/Breadcrumb';
import { contactFormsApi } from '../../services/api';
import '../../css/pages/ContactForms.css';

export default function ContactFormTest() {
  const { id, formId } = useParams<{ id: string; formId: string }>();
  const projectId = Number(id);
  const [form, setForm] = useState<{ name: string } | null>(null);
  const [project, setProject] = useState<{ name: string } | null>(null);

  useEffect(() => {
    contactFormsApi.getForm(Number(formId)).then((res) => setForm(res.data));
    contactFormsApi.getProject(projectId).then((res) => setProject(res.data));
  }, [projectId, formId]);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = '/embed.js?v=' + Date.now();
    script.setAttribute('data-form-id', String(formId));
    script.setAttribute('data-no-redirect', 'true');
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, [formId]);

  return (
    <Layout>
      <div className="cf-page">
        <Breadcrumb
          items={[
            { label: 'Contact Forms', href: '/contact-forms' },
            { label: project?.name || '...', href: `/contact-forms/${projectId}` },
            { label: form?.name || '...', href: `/contact-forms/${projectId}/forms/${formId}` },
            { label: 'Test' },
          ]}
        />
        <div className="cf-header"><h1>Test: {form?.name || '...'}</h1></div>
        <p className="cf-hint">Test your form</p>
        <div id={`wa-form-${formId}`} />
      </div>
    </Layout>
  );
}
