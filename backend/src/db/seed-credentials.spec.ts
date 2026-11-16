/// <reference types="node" />
// Demo accounts get random passwords written to a private file, not to the log and not in the source.
process.env.SQLITE_FILE = ':memory:';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('first seed writes random demo passwords to a private file (mode 600), logs none of them', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seedcreds-'));
  const file = path.join(dir, 'creds.txt');
  process.env.DEMO_CREDENTIALS_FILE = file;
  const logged: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
  try {
    const { initDB, getDB } = require('./index');
    await initDB();
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 4, 'one line per demo account');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'owner-only');
    const passwords = lines.map((l) => l.split(' ')[1]);
    for (const p of passwords) assert.ok(p.length >= 20, 'random, not a short default');
    for (const p of passwords) assert.ok(!logged.join('\n').includes(p), 'no password in the log');
    assert.ok(!['Admin@123', 'Manager@123', 'Employee@123', 'Client@123'].some((old) => passwords.includes(old)), 'no known default');
    await getDB().destroy();
  } finally {
    console.log = realLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
