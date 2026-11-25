// The recorded preliminary interview. Consent first; then the camera and microphone record continuously, in short
// chunks uploaded in order (retried until they arrive). One question at a time with a timer. Activity such as leaving
// the tab or exiting fullscreen is logged for the reviewers: it is an indicator, never an automatic decision.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { careersApi } from '../services/api';
import { CareersShell } from './Careers';
import '../css/pages/Recruitment.css';

const CHUNK_MS = 5000;
// Safari/iPhone (every iOS browser is WebKit) breaks recordings made in timed slices (WebM with wrong timestamps, MP4
// with no data). There each part is recorded whole, as MP4, and a new part starts every PART_MS: every part plays.
const APPLE = typeof navigator !== 'undefined' && /Apple/.test(navigator.vendor || '');
const PART_MS = 30_000;
const pickMime = () => (APPLE ? ['video/mp4', 'video/webm'] : ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']).find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
const END = () => new Blob([new Uint8Array(1)]);   // one empty byte: "this part ended" (the server does not store it)
// Says what actually went wrong (the old catch-all hid it): our server's own message, else the kind of failure
export const msg = (e: any) => {
  if (e?.response?.data?.error) return e.response.data.error;
  if (!e?.response) return "We couldn't reach our server. Please check your internet connection and try again.";
  if (e.response.status === 413) return 'This upload was too large for our server. Please email us below so we can help.';
  if (e.response.status >= 500) return 'Our server had a problem. Please wait a minute and try again.';
  return `Something went wrong (error ${e.response.status}). Please try again.`;
};
// Pieces under 1 MB: web servers in front of the app often refuse bigger uploads (the server joins them back in order)
const PIECE = 900 * 1024;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

// After the interview: the candidate confirms their WhatsApp number (prefilled from the application). Confirming
// sends a welcome message with a new private tracking link to that number (the earlier link stops working).
function WhatsAppConfirm({ token, phone, done }: { token: string; phone: string; done: boolean }) {
  const [number, setNumber] = useState(phone || ''); const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ tracking_url: string; number: string } | null>(null); const [error, setError] = useState('');
  if (sent) return (
    <section className="careers-block">
      <div className="careers-ok">Confirmed. Updates about your application will come to WhatsApp <b>+{sent.number}</b>. We've just sent you a welcome message with your private status link.</div>
      <p className="careers-text" style={{ marginTop: 12 }}><b>Your status link</b> (keep it private; any earlier link no longer works):</p>
      <div className="careers-track-link"><a href={sent.tracking_url}>{sent.tracking_url}</a></div>
    </section>
  );
  if (done) return <section className="careers-block"><p className="careers-text">Your WhatsApp number is confirmed. Updates about your application will come there.</p></section>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try { setSent((await careersApi.confirmWhatsApp(token, number)).data); }
    catch (err: any) { setError(err?.response?.data?.error || 'Could not confirm the number. Please try again.'); }
    finally { setBusy(false); }
  };
  return (
    <form className="iv-wa" onSubmit={submit}>
      <div className="iv-wa__icon" aria-hidden="true">💬</div>
      <div className="iv-wa__body">
        <h3>Get updates on WhatsApp</h3>
        <p>Updates about your interview will come to your WhatsApp. Please confirm your number.</p>
        <div className="iv-wa__row">
          <input className="form-input" type="tel" inputMode="tel" required value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 98765 43210" aria-label="WhatsApp number" />
          <button className="btn-primary" disabled={busy || !number.trim()}>{busy ? 'Confirming…' : 'Confirm number'}</button>
        </div>
        <span className="rec-muted" style={{ fontSize: 12 }}>10 digits are taken as an Indian number; for other countries, include the country code.</span>
        {error && <p className="rec-error" role="alert">{error}</p>}
      </div>
    </form>
  );
}

// When something goes wrong (camera, microphone, recording, upload): a direct way to reach the team
const HELP_TO = 'webanatomysocial@gmail.com,srujan@mosol9.com,supraja@mosol9.com';
function HelpBox({ job, name, problem }: { job: string; name: string; problem?: string }) {
  const subject = `Video interview problem: ${job}${name ? ` (${name})` : ''}`;
  const body = `Hi team,\n\nI had a problem with my video interview for ${job}.\n\nWhat happened: ${problem || ''}\n\nBrowser / device: ${navigator.userAgent}\n\nThank you,\n${name || ''}`;
  const href = `mailto:${HELP_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <div className="iv-help" role="alert">
      <div><b>Having trouble with your interview?</b><span>Something didn't work as expected. Write to us and we'll help you finish it. Your progress so far is saved.</span></div>
      <a className="btn-primary" href={href}>✉ Email us</a>
    </div>
  );
}

export default function CareerInterview() {
  const { token } = useParams();
  // Coming straight from the application form: the private tracking link, so it isn't lost
  const came = (useLocation().state ?? null) as { track?: string; ref?: string } | null;
  const trackUrl = came?.track ? `${window.location.origin}/careers/track/${came.track}` : '';
  const trackBox = trackUrl ? (
    <div className="careers-track-link">
      <b>Your private status link</b> (save it; don't share it):
      <a href={trackUrl}>{trackUrl}</a>
    </div>
  ) : null;
  const [st, setSt] = useState<any>(null); const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null); const [deviceError, setDeviceError] = useState('');
  const [phase, setPhase] = useState<'intro' | 'live' | 'finishing' | 'done'>('intro');
  const [left, setLeft] = useState(0); const [pending, setPending] = useState(0); const [offline, setOffline] = useState(!navigator.onLine);
  const [submitError, setSubmitError] = useState('');
  const [warning, setWarning] = useState<{ message: string; level: string } | null>(null); const [paused, setPaused] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const rec = useRef<{ recorder: MediaRecorder | null; seg: number; seq: number; queue: { seg: number; seq: number; blob: Blob; last: boolean; ms?: number; audio?: boolean; offset?: number }[]; running: boolean; stopped: Promise<void> | null }>({ recorder: null, seg: 0, seq: 0, queue: [], running: false, stopped: null });
  const events = useRef<any[]>([]);
  const position = useRef(0);
  const failed = useRef(false);
  const finishing = useRef(false);
  const pausedRef = useRef(false);
  const startedAt = useRef(0);   // when recording started on this page (for the camera-pause log)   // no new recording part once the interview is ending

  useEffect(() => { careersApi.interview(token!).then((r) => { setSt(r.data); if (r.data.state === 'submitted') setPhase('done'); }).catch((e) => setError(msg(e))); }, [token]);
  useEffect(() => { if (video.current && stream) video.current.srcObject = stream; }, [stream, phase]);
  useEffect(() => () => { stream?.getTracks().forEach((t) => t.stop()); }, [stream]);

  const note = (type: string, detail?: string) => { events.current.push({ type, detail, position: position.current, at: new Date().toISOString() }); };
  // Paused for review: no more questions; the recording is closed and what was recorded still uploads
  const onPaused = () => {
    if (pausedRef.current) return; pausedRef.current = true; setPaused(true);
    const r = rec.current; finishing.current = true;
    (r as any).stopNow?.();
    void (r.stopped ?? Promise.resolve()).then(() => pump()).finally(() => stream?.getTracks().forEach((t) => t.stop()));
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  };
  const flushEvents = async () => {
    if (!events.current.length) return;
    const batch = events.current.splice(0, 50);
    try {
      const w = (await careersApi.events(token!, batch)).data?.warning;
      if (w?.paused) onPaused(); else if (w) setWarning({ message: w.message, level: w.level });
    } catch (e: any) { if (e?.response?.status === 423) onPaused(); else events.current.unshift(...batch); }
  };

  // Uploads chunks one by one, in order, retrying with a growing pause; nothing is skipped
  const pump = async () => {
    const r = rec.current;
    if (r.running) return;
    r.running = true;
    let wait = 1000;
    while (r.queue.length) {
      const c = r.queue[0];
      const form = new FormData();
      form.append('segment', String(c.seg)); form.append('seq', String(c.seq)); form.append('last', String(c.last));
      if (c.ms) form.append('ms', String(c.ms));
      if (c.offset !== undefined) form.append('offset_ms', String(c.offset));
      form.append('chunk', c.blob, c.audio ? 'sound.m4a' : 'chunk.webm');
      try { await (c.audio ? careersApi.audio(token!, form) : careersApi.chunk(token!, form)); r.queue.shift(); wait = 1000; setPending(r.queue.length); }
      catch (e: any) {
        if (e?.response?.status === 409 && /Expected chunk (\d+)/.test(e.response.data?.error ?? '') && Number(RegExp.$1) > c.seq) { r.queue.shift(); continue; }   // already stored
        if (e?.response && e.response.status !== 429 && e.response.status < 500) {
          // Recorded for the reviewers, with the error code, so a failed upload can be explained
          note('recording_interrupted', `upload refused (error ${e.response.status}${c.audio ? ', sound' : ''}, part ${c.seg + 1})`); void flushEvents();
          failed.current = true; setSubmitError(msg(e)); break;
        }
        await new Promise((res) => setTimeout(res, wait)); wait = Math.min(wait * 2, 15000);
      }
    }
    r.running = false;
  };

  const getDevices = async () => {
    setDeviceError('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
      s.getVideoTracks()[0]?.addEventListener('ended', () => { note('camera_lost', 'camera stopped'); void reconnectCamera(); });
      s.getAudioTracks()[0]?.addEventListener('ended', () => note('microphone_lost'));
      // The device silencing the microphone without ending it (seen on iPhone): logged with the moment it happened
      s.getAudioTracks()[0]?.addEventListener('mute', () => note('microphone_lost', 'muted by the device'));
      s.getAudioTracks()[0]?.addEventListener('unmute', () => note('recording_resumed', 'microphone back'));
      setStream(s);
      return s;
    } catch (e: any) { setDeviceError(e?.name === 'NotAllowedError' ? 'Camera and microphone access was blocked. Allow access in your browser settings and try again.' : 'No camera or microphone was found. Please connect them and try again.'); }
  };

  // The camera stopping mid-interview (phone locked, app switched, camera taken by another app): ask for it again and
  // continue the recording in a new part with the picture; tried again whenever the page comes back into view
  const reconnecting = useRef(false);
  const reconnectCamera = async () => {
    const r = rec.current;
    if (reconnecting.current || finishing.current || pausedRef.current || !r.recorder || document.visibilityState !== 'visible') return;
    reconnecting.current = true;
    try {
      const fresh = await getDevices();
      if (!fresh?.getVideoTracks().some((t) => t.readyState === 'live') || finishing.current) return;
      (r as any).stopNow?.(); await r.stopped;
      if (finishing.current || pausedRef.current) { fresh.getTracks().forEach((t) => t.stop()); return; }
      startRecorder(await recordable(fresh), r.seg + 1);
      note('recording_resumed', 'camera reconnected');
    } finally { reconnecting.current = false; }
  };
  useEffect(() => {
    if (phase !== 'live') return;
    const back = () => { if (document.visibilityState === 'visible' && stream && !stream.getVideoTracks().some((t) => t.readyState === 'live')) void reconnectCamera(); };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [phase, stream]);

  // A new recorder is a new segment: every segment is a complete, playable file
  const startRecorder = (s: MediaStream, segment: number, plain = false) => {
    const mime = plain ? '' : pickMime();
    const recorder = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 600_000, audioBitsPerSecond: 64_000 });
    // Apple's recorder drops the sound from the video after about half a second: there the microphone is also
    // recorded on its own, and the dashboard plays it with the video
    const AUDIO_MIME = ['audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const soundRec = APPLE && !plain && AUDIO_MIME && s.getAudioTracks().length ? new MediaRecorder(new MediaStream(s.getAudioTracks()), { mimeType: AUDIO_MIME }) : null;
    let resolveSound: () => void = () => {}; let videoStart = 0; let soundStart = 0;
    const soundDone = soundRec ? new Promise<void>((res) => { resolveSound = res; }) : Promise.resolve();
    if (soundRec) {
      // When each recorder really started: the sound is placed on the video's timeline by the difference
      recorder.onstart = () => { videoStart = performance.now(); };
      soundRec.onstart = () => { soundStart = performance.now(); };
      soundRec.ondataavailable = (ev) => { if (ev.data.size) { r.queue.push({ seg: segment, seq: -1, blob: ev.data, last: true, audio: true, offset: videoStart && soundStart ? Math.round(soundStart - videoStart) : 0 }); setPending(r.queue.length); void pump(); } };
      soundRec.onstop = () => setTimeout(resolveSound, 0);
    }
    const r = rec.current;
    r.recorder = recorder; r.seg = segment; r.seq = 0;
    let gotData = false; let ended = false;
    let resolveStop: () => void = () => {};
    r.stopped = new Promise((res) => { resolveStop = res; });
    const startedAt = Date.now();
    // How long the camera really ran for this piece: the server uses it to fix Safari's frame timing
    const push = (blob: Blob, last: boolean) => {
      const ms = last ? undefined : Date.now() - startedAt;
      for (let at = 0; at < blob.size || (at === 0 && !blob.size); at += PIECE) r.queue.push({ seg: segment, seq: r.seq++, blob: blob.size > PIECE ? blob.slice(at, at + PIECE, blob.type) : blob, last, ms });
      setPending(r.queue.length); void pump();
    };
    // Every part closes with the end marker, once, whether or not the browser sent anything
    // The part closes after its sound file (if any) is queued, so finishing waits for both; never more than 5 s
    const end = () => { if (ended) return; ended = true; if (!gotData) note('recording_interrupted', 'no video from the camera in this part');
      void Promise.race([soundDone, new Promise((res) => setTimeout(res, 5000))]).then(() => { push(END(), true); resolveStop(); }); };
    recorder.ondataavailable = (ev) => { if (ev.data.size && !ended) { gotData = true; push(ev.data, false); } };
    recorder.onstop = () => setTimeout(end, 0);   // after the last data event
    recorder.onerror = () => note('recording_interrupted', 'recorder error');
    // A browser that never reports the stop must not hold the interview: close the part anyway
    const stopNow = () => {
      if (soundRec && soundRec.state !== 'inactive') try { soundRec.stop(); } catch { resolveSound(); }
      if (recorder.state !== 'inactive') try { recorder.stop(); } catch { /* already stopped */ }
      setTimeout(end, 8000);
    };
    (r as any).stopNow = stopNow;
    if (APPLE && !plain) {
      recorder.start(); soundRec?.start();
      // Next part: stop this one (its data arrives whole) and start a fresh recorder
      setTimeout(async () => {
        if (finishing.current || r.recorder !== recorder) return;
        stopNow(); await r.stopped;
        if (!finishing.current && r.recorder === recorder) startRecorder(s, segment + 1, !gotData);
      }, PART_MS);
    } else {
      recorder.start(CHUNK_MS);
      // Some browsers accept a format and then record nothing: restart once in the browser's own format
      if (!plain) setTimeout(async () => {
        if (gotData || finishing.current || r.recorder !== recorder) return;
        stopNow(); await r.stopped;
        if (!finishing.current && r.recorder === recorder) startRecorder(s, segment + 1, true);
      }, CHUNK_MS * 3);
    }
  };

  // iPhone/Safari: the microphone stops reaching MediaRecorder about half a second in (measured: 0.5 s of sound in
  // 30 s, in the video and in a separate sound-only recording alike). Routed through the browser's audio engine
  // (Web Audio, started by the candidate's tap) the sound keeps flowing; the camera picture is recorded as it is.
  const audioCtx = useRef<AudioContext | null>(null);
  const recordable = async (s: MediaStream): Promise<MediaStream> => {
    if (!APPLE || !s.getAudioTracks().length || typeof AudioContext === 'undefined') return s;
    try {
      const ctx = audioCtx.current ?? new AudioContext(); audioCtx.current = ctx;
      await ctx.resume();
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest);
      return new MediaStream([...s.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    } catch { note('recording_interrupted', 'audio engine unavailable; recording the microphone directly'); return s; }
  };
  useEffect(() => () => { void audioCtx.current?.close(); }, []);

  const begin = async () => {
    if (!stream) return;
    setError('');
    // A camera that stopped after the preview (phone locked, app switched, camera taken by another app) records sound only:
    // ask for it again, and never start a recording without a picture
    const camOk = (m?: MediaStream | null) => !!m?.getVideoTracks().some((t) => t.readyState === 'live');
    let use = stream;
    if (!camOk(use)) { use.getTracks().forEach((t) => t.stop()); use = (await getDevices()) ?? use; }
    if (!camOk(use)) { setError('Your camera is not working right now. Close other apps using the camera, allow camera access, then try again.'); return; }
    try {
      const r = st.state === 'not_started' ? await careersApi.start(token!, st.consent_version) : await careersApi.interview(token!);
      setSt(r.data); position.current = r.data.position;
      if (st.state === 'in_progress') note('page_reload', 'resumed after leaving the page');
      note('device_info', `${pickMime() || 'browser default'} · ${navigator.userAgent}`.slice(0, 300));
      startedAt.current = performance.now();
      startRecorder(await recordable(use), r.data.segments);
      note('recording_started', `part ${r.data.segments + 1}`);
      setPhase('live');
      try { await document.documentElement.requestFullscreen?.(); } catch { /* optional */ }
      if (r.data.position >= r.data.question_count) void finish();
    } catch (e) { setError(msg(e)); }
  };

  // Monitoring while live
  useEffect(() => {
    if (phase !== 'live') return;
    const on = (t: any, ev: string, fn: any) => { t.addEventListener(ev, fn); return () => t.removeEventListener(ev, fn); };
    let hiddenAt = 0;
    const offs = [
      // How long the candidate was away, when they come back
      on(document, 'visibilitychange', () => { if (document.hidden) { hiddenAt = Date.now(); note('tab_hidden'); } else { note('tab_visible', hiddenAt ? `away ${Math.round((Date.now() - hiddenAt) / 1000)} s` : undefined); hiddenAt = 0; void flushEvents(); } }),
      on(window, 'blur', () => note('window_blur')), on(window, 'focus', () => note('window_focus')),
      on(document, 'fullscreenchange', () => note(document.fullscreenElement ? 'fullscreen_enter' : 'fullscreen_exit')),
      on(document, 'copy', (e: Event) => { e.preventDefault(); note('copy_attempt'); }),
      on(document, 'paste', (e: Event) => { e.preventDefault(); note('paste_attempt'); }),
      on(document, 'contextmenu', (e: Event) => e.preventDefault()),
      on(window, 'offline', () => { setOffline(true); note('network_offline'); }),
      on(window, 'online', () => { setOffline(false); note('network_online'); void pump(); }),
      on(window, 'beforeunload', (e: BeforeUnloadEvent) => { note('navigation_attempt'); e.preventDefault(); e.returnValue = ''; }),
    ];
    const perms = ['camera', 'microphone'].map((n) => (navigator.permissions?.query({ name: n as PermissionName }) ?? Promise.reject()).then((p) => { p.onchange = () => note('permission_changed', `${n}: ${p.state}`); }).catch(() => undefined));
    const flush = setInterval(flushEvents, 5000);
    // A regular sign of life, so the server can tell a lost connection from a quiet candidate. Refused with 409
    // when the interview was opened in another tab or device: this page stops.
    const beat = () => careersApi.heartbeat(token!).catch((e) => {
      if (e?.response?.status === 423) { clearInterval(beats); onPaused(); return; }
      if (e?.response?.status !== 409) return;
      clearInterval(beats); rec.current.recorder?.state === 'recording' && rec.current.recorder.stop();
      stream?.getTracks().forEach((t) => t.stop()); setError(msg(e));
    });
    void beat(); const beats = setInterval(beat, 15000);
    // The same interview in two tabs of this browser
    const bc = 'BroadcastChannel' in window ? new BroadcastChannel(`iv-${token}`) : null;
    if (bc) { bc.onmessage = () => { note('multiple_tabs', 'the interview is also open in another tab of this browser'); void flushEvents(); }; bc.postMessage('open'); }
    // Closing or leaving the page: sent even as the page goes away
    const exit = () => navigator.sendBeacon?.(`/api/public/careers/interview/${token}/events`, new Blob([JSON.stringify({ events: [...events.current.splice(0), { type: 'page_exit', position: position.current, at: new Date().toISOString() }] })], { type: 'application/json' }));
    window.addEventListener('pagehide', exit);
    // The camera pausing (no new picture for over a second): logged with when and how long, since the recording's
    // picture then runs short of its sound (seen on iPhone: 9 s missing from the first part)
    const live = startedAt.current;
    const cam = video.current as any; let lastFrame = 0; let watching = true;
    const onFrame = () => {
      if (!watching) return;
      const now = performance.now();
      if (lastFrame && now - lastFrame > 1000) note('camera_lost', `no picture for ${((now - lastFrame) / 1000).toFixed(1)} s, from ${((lastFrame - live) / 1000).toFixed(1)} s into the recording`);
      lastFrame = now; cam?.requestVideoFrameCallback?.(onFrame);
    };
    cam?.requestVideoFrameCallback?.(onFrame);
    // The first picture after recording started: a late one means the start of the recording has no picture
    const firstCheck = setTimeout(() => { if (!lastFrame) note('camera_lost', 'no picture in the first 3 s of the recording'); }, 3000);
    return () => { offs.forEach((f) => f()); clearInterval(flush); clearInterval(beats); bc?.close(); window.removeEventListener('pagehide', exit); clearTimeout(firstCheck); watching = false; void perms; };
  }, [phase]);

  // Question timer: counts down from what the server says is left, so a refresh does not reset it
  useEffect(() => {
    if (phase !== 'live' || !st?.current) return;
    setLeft(st.current.seconds_left);
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [phase, st?.current?.position]);
  useEffect(() => { if (phase === 'live' && st?.current && left <= 0) void next(); }, [left]);

  const advancing = useRef(false);
  const next = async () => {
    if (advancing.current || !st?.current) return;
    advancing.current = true;
    try {
      const r = await careersApi.next(token!, st.current.position);
      setSt(r.data); position.current = r.data.position;
      if (r.data.position >= r.data.question_count) await finish();
    } catch (e: any) { if (e?.response?.status === 423) onPaused(); else setError(msg(e)); } finally { advancing.current = false; }
  };

  // Stop recording, wait for every chunk to arrive, then submit. Never reported as done if anything failed.
  const finish = async () => {
    setPhase('finishing'); setSubmitError(''); failed.current = false; finishing.current = true;
    const r = rec.current;
    // Close the current part (a part between restarts is waited for too); bounded, so this never hangs
    if (r.recorder) { (r as any).stopNow?.(); await r.stopped; }
    await flushEvents();
    while (r.queue.length || r.running) { await pump(); if (failed.current) return; await new Promise((res) => setTimeout(res, 500)); }
    try {
      await careersApi.submit(token!);
      stream?.getTracks().forEach((t) => t.stop());
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
      setPhase('done');
    } catch (e) { setSubmitError(msg(e)); }
  };

  if (error && !st) return <CareersShell><div className="rec-empty">{error}</div></CareersShell>;
  if (!st) return <CareersShell><div className="rec-empty">Loading…</div></CareersShell>;
  if (phase === 'done') return <CareersShell><div className="rec-card careers-detail"><h1>Interview submitted ✓</h1><p className="careers-text">Thank you, {st.name}. Your video interview for {st.job} has been received and will be reviewed by our team.</p><WhatsAppConfirm token={token!} phone={st.phone} done={st.whatsapp_confirmed} /></div></CareersShell>;
  if (paused || st.state === 'paused') return <CareersShell><div className="rec-card careers-detail"><h1>Interview paused</h1><p className="careers-text" role="alert">{st.paused_message ?? 'Your interview has been paused because repeated interview-rule violations were detected. Your application is under review. The recruitment team will contact you regarding the next step.'}</p>{pending > 0 && <p className="rec-muted">Please keep this page open a moment while your recording finishes uploading.</p>}</div></CareersShell>;
  if (st.state === 'closed') return <CareersShell><div className="rec-empty">This interview is no longer available.</div></CareersShell>;

  if (phase === 'intro') return (
    <CareersShell>
      <div className="rec-card careers-detail">
        {came?.ref && <div className="careers-ok">Application received · reference <b>{came.ref}</b>. Next: your video interview.</div>}
        <h1>Video interview · {st.job}</h1>
        {trackBox}
        <ul className="careers-text" style={{ paddingLeft: 18 }}>
          <li>{st.question_count} questions, shown one at a time. You have {fmt(st.seconds_per_question)} for each; it moves on automatically when time is up, or click <b>Next</b> when you're done.</li>
          <li>About {st.estimated_minutes} minutes in total. Use a quiet, well-lit place and a stable internet connection.</li>
          <li>Answer out loud to the camera. Stay on this page and in fullscreen until you finish.</li>
          <li><b>Interview rules:</b> leaving this page, or opening the interview in another tab or on another device, gives a warning. After {st.warnings?.max ?? 3} warnings, one more pauses the interview for review by our team. Connection or camera problems are not counted as warnings.</li>
          <li>If your connection drops, keep this page open: the recording resumes uploading by itself.</li>
        </ul>
        {st.state === 'in_progress' && <div className="iv-warn">You started this interview earlier. It will continue from question {st.position + 1}; the recording continues from here.</div>}
        <div className="rec-section">
          <h3>Camera &amp; microphone</h3>
          {stream ? (
            <div className="iv-cam" style={{ maxWidth: 640 }}><video ref={video} autoPlay muted playsInline /><p className="rec-muted">✓ Camera {stream.getVideoTracks().length ? 'connected' : 'missing'} · ✓ Microphone {stream.getAudioTracks().length ? 'connected' : 'missing'}</p></div>
          ) : <div><button className="btn-secondary" onClick={getDevices}>Check camera &amp; microphone</button></div>}
          {deviceError && <p className="rec-error">{deviceError}</p>}
        </div>
        {st.state === 'not_started' && (
          <div className="rec-section">
            <h3>Recording consent</h3>
            <p className="careers-text">{st.consent_text}</p>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I have read this and I agree to the recording of my interview.</label>
          </div>
        )}
        {error && <p className="rec-error">{error}</p>}
        {(error || deviceError) && <HelpBox job={st.job} name={st.name} problem={error || deviceError} />}
        {!pickMime() && typeof MediaRecorder === 'undefined' && <p className="rec-error">This browser cannot record video. Please use the latest Chrome, Edge, Firefox or Safari.</p>}
        <button className="btn-primary" disabled={!stream || (st.state === 'not_started' && !consent)} onClick={begin}>{st.state === 'in_progress' ? 'Resume interview' : 'Start interview'}</button>
      </div>
    </CareersShell>
  );

  const total = st.question_count; const pos = Math.min(st.position, total);
  return (
    <CareersShell wide>
      <div className="rec-card rec-card--pad iv-live">
        <div className="iv-progress" style={{ marginBottom: 14 }}><i style={{ width: `${(pos / total) * 100}%` }} /></div>
        {warning && <div className={`iv-warn ${warning.level === 'final' ? 'iv-warn--final' : ''}`} role="alert" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}><span style={{ flex: 1 }}>{warning.message}</span><button type="button" className="btn-secondary" onClick={() => setWarning(null)}>I understand</button></div>}
        {offline && <div className="iv-warn" style={{ marginBottom: 12 }}>You're offline. Keep this page open; the recording will upload when the connection returns.</div>}
        <div className="iv-stage">
          <div className="iv-cam"><video ref={video} autoPlay muted playsInline /><span className="iv-rec"><i />REC</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {phase === 'live' && st.current ? (<>
              <span className="rec-muted">Question {st.current.position + 1} of {total} · {st.current.category}</span>
              <p className="iv-question">{st.current.text}</p>
              <span className={`iv-timer ${left <= 15 ? 'iv-timer--low' : ''}`}>{fmt(left)}</span>
              <div className="rec-actions">
                <button className="btn-primary" onClick={next}>{st.current.position + 1 === total ? 'Finish' : 'Next question'}</button>
                {!document.fullscreenElement && <button className="btn-secondary" onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)}>Fullscreen</button>}
              </div>
            </>) : (<>
              <p className="iv-question">Finishing up…</p>
              <p className="careers-text">{pending > 0 ? `Uploading your recording (${pending} part${pending > 1 ? 's' : ''} left). Please keep this page open.` : 'Submitting your interview…'}</p>
              {submitError && <><p className="rec-error">{submitError}</p><div><button className="btn-primary" onClick={finish}>Try again</button></div><HelpBox job={st.job} name={st.name} problem={submitError} /></>}
            </>)}
            {pending > 2 && phase === 'live' && <span className="rec-muted">Uploading… {pending} parts waiting</span>}
          </div>
        </div>
      </div>
    </CareersShell>
  );
}
