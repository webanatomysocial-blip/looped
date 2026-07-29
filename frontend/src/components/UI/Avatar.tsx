import '../../css/UI/Avatar.css';

interface AvatarProps {
  name: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
}

export default function Avatar({ name, color = '#6366f1', size = 'md', title }: AvatarProps) {
  const initials = name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div
      className={`avatar avatar--${size}`}
      style={{ backgroundColor: color }}
      title={title ?? name}
    >
      {initials}
    </div>
  );
}
