import { useEffect, useState } from 'react';
import Layout from '../../components/Layout/Layout';
import ListCard from '../../components/ContactForms/ListCard';
import CreateBox from '../../components/ContactForms/CreateBox';
import Modal from '../../components/UI/Modal';
import ConfirmDeleteModal from '../../components/ContactForms/ConfirmDeleteModal';
import { contactFormsApi } from '../../services/api';
import '../../css/pages/ContactForms.css';

interface ContactProject {
  id: number;
  name: string;
  formCount: number;
}

export default function ContactFormProjects() {
  const [projects, setProjects] = useState<ContactProject[] | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContactProject | null>(null);

  function load() {
    contactFormsApi.listProjects().then((res) => setProjects(res.data));
  }

  useEffect(load, []);

  async function handleCreate(name: string) {
    await contactFormsApi.createProject(name);
    setShowModal(false);
    load();
  }

  async function handleDelete(id: number) {
    await contactFormsApi.deleteProject(id);
    setDeleteTarget(null);
    load();
  }

  return (
    <Layout>
      <div className="cf-page">
        <div className="cf-header">
          <h1>Contact Forms</h1>
          <button type="button" className="btn-primary" onClick={() => setShowModal(true)}>+ New Project</button>
        </div>

        <div className="cf-list">
          {projects === null && <p className="cf-empty">Loading...</p>}
          {projects?.length === 0 && <p className="cf-empty">No projects yet. Create your first one.</p>}
          {projects?.map((project) => (
            <ListCard
              key={project.id}
              href={`/contact-forms/${project.id}`}
              title={project.name}
              meta={`${project.formCount} form${project.formCount === 1 ? '' : 's'}`}
              onDelete={() => setDeleteTarget(project)}
            />
          ))}
        </div>

        {showModal && (
          <Modal title="New project" onClose={() => setShowModal(false)}>
            <CreateBox placeholder="Project name" buttonLabel="Create" onCreate={handleCreate} />
          </Modal>
        )}

        {deleteTarget && (
          <ConfirmDeleteModal
            itemName={deleteTarget.name}
            requireTyped
            onConfirm={() => handleDelete(deleteTarget.id)}
            onCancel={() => setDeleteTarget(null)}
          />
        )}
      </div>
    </Layout>
  );
}
