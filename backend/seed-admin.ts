import bcrypt from 'bcryptjs';
import { initDB, getDB } from './src/db';

async function main() {
  await initDB();
  const db = getDB();

  const email = 'admin@loooped.com';
  const password = 'Admin@1234';
  const hash = await bcrypt.hash(password, 10);

  const existing = await db('users').where({ email }).first();
  if (existing) {
    console.log('Admin already exists:', email);
    process.exit(0);
  }

  await db('users').insert({
    name: 'Admin',
    email,
    password_hash: hash,
    role: 'admin',
    avatar_color: '#4C8B5F',
  });

  console.log('\n✅ Admin created successfully!\n');
  console.log('  Email   :', email);
  console.log('  Password:', password);
  console.log('\nChange your password after first login.\n');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

