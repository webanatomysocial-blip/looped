import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Layout from '../../components/Layout/Layout';
import ListCard from '../../components/ContactForms/ListCard';
import CreateBox from '../../components/ContactForms/CreateBox';
import ConfirmDeleteModal from '../../components/ContactForms/ConfirmDeleteModal';
import Breadcrumb from '../../components/ContactForms/Breadcrumb';
import { contactFormsApi } from '../../services/api';
import '../../css/pages/ContactForms.css';

interface ContactForm {
  id: number;
  name: string;
  submissionCount: number;
}

export default function ContactFormProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const clientId = Number(id);
  const [client, setClient] = useState<{ id: number; name: string } | null>(null);
  const [forms, setForms] = useState<ContactForm[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactForm | null>(null);

  function load() {
    contactFormsApi.getProject(clientId).then((res) => setClient(res.data));
    contactFormsApi.listForms(clientId).then((res) => setForms(res.data));
  }

  useEffect(load, [clientId]);

  async function handleCreate(name: string) {
    await contactFormsApi.createForm(clientId, name);
    load();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await contactFormsApi.deleteForm(deleteTarget.id);
    setDeleteTarget(null);
    load();
  }

  return (
    <Layout>
      <div className="cf-page">
        <Breadcrumb items={[{ label: 'Contact Forms', href: '/contact-forms' }, { label: client?.name || '...' }]} />
        <div className="cf-header">
          <h1>{client?.name || '...'}</h1>
          <Link to={`/contact-forms/${clientId}/submissions`} className="btn-secondary">View Submissions</Link>
        </div>

        <CreateBox placeholder="Form name" buttonLabel="Create form" onCreate={handleCreate} />

        <div className="cf-list">
          {forms === null && <p className="cf-empty">Loading...</p>}
          {forms?.length === 0 && <p className="cf-empty">No forms yet. Create one above.</p>}
          {forms?.map((form) => (
            <ListCard
              key={form.id}
              href={`/contact-forms/${clientId}/forms/${form.id}`}
              title={form.name}
              meta={`${form.submissionCount} submission${form.submissionCount === 1 ? '' : 's'}`}
              onDelete={() => setDeleteTarget(form)}
            />
          ))}
        </div>

        {deleteTarget && (
          <ConfirmDeleteModal
            itemName={deleteTarget.name}
            onConfirm={handleDelete}
            onCancel={() => setDeleteTarget(null)}
          />
        )}
      </div>
    </Layout>
  );
}
