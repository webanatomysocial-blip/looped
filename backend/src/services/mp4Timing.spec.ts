/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixVideoTiming, sniffVideo } from './mp4Timing';

const box = (type: string, ...parts: Buffer[]) => { const body = Buffer.concat(parts); const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
const u32 = (...n: number[]) => { const b = Buffer.alloc(4 * n.length); n.forEach((v, i) => b.writeUInt32BE(v, 4 * i)); return b; };
// An iPhone-style recording: video track 1 at timescale 600, three frames each stamped 1 tick (1/600 s)
const tkhd = box('tkhd', u32(0, 0, 0, 1, 0));                        // version/flags, created, modified, track id 1
const mdhd = box('mdhd', u32(0, 0, 0, 600, 0));                      // version/flags, created, modified, timescale 600
const hdlr = box('hdlr', u32(0, 0), Buffer.from('vide'), u32(0, 0, 0));
const moov = box('moov', box('trak', tkhd, box('mdia', mdhd, hdlr)));
const trun = box('trun', u32(0x000100, 3, 1, 1, 1));                 // per-frame durations, 3 frames of 1 tick
const moof = box('moof', box('traf', box('tfhd', u32(0, 1)), trun));
const file = () => Buffer.concat([box('ftyp', Buffer.from('iso5')), moov, moof, box('mdat', Buffer.from('frames'))]);
const durations = (b: Buffer) => { const at = b.indexOf(Buffer.from('trun')) + 4 + 8; return [0, 1, 2].map((i) => b.readUInt32BE(at + 4 * i)); };

test('iPhone MP4 frames stamped far too short get the real length spread over them (no more fast-forward)', () => {
  const b = file(); const size = b.length;
  assert.equal(fixVideoTiming(b, 1000), 3);
  assert.deepEqual(durations(b), [200, 200, 200], '1 second = 600 ticks over 3 frames');
  assert.equal(b.length, size, 'same size: only the numbers change');
  assert.equal(fixVideoTiming(b, 1000), 0, 'a file already about right is never touched');
});

test('the real type is read from the file, not the label', () => {
  assert.equal(sniffVideo(file()), 'video/mp4');
  assert.equal(sniffVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f])), 'video/webm');
  assert.equal(sniffVideo(Buffer.from([0])), null);
});

