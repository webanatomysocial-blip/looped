import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDB } from '../db';

export interface AuthRequest extends Request {
  user?: { id: number; role: string; email: string; name: string; pod?: string };
}

// Verifies the JWT, then checks the user still exists and the token's session version is current.
// Role and pod come from the database, so a role change applies immediately without a new login.
// Tokens issued before versions existed carry none and count as version 0 (the column default).
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server misconfiguration' });
    return;
  }
  let decoded: any;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  try {
    const u = await getDB()('users').where({ id: decoded.id }).select('role', 'pod', 'name', 'email', 'token_version', 'must_change_password').first();
    if (!u || Number(decoded.tv ?? 0) !== Number(u.token_version ?? 0)) {
      res.status(401).json({ error: 'Session expired — please sign in again' });
      return;
    }
    const allowedWhileChanging = req.originalUrl.startsWith('/api/auth/change-password') || req.originalUrl.startsWith('/api/auth/me');
    if (Boolean(u.must_change_password) && !allowedWhileChanging) {
      res.status(403).json({ error: 'Choose a new password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
      return;
    }
    req.user = { ...decoded, role: u.role, pod: u.pod ?? null, name: u.name, email: u.email };
  } catch {
    res.status(500).json({ error: 'Server error' });
    return;
  }
  next();
}

export function requireRoles(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

// Revokes every session the user has (logout everywhere, password change, admin revoke)
export async function revokeSessions(userId: number | string): Promise<void> {
  await getDB()('users').where({ id: userId }).increment('token_version', 1);
}

// Mount in front of an API that serves exactly one website page (S9)
export function requirePage(page: string) {
  return [
    authenticate,
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      const { canUsePage } = await import('../services/access');
      try {
        if (await canUsePage(getDB(), req.user! as any, page)) return next();
        res.status(403).json({ error: 'You do not have access to this page' });
      } catch { res.status(500).json({ error: 'Server error' }); }
    },
  ];
}
