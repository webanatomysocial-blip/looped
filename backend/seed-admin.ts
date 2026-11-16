// Creates the first admin account. No password is stored in this file and none is ever printed.
// The initial password comes from SEED_ADMIN_PASSWORD (12+ characters), or is generated and written to the
// private file named by SEED_CREDENTIALS_FILE (mode 600). The account must choose a new password at first sign-in.
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import { initDB, getDB } from './src/db';

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@loooped.com';
  const given = process.env.SEED_ADMIN_PASSWORD;
  const credFile = process.env.SEED_CREDENTIALS_FILE;

  if (given !== undefined && given.length < 12) {
    console.error('SEED_ADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }
  if (given === undefined && !credFile) {
    console.error('Set SEED_ADMIN_PASSWORD, or SEED_CREDENTIALS_FILE to receive a generated password. Nothing was created.');
    process.exit(1);
  }

  await initDB();
  const db = getDB();
  if (await db('users').where({ email }).first()) {
    console.log('Admin already exists:', email);
    process.exit(0);
  }

  const password = given ?? crypto.randomBytes(18).toString('base64url');
  await db('users').insert({
    name: 'Admin',
    email,
    password_hash: await bcrypt.hash(password, 10),
    role: 'admin',
    avatar_color: '#4C8B5F',
    must_change_password: true,
  });

  if (given === undefined) {
    fs.writeFileSync(credFile!, `${email} ${password}\n`, { mode: 0o600 });
    fs.chmodSync(credFile!, 0o600);
    console.log(`Admin created: ${email}. The initial password is in the credentials file (not shown here).`);
  } else {
    console.log(`Admin created: ${email}, with the password from SEED_ADMIN_PASSWORD (not shown here).`);
  }
  console.log('A new password must be chosen at first sign-in.');
  process.exit(0);
}

main().catch((e) => { console.error('Seeding failed:', e instanceof Error ? e.message : 'unknown error'); process.exit(1); });
