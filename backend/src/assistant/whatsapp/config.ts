// WhatsApp channel settings. Off by default. When on, the session folder must sit outside the backend code folder,
// which every build and deploy replaces, so the WhatsApp login is never wiped by a deploy or shipped with the code.
import path from 'path';

// backend/src/assistant/whatsapp (or backend/dist/assistant/whatsapp) -> the backend folder.
// Only this folder is off-limits: on hosting where the repository sits directly in the home folder (cPanel), the
// home folder itself must stay usable for the session.
const CODE_ROOT = path.resolve(__dirname, '../../..');

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
  const rel = path.relative(CODE_ROOT, path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

export function loadWhatsAppConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig {
  const enabled = env.ASSISTANT_WHATSAPP_ENABLED === 'true';
  // "~/folder" means the folder in the home directory of the user that runs the server
  const home = (v: string | undefined) => { const t = v?.trim(); return t ? (t.startsWith('~/') ? path.join(require('os').homedir(), t.slice(2)) : t) : null; };
  const sessionDir = home(env.ASSISTANT_WHATSAPP_SESSION_DIR);
  const qrFile = home(env.ASSISTANT_WHATSAPP_QR_FILE);
  if (!enabled) return { enabled: false, sessionDir, qrFile };

  const problems: string[] = [];
  if (!sessionDir) problems.push('ASSISTANT_WHATSAPP_SESSION_DIR is required when WhatsApp is enabled');
  else if (!path.isAbsolute(sessionDir)) problems.push('ASSISTANT_WHATSAPP_SESSION_DIR must be an absolute path');
  else if (insideProject(sessionDir)) problems.push('ASSISTANT_WHATSAPP_SESSION_DIR must be outside the backend code folder');
  if (qrFile && (!path.isAbsolute(qrFile) || insideProject(qrFile))) {
    problems.push('ASSISTANT_WHATSAPP_QR_FILE must be an absolute path outside the backend code folder');
  }
  if (problems.length) throw new WhatsAppConfigError(problems);
  return { enabled, sessionDir, qrFile };
}
