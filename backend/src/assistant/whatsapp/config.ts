// WhatsApp channel settings. Off by default. When on, the session folder must sit outside the project, so
// credentials are never stored in the repository.
import path from 'path';

// backend/src/assistant/whatsapp -> the project root
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

export interface WhatsAppConfig {
  enabled: boolean;
  sessionDir: string | null;
  qrFile: string | null;
}

export class WhatsAppConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`WhatsApp configuration invalid: ${problems.join('; ')}`);
    this.name = 'WhatsAppConfigError';
  }
}

const insideProject = (p: string) => {
  const rel = path.relative(PROJECT_ROOT, path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

export function loadWhatsAppConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig {
  const enabled = env.ASSISTANT_WHATSAPP_ENABLED === 'true';
  const sessionDir = env.ASSISTANT_WHATSAPP_SESSION_DIR?.trim() || null;
  const qrFile = env.ASSISTANT_WHATSAPP_QR_FILE?.trim() || null;
  if (!enabled) return { enabled: false, sessionDir, qrFile };

  const problems: string[] = [];
  if (!sessionDir) problems.push('ASSISTANT_WHATSAPP_SESSION_DIR is required when WhatsApp is enabled');
  else if (!path.isAbsolute(sessionDir)) problems.push('ASSISTANT_WHATSAPP_SESSION_DIR must be an absolute path');
  else if (insideProject(sessionDir)) problems.push('ASSISTANT_WHATSAPP_SESSION_DIR must be outside the project folder');
  if (qrFile && (!path.isAbsolute(qrFile) || insideProject(qrFile))) {
    problems.push('ASSISTANT_WHATSAPP_QR_FILE must be an absolute path outside the project folder');
  }
  if (problems.length) throw new WhatsAppConfigError(problems);
  return { enabled, sessionDir, qrFile };
}
