/// <reference types="node" />
// The interview recording pipeline end to end with real media: sample recordings of known length (a test picture and
// a 440 Hz tone, made by ffmpeg) are split into chunks like a browser sends them, uploaded, built and measured.
import os from 'os';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
process.env.SQLITE_FILE = ':memory:';
process.env.RECRUITMENT_STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-pipeline-'));
process.env.RECRUITMENT_EMAILS = 'off';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDB, getDB } from '../db';
import * as R from './recruitment';
import { probe } from './recordingMedia';

const FF = require('ffmpeg-static') as string;
const SAMPLES = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-samples-'));
const make = (name: string, args: string[]) => { const out = path.join(SAMPLES, name); execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args, out]); return fs.readFileSync(out); };
const PIC = (secs: number) => ['-f', 'lavfi', '-i', `testsrc=duration=${secs}:size=320x240:rate=25`];
const TONE = (secs: number) => ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${secs}`];
// What browsers send: Chrome/Android/Firefox WebM (VP8 + Opus); Apple MP4 video and, separately, MP4 sound
const SECS = 6;
let webm: Buffer, webmSilent: Buffer, soundOnly: Buffer, mp4Video: Buffer, m4a: Buffer;
let job = 0; let n = 0;

before(async () => {
  await initDB();
  webm = make('both.webm', [...PIC(SECS), ...TONE(SECS), '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus', '-f', 'webm']);
  webmSilent = make('video.webm', [...PIC(SECS), '-c:v', 'libvpx', '-b:v', '300k', '-f', 'webm']);
  soundOnly = make('sound.webm', [...TONE(SECS), '-c:a', 'libopus', '-f', 'webm']);
  mp4Video = make('video.mp4', [...PIC(SECS), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4']);
  m4a = make('sound.m4a', [...TONE(SECS), '-c:a', 'aac', '-f', 'mp4']);
  [job] = await getDB()('rec_jobs').insert({ public_id: 'job-pipeline', title: 'Pipeline', status: 'published' });
});
after(() => { getDB().destroy(); fs.rmSync(SAMPLES, { recursive: true, force: true }); });

// A candidate at the interview stage, through every question, ready to record
async function candidate() {
  const db = getDB(); n++;
  const [id] = await db('rec_applications').insert({ ref: `LP-T${n}`, access_hash: `h${n}`.padEnd(64, '0'), job_id: job, name: 'T', email: `t${n}@x.t`, phone: '+919000000000', resume_file: 'r.pdf', resume_name: 'r.pdf', status: 'prelim_pending', interview_expires_at: new Date(Date.now() + 86_400_000) });
  let a = await db('rec_applications').where({ id }).first();
  const iv = await R.startInterview(db, a, { accepted: true, version: 'v1' });
  for (let p = 0; p < 5; p++) await R.nextQuestion(db, a, p);
  a = await db('rec_applications').where({ id }).first();
  return { a, iv };
}
const split = (b: Buffer, parts: number) => { const size = Math.ceil(b.length / parts); return Array.from({ length: parts }, (_, i) => b.subarray(i * size, (i + 1) * size)); };
const END = Buffer.from([0]);
const verification = async (ivId: number) => { const iv = await getDB()('rec_interviews').where({ id: ivId }).first(); return { status: iv.processing_status, v: JSON.parse(iv.verification || '{}'), iv }; };
const finalFile = (iv: any) => path.join(R.recordingDir(iv.id), iv.final_file);

test('Chrome-style WebM: all chunks in order, retries and simultaneous repeats add nothing; verified with full sound and video', async () => {
  const { a, iv } = await candidate(); const db = getDB();
  const chunks = split(webm, 5);
  await R.saveChunk(db, a, 0, 0, false, chunks[0], 'video/webm', 1200);
  // The same chunk sent twice at the same moment, and the next one alongside: still each once, in order
  await Promise.all([R.saveChunk(db, a, 0, 1, false, chunks[1], 'video/webm', 2400), R.saveChunk(db, a, 0, 1, false, chunks[1], 'video/webm', 2400)]);
  assert.equal((await R.saveChunk(db, a, 0, 1, false, chunks[1], 'video/webm', 2400)).duplicate, true, 'a retry later is recognised');
  for (let i = 2; i < 5; i++) await R.saveChunk(db, a, 0, i, false, chunks[i], 'video/webm', 1200 * (i + 1));
  await assert.rejects(R.submitInterview(db, a), /not finished uploading/, 'never submitted before the last chunk arrives');
  await R.saveChunk(db, a, 0, 5, true, END, 'video/webm');
  await R.submitInterview(db, a);
  assert.equal((await verification(iv.id)).status, 'processing', 'shown as processing, not complete, until checked');
  assert.equal(await R.processRecording(db, iv.id), 'verified');
  const { v, iv: done } = await verification(iv.id);
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.manifest[0], { n: 0, expected: 6, received: 6, missing: [], bytes: webm.length, has_audio_file: false });
  // The built file is byte-for-byte the uploaded recording's content, and measures the true length on both tracks
  const fp = await probe(finalFile(done));
  assert.ok(fp.valid && fp.video && fp.audio);
  assert.ok(Math.abs(fp.video!.seconds - SECS) < 0.3, `video ${fp.video!.seconds}s`);
  assert.ok(Math.abs(fp.audio!.seconds - SECS) < 0.3, `sound ${fp.audio!.seconds}s`);
  assert.equal(fs.readFileSync(path.join(R.recordingDir(iv.id), 'processed', 'source-0.webm')).compare(webm), 0, 'chunks rebuilt exactly, none twice, none missing');
});

test('Apple-style: video and separately recorded sound become one file with both tracks, the right length and in step', async () => {
  const { a, iv } = await candidate(); const db = getDB();
  await R.saveChunk(db, a, 0, 0, false, mp4Video, '', SECS * 1000);   // unlabelled, like the iPhone
  await R.saveAudio(db, a, 0, m4a, 0);
  assert.equal((await R.saveAudio(db, a, 0, m4a, 0)).duplicate, true);
  await R.saveChunk(db, a, 0, 1, true, END, '');
  await R.submitInterview(db, a);
  assert.equal(await R.processRecording(db, iv.id), 'verified');
  const { v, iv: done } = await verification(iv.id);
  assert.equal(JSON.parse(done.segments)[0].mime, 'video/mp4', 'type read from the file itself');
  const fp = await probe(finalFile(done));
  assert.equal(fp.video?.codec, 'h264'); assert.equal(fp.audio?.codec, 'aac');
  assert.ok(Math.abs(fp.video!.seconds - SECS) < 0.3 && Math.abs(fp.audio!.seconds - SECS) < 0.3, JSON.stringify(v.final));
  assert.ok(Math.abs(fp.audio!.seconds - fp.video!.seconds) < 0.2, 'sound and video end together');
});

test('several parts (Apple records 30-second parts) are joined in order into one recording', async () => {
  const { a, iv } = await candidate(); const db = getDB();
  for (const seg of [0, 1]) {
    await R.saveChunk(db, a, seg, 0, false, mp4Video, 'video/mp4', SECS * 1000);
    await R.saveAudio(db, a, seg, m4a, 0);
    await R.saveChunk(db, a, seg, 1, true, END, 'video/mp4');
  }
  await R.submitInterview(db, a);
  assert.equal(await R.processRecording(db, iv.id), 'verified');
  const fp = await probe(finalFile((await verification(iv.id)).iv));
  assert.ok(Math.abs(fp.video!.seconds - 2 * SECS) < 0.5 && Math.abs(fp.audio!.seconds - 2 * SECS) < 0.5, `${fp.video!.seconds}/${fp.audio!.seconds}`);
});

test('missing sound is caught: the recording is "incomplete", never verified', async () => {
  const { a, iv } = await candidate(); const db = getDB();
  await R.saveChunk(db, a, 0, 0, false, webmSilent, 'video/webm', SECS * 1000);
  await R.saveChunk(db, a, 0, 1, true, END, 'video/webm');
  await R.submitInterview(db, a);
  assert.equal(await R.processRecording(db, iv.id), 'incomplete');
  assert.ok((await verification(iv.id)).v.problems.some((p: string) => /no sound/.test(p)));
});

test('missing video is caught', async () => {
  const { a, iv } = await candidate(); const db = getDB();
  await R.saveChunk(db, a, 0, 0, false, soundOnly, 'video/webm', SECS * 1000);
  await R.saveChunk(db, a, 0, 1, true, END, 'video/webm');
  await R.submitInterview(db, a);
  assert.equal(await R.processRecording(db, iv.id), 'incomplete');
  assert.ok((await verification(iv.id)).v.problems.some((p: string) => /no video/.test(p)));
});

test('a recording shorter than the time the camera ran (a lost stretch) is caught', async () => {
  const { a, iv } = await candidate(); const db = getDB();
  await R.saveChunk(db, a, 0, 0, false, webm, 'video/webm', 20_000);   // the candidate's clock says 20 s; only 6 s arrived
  await R.saveChunk(db, a, 0, 1, true, END, 'video/webm');
  await R.submitInterview(db, a);
  assert.equal(await R.processRecording(db, iv.id), 'incomplete');
  assert.ok((await verification(iv.id)).v.problems.some((p: string) => /lasts 6\.\d s but 20\.0 s were recorded/.test(p)));
});

test('a reload mid-interview keeps every chunk already uploaded and continues in a new part', async () => {
  const { a, iv } = await candidate(); const db = getDB();
  const [c0, c1] = split(webm, 2);
  await R.saveChunk(db, a, 0, 0, false, c0, 'video/webm', 3000);
  // The page reloads: the browser asks where it stands and starts the next part; part 0's chunk is still there
  const st = await R.interviewState(db, a);
  assert.equal(st.segments, 1);
  assert.ok(fs.existsSync(path.join(R.recordingDir(iv.id), 'segment-0', '000000.part')));
  await assert.rejects(R.saveChunk(db, a, 0, 2, false, c1, 'video/webm'), /Expected chunk 1/, 'a gap is refused');
  void c1;
});
