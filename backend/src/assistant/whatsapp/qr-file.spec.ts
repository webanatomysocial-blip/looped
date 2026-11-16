/// <reference types="node" />
// The pairing file holds exactly the payload Baileys produced: no trailing newline, owner-only, replaced on each refresh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import { writeQrPayload } from './runtime';

// A payload with the same shape as Baileys' pairing string (ref, noise key, identity key, adv secret). Generated, not real.
const samplePayload = () => {
  const ref = crypto.randomBytes(40).toString('base64url');
  const k = () => crypto.randomBytes(32).toString('base64');
  return [ref, k(), k(), k()].join(',');
};

const withDir = (fn: (dir: string) => void) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-file-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('the pairing file holds exactly the payload: no trailing newline, owner-only', () => withDir((dir) => {
  const file = path.join(dir, 'qr.txt');
  const payload = samplePayload();
  writeQrPayload(file, payload);
  assert.equal(fs.readFileSync(file, 'utf8'), payload, 'byte-for-byte');
  assert.equal(fs.readFileSync(file).length, Buffer.byteLength(payload), 'no extra bytes');
  assert.equal(fs.readFileSync(file).at(-1) === 0x0a, false, 'no trailing newline');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir), ['qr.txt'], 'no temporary file left behind');
}));

test('a refresh replaces the previous code completely', () => withDir((dir) => {
  const file = path.join(dir, 'qr.txt');
  const first = samplePayload();
  const second = samplePayload();
  writeQrPayload(file, first);
  writeQrPayload(file, second);
  assert.equal(fs.readFileSync(file, 'utf8'), second);
  assert.equal(fs.readdirSync(dir).length, 1);
}));

test('the payload decodes back to the exact original bytes (round trip through a QR image)', (t) => withDir((dir) => {
  const py = spawnSync('python3', ['-c', 'import cv2'], { encoding: 'utf8' });
  const qr = spawnSync('qrencode', ['-V', '1'], { encoding: 'utf8' });
  if (py.status !== 0 || qr.error) { t.skip('needs python3 with opencv and qrencode'); return; }
  const file = path.join(dir, 'qr.txt');
  const png = path.join(dir, 'qr.png');
  const payload = samplePayload();
  writeQrPayload(file, payload);
  const enc = spawnSync('sh', ['-c', `qrencode -o "${png}" < "${file}"`]);
  assert.equal(enc.status, 0);
  const decoded = spawnSync('python3', ['-c', [
    'import cv2, sys',
    'img = cv2.imread(sys.argv[1])',
    'text, _, _ = cv2.QRCodeDetector().detectAndDecode(img)',
    'sys.stdout.write(text)',
  ].join('\n'), png], { encoding: 'utf8' });
  assert.equal(decoded.stdout, payload, 'decoded text equals the payload exactly');
}));
