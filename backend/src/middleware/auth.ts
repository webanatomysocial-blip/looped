import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: { id: number; role: string; email: string; name: string; pod?: string };
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
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
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
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
