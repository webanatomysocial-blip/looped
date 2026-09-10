import '../../css/UI/Avatar.css';

interface AvatarProps {
  name: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  avatarUrl?: string | null;
}

export default function Avatar({ name, color = '#6366f1', size = 'md', title, avatarUrl }: AvatarProps) {
  const initials = name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div
      className={`avatar avatar--${size}`}
      style={{ backgroundColor: avatarUrl ? 'transparent' : color }}
      title={title ?? name}
    >
      {avatarUrl
        ? <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
        : initials}
    </div>
  );
}

/** Inline mini avatar — drops into any flex row, replaces raw span/div circles */
export function MiniAvatar({ name, color, avatarUrl, size = 22, fontSize = 9, style = {} }: {
  name: string;
  color?: string;
  avatarUrl?: string | null;
  size?: number;
  fontSize?: number;
  style?: React.CSSProperties;
}) {
  const initials = name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: avatarUrl ? 'transparent' : (color || '#888'),
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize, fontWeight: 800, color: '#fff', flexShrink: 0, overflow: 'hidden',
      ...style,
    }} title={name}>
      {avatarUrl
        ? <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
        : initials}
    </span>
  );
}
