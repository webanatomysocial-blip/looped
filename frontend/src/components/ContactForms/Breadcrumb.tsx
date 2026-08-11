import { Link } from 'react-router-dom';

export default function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="cf-breadcrumb" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="cf-breadcrumb-item">
            {isLast || !item.href ? (
              <span className="cf-breadcrumb-current">{item.label}</span>
            ) : (
              <Link to={item.href} className="cf-breadcrumb-link">{item.label}</Link>
            )}
            {!isLast && <span className="cf-breadcrumb-sep">›</span>}
          </span>
        );
      })}
    </nav>
  );
}
