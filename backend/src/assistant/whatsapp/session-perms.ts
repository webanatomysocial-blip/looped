// Permissions for the WhatsApp session folder. The session holds keys, so the folder is owner-only (700) and every
// file in it is owner-only (600). Only modes are changed: file contents are never read or rewritten.
import fs from 'fs';
import path from 'path';

// Restrictive umask: files and folders the process creates from now on are owner-only, before the library writes any session file
export function applyRestrictiveUmask(): number {
  return process.umask(0o077);
}

// Brings the folder and every regular file in it to 700 / 600. Returns how many files had to be corrected.
export function enforceSessionPermissions(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  fs.chmodSync(dir, 0o700);
  let fixed = 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);            // lstat: a symlink is not followed, so nothing outside the folder changes
    if (!st.isFile()) continue;
    if ((st.mode & 0o777) !== 0o600) { fs.chmodSync(p, 0o600); fixed++; }
  }
  return fixed;
}
