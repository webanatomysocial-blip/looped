/// <reference types="node" />
// Security fixes from the audit: uploaded files, public contact forms (codes, reCAPTCHA, settings) and log redaction.
// No email is sent: the mail function is replaced, and Google's reCAPTCHA check is replaced.
import fs from 'fs';
import path from 'path';
process.env.SQLITE_FILE = ':memory:';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'security-test-secret';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { AddressInfo } from 'net';
import { initDB, getDB } from '../db';
import * as mail from './emailService';
import { guardUploads, signUpload, signUploadLinks, uploadName, uploadAllowed } from './uploads';
import { redactUrl } from './redact';
import { publicContactFormsRouter, otpStore, recaptcha } from '../routes/contact-forms';
import { contactFormLimiter } from '../middleware/rateLimits';
import { listenLocal } from '../testServer';

const sent: { to: string; body: string }[] = [];
(mail as any).sendEmail = async (o: any) => { sent.push({ to: o.to[0].email, body: o.body }); };
let captchaAnswer = true;
recaptcha.verify = async () => captchaAnswer;

const UPLOADS = path.join(__dirname, '../../uploads');
const probeFiles = ['chat/__sec_probe.html', 'deliverables/__sec_probe.png', 'avatar-__sec_probe.png'];
let server: any; let base = '';
let formOtp = 0; let formPlain = 0;

before(async () => {
  await initDB();
  for (const f of probeFiles) { fs.mkdirSync(path.dirname(path.join(UPLOADS, f)), { recursive: true }); fs.writeFileSync(path.join(UPLOADS, f), f.endsWith('.html') ? '<script>parent.localStorage.token</script>' : 'png'); }
  const d = getDB();
  [formOtp] = await d('contact_forms').insert({ name: 'Leads', fields: JSON.stringify([{ name: 'email', label: 'Email', required: true }]), to_emails: 'owner@client.test', template: 'internal template', webhook_url: 'http://127.0.0.1:9/secret-123', otp_enabled: true });
  [formPlain] = await d('contact_forms').insert({ name: 'Plain', fields: '[]', to_emails: 'x@client.test', webhook_url: null, otp_enabled: false });
  const app = express(); app.use(express.json());
  app.use('/api/public/contact-forms', contactFormLimiter, signUploadLinks, publicContactFormsRouter);
  app.get('/api/sample', signUploadLinks, (_req, res) => { res.json({ file_url: '/uploads/chat/__sec_probe.html', nested: [{ url: '/uploads/deliverables/__sec_probe.png' }], avatar: '/uploads/avatar-__sec_probe.png', other: 'https://example.com' }); });
  app.use('/uploads', guardUploads, express.static(UPLOADS, { index: false, dotfiles: 'deny' }));
  server = await listenLocal(app); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); getDB().destroy(); for (const f of probeFiles) fs.rmSync(path.join(UPLOADS, f), { force: true }); });

const post = (url: string, body: any) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ── Uploaded files ──
test('an uploaded web page is stored as a plain download, never as a page', () => {
  assert.match(uploadName('evil.html'), /^[0-9a-f-]{36}\.bin$/);
  assert.match(uploadName('x.svg'), /\.bin$/); assert.match(uploadName('a.js'), /\.bin$/);
  assert.match(uploadName('Report Q3.PDF'), /^[0-9a-f-]{36}\.pdf$/, 'random name, extension kept when safe');
  assert.match(uploadName('me.png', 'avatar-'), /^avatar-[0-9a-f-]{36}\.png$/);
  assert.notEqual(uploadName('a.png'), uploadName('a.png'));
});

test('private uploads need a link the API signed; without it, or expired, they are refused', async () => {
  assert.equal((await fetch(`${base}/uploads/chat/__sec_probe.html`)).status, 403, 'no signature');
  assert.equal((await fetch(`${base}/uploads/deliverables/__sec_probe.png`)).status, 403);
  const forged = `${base}/uploads/chat/__sec_probe.html?e=9999999999&s=forged`;
  assert.equal((await fetch(forged)).status, 403, 'made-up signature');
  const old = signUpload('/uploads/chat/__sec_probe.html', Date.now() - 3 * 86_400_000);
  assert.equal((await fetch(base + old)).status, 403, 'expired link');
  // The link for one file does not open another
  const s = signUpload('/uploads/deliverables/__sec_probe.png').split('?')[1];
  assert.equal((await fetch(`${base}/uploads/chat/__sec_probe.html?${s}`)).status, 403);
  assert.equal((await fetch(`${base}/uploads/../src/server.ts`)).status === 200, false, 'no path tricks');
});

test('an uploaded page opened by an admin cannot run as Loop: sandboxed, not sniffed, downloaded', async () => {
  const body = await (await fetch(`${base}/api/sample`)).json() as any;
  assert.match(body.file_url, /^\/uploads\/chat\/__sec_probe\.html\?e=\d+&s=/, 'answers carry signed links');
  assert.match(body.nested[0].url, /\?e=\d+&s=/);
  assert.equal(body.avatar, '/uploads/avatar-__sec_probe.png', 'avatars stay public (shown on public share pages)');
  assert.equal(body.other, 'https://example.com');
  const r = await fetch(base + body.file_url);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-security-policy'), 'sandbox', 'a sandboxed page has no access to Loop or its login');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-disposition'), 'attachment', 'a page downloads instead of opening');
  const img = await fetch(base + body.nested[0].url);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-disposition'), null, 'images still preview');
  assert.equal(img.headers.get('content-security-policy'), 'sandbox');
  assert.equal((await fetch(`${base}/uploads/avatar-__sec_probe.png`)).status, 200);
  assert.ok(uploadAllowed('/uploads/avatar-x.png', undefined, undefined));
});

// ── Public contact forms ──
test('the public form settings show only what the form needs: no recipients, webhook, template or client', async () => {
  const r = await (await fetch(`${base}/api/public/contact-forms/forms/${formOtp}`)).json() as any;
  assert.equal(r.name, 'Leads'); assert.equal(r.otp_enabled, true); assert.ok(Array.isArray(r.fields));
  const text = JSON.stringify(r);
  for (const leak of ['owner@client.test', 'secret-123', 'internal template', 'to_emails', 'webhook_url', 'template', 'client_id']) assert.ok(!text.includes(leak), `does not include ${leak}`);
});

test('email codes: required, wrong ones counted, gone after five, single use', async () => {
  const email = 'Lead@Example.com';
  const submit = (otp?: string) => post(`/api/public/contact-forms/forms/${formOtp}/submit`, { email, ...(otp ? { __otp: otp } : {}) });
  assert.equal((await submit()).status, 400, 'no code, no submission');
  assert.equal((await post(`/api/public/contact-forms/forms/${formOtp}/send-otp`, { email })).status, 200);
  const code = /Your OTP is: (\d{6})/.exec(sent[sent.length - 1].body)![1];
  assert.equal(sent[sent.length - 1].to, 'lead@example.com');
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) assert.equal((await post(`/api/public/contact-forms/forms/${formOtp}/verify-otp`, { email, otp: wrong })).status, 400);
  assert.equal((await post(`/api/public/contact-forms/forms/${formOtp}/verify-otp`, { email, otp: code })).status, 200, 'still usable after four wrong tries');
  assert.equal((await submit(code)).status, 200, 'submitted with the right code');
  assert.equal((await submit(code)).status, 400, 'a code works once');
  // A fresh code, five wrong tries in a row (sent at once): it is then gone, even the right one fails
  otpStore.set(`${formOtp}:lead@example.com`, { code: '424242', expires: Date.now() + 60_000, tries: 0 });
  await Promise.all(Array.from({ length: 5 }, () => post(`/api/public/contact-forms/forms/${formOtp}/verify-otp`, { email, otp: '999999' })));
  assert.equal((await post(`/api/public/contact-forms/forms/${formOtp}/verify-otp`, { email, otp: '424242' })).status, 400, 'invalidated after five wrong tries');
  assert.ok(!otpStore.has(`${formOtp}:lead@example.com`));
  // An expired code is refused
  otpStore.set(`${formOtp}:lead@example.com`, { code: '535353', expires: Date.now() - 1, tries: 0 });
  assert.equal((await submit('535353')).status, 400);
});

test('codes cannot flood an inbox: one a minute per address, and requests per visitor are limited', async () => {
  const email = 'flood@example.com';
  assert.equal((await post(`/api/public/contact-forms/forms/${formOtp}/send-otp`, { email })).status, 200);
  const again = await post(`/api/public/contact-forms/forms/${formOtp}/send-otp`, { email });
  assert.equal(again.status, 429, 'second code within a minute refused');
  assert.equal((await post(`/api/public/contact-forms/forms/${formPlain}/send-otp`, { email: 'x@example.com' })).status, 404, 'no codes from a form without them');
  // The visitor's budget for codes (sending and checking) runs out
  let limited = false;
  for (let i = 0; i < 25 && !limited; i++) limited = (await post(`/api/public/contact-forms/forms/${formOtp}/verify-otp`, { email: 'x@example.com', otp: '1' })).status === 429;
  assert.ok(limited, 'verification attempts are rate-limited');
});

test('reCAPTCHA, when set up, cannot be skipped by leaving the token out; a failed check is refused', async () => {
  await getDB()('app_settings').whereIn('key', ['recaptcha_site_key', 'recaptcha_secret_key']).del();
  await getDB()('app_settings').insert([{ key: 'recaptcha_site_key', value: 'site' }, { key: 'recaptcha_secret_key', value: 'secret' }]);
  assert.equal((await (await fetch(`${base}/api/public/contact-forms/forms/${formPlain}`)).json() as any).recaptcha_v2_site_key, 'site', 'the embed now gets the site key (it never did)');
  try {
    const sub = (body: any) => post(`/api/public/contact-forms/forms/${formPlain}/submit`, body);
    const missing = await sub({ name: 'bot' });
    assert.equal(missing.status, 400); assert.match((await missing.json() as any).error, /not a robot/);
    captchaAnswer = false;
    assert.equal((await sub({ 'g-recaptcha-response': 'bad' })).status, 400, 'invalid token refused');
    captchaAnswer = true;
    assert.equal((await sub({ 'g-recaptcha-response': 'good' })).status, 200);
  } finally { await getDB()('app_settings').whereIn('key', ['recaptcha_site_key', 'recaptcha_secret_key']).del(); }
  assert.equal((await post(`/api/public/contact-forms/forms/${formPlain}/submit`, { name: 'no captcha set up' })).status, 200, 'without reCAPTCHA set up, forms work as before');
});

// ── Logs ──
test('secret links are never written to the request log', () => {
  const cases: [string, string][] = [
    ['/api/public/careers/applications/SECRETtoken123/withdraw', '/api/public/careers/applications/…/withdraw'],
    ['/api/public/careers/interview/SECRETtoken123/chunk', '/api/public/careers/interview/…/chunk'],
    ['/api/public/task/SECRET', '/api/public/task/…'],
    ['/api/public/seo/SECRET/report', '/api/public/seo/…/report'],
    ['/api/recruitment/media/recording/4/0?exp=1&sig=SECRET', '/api/recruitment/media/recording/4/0?…'],
    ['/uploads/chat/a.png?e=1&s=SECRET', '/uploads/chat/a.png?e=…&s=…'],
    ['/api/tasks?status=open', '/api/tasks?status=…'],
  ];
  for (const [url, want] of cases) { assert.equal(redactUrl(url), want); assert.ok(!redactUrl(url).includes('SECRET')); }
  assert.equal(redactUrl('/api/tasks/12'), '/api/tasks/12', 'ordinary addresses are unchanged');
});
