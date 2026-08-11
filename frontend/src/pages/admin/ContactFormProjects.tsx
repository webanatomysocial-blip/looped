import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout/Layout';
import { contactFormsApi } from '../../services/api';
import '../../css/pages/ContactForms.css';

interface Client {
  id: number;
  name: string;
  formCount: number;
}

export default function ContactFormProjects() {
  const [clients, setClients] = useState<Client[] | null>(null);

  useEffect(() => {
    contactFormsApi.listProjects().then((res) => setClients(res.data));
  }, []);

  return (
    <Layout>
      <div className="cf-page">
        <div className="cf-header">
          <h1>Contact Forms</h1>
        </div>

        <div className="cf-list">
          {clients === null && <p className="cf-empty">Loading...</p>}
          {clients?.length === 0 && <p className="cf-empty">No clients found. Add clients in User Management first.</p>}
          {clients?.map((client) => (
            <Link key={client.id} to={`/contact-forms/${client.id}`} className="cf-card cf-card-link">
              <div className="cf-card-title">{client.name}</div>
              <div className="cf-card-meta">{client.formCount} form{client.formCount === 1 ? '' : 's'}</div>
            </Link>
          ))}
        </div>
      </div>
    </Layout>
  );
}
