import { Link } from 'react-router-dom';

export default function ListCard({
  href,
  title,
  meta,
  secondaryHref,
  secondaryLabel,
  onDelete,
}: {
  href: string;
  title: string;
  meta?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  onDelete?: () => void;
}) {
  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    onDelete?.();
  }

  return (
    <div className="cf-card">
      <Link to={href} className="cf-card-link">
        <div className="cf-card-title">{title}</div>
        {meta && <div className="cf-card-meta">{meta}</div>}
      </Link>
      <div className="cf-card-actions">
        {secondaryHref && (
          <Link to={secondaryHref} className="cf-card-secondary">{secondaryLabel}</Link>
        )}
        {onDelete && (
          <button type="button" className="cf-card-delete" onClick={handleDelete}>Delete</button>
        )}
      </div>
    </div>
  );
}
