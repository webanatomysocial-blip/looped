/// <reference types="node" />
// Session folder permissions: enforced at startup, on every save, and on a timer while running. Contents never change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { enforceSessionPermissions, applyRestrictiveUmask } from './session-perms';
import { WhatsAppAdapter, SocketHandle } from './adapter';

const mode = (p: string) => fs.statSync(p).mode & 0o777;
const hash = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sess-'));
const fakeSocket = () => ({ ev: { on: () => {} }, sendMessage: async () => ({}), end: () => {} });

test('existing files are corrected at startup, folder too, and contents are unchanged', () => {
  const dir = tmpDir();
  try {
    fs.chmodSync(dir, 0o755);
    const creds = path.join(dir, 'creds.json');
    const keys = path.join(dir, 'pre-key-1.json');
    fs.writeFileSync(creds, '{"secret":"keep-me"}', { mode: 0o644 });
    fs.writeFileSync(keys, '{"k":1}', { mode: 0o664 });
    const before = [hash(creds), hash(keys)];
    const fixed = enforceSessionPermissions(dir);
    assert.equal(fixed, 2);
    assert.equal(mode(dir), 0o700);
    assert.equal(mode(creds), 0o600);
    assert.equal(mode(keys), 0o600);
    assert.deepEqual([hash(creds), hash(keys)], before, 'contents unchanged');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a symlink inside the folder is not followed, so nothing outside the folder changes', () => {
  const dir = tmpDir();
  const outside = tmpDir();
  try {
    const target = path.join(outside, 'elsewhere.txt');
    fs.writeFileSync(target, 'x', { mode: 0o644 });
    fs.symlinkSync(target, path.join(dir, 'link.json'));
    enforceSessionPermissions(dir);
    assert.equal(mode(target), 0o644, 'target outside the folder is untouched');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('the restrictive umask is applied before session files are created', () => {
  const previous = process.umask();
  try {
    applyRestrictiveUmask();
    assert.equal(process.umask(), 0o077);
  } finally { process.umask(previous); }
});

test('a file created while the adapter is running is secured within one pass, with no save needed', async () => {
  const dir = tmpDir();
  const adapter = new WhatsAppAdapter({
    config: { enabled: true, sessionDir: dir, qrFile: null },
    makeSocket: async () => ({ socket: fakeSocket(), saveCreds: () => {} } as SocketHandle),
    handle: async () => null, log: () => {}, sweepMs: 40,
  });
  try {
    await adapter.start();
    fs.writeFileSync(path.join(dir, 'app-state-sync.json'), '{}', { mode: 0o644 });   // created by the library outside a save
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(mode(path.join(dir, 'app-state-sync.json')), 0o600);
  } finally { await adapter.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restart: the same folder and files are kept, secured again, with the same contents', async () => {
  const dir = tmpDir();
  try {
    const creds = path.join(dir, 'creds.json');
    fs.writeFileSync(creds, '{"session":"same"}', { mode: 0o644 });
    const before = hash(creds);
    for (let run = 0; run < 2; run++) {
      const a = new WhatsAppAdapter({
        config: { enabled: true, sessionDir: dir, qrFile: null },
        makeSocket: async () => ({ socket: fakeSocket(), saveCreds: () => {} } as SocketHandle),
        handle: async () => null, log: () => {}, sweepMs: 1000,
      });
      await a.start();
      await a.stop();
    }
    assert.equal(mode(creds), 0o600);
    assert.equal(mode(dir), 0o700);
    assert.equal(hash(creds), before, 'session contents preserved across restarts');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
