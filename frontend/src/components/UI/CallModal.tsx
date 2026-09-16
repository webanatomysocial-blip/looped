import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Phone } from 'lucide-react';

interface Props {
  mode: 'outgoing' | 'incoming' | 'active';
  callType: 'audio' | 'video';
  remoteName: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onAccept?: () => void;
  onReject?: () => void;
  onEnd: () => void;
}

export default function CallModal({ mode, callType, remoteName, localStream, remoteStream, onAccept, onReject, onEnd }: Props) {
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (mode !== 'active') return;
    const iv = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(iv);
  }, [mode]);

  const fmtElapsed = () => {
    const m = Math.floor(elapsed / 60), s = elapsed % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };

  const toggleMute = () => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setMuted(m => !m);
  };

  const toggleCam = () => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    setCamOff(c => !c);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: callType === 'video' && mode === 'active' ? 'transparent' : 'rgba(10,10,10,0.92)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Remote video background */}
      {callType === 'video' && mode === 'active' && (
        <video ref={remoteVideoRef} autoPlay playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#111' }} />
      )}

      {/* Overlay content */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        {/* Avatar / name */}
        <div style={{ width: 80, height: 80, borderRadius: 40, background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#fff', fontWeight: 700 }}>
          {remoteName.charAt(0).toUpperCase()}
        </div>
        <div style={{ color: '#fff', fontSize: 22, fontWeight: 700 }}>{remoteName}</div>
        <div style={{ color: '#94a3b8', fontSize: 14 }}>
          {mode === 'outgoing' ? 'Calling…' : mode === 'incoming' ? `Incoming ${callType} call` : fmtElapsed()}
        </div>

        {/* Local video pip */}
        {callType === 'video' && localStream && (
          <video ref={localVideoRef} autoPlay playsInline muted
            style={{ width: 120, height: 90, borderRadius: 10, objectFit: 'cover', background: '#000', border: '2px solid #334155' }} />
        )}

        {/* Audio remote (hidden video element) */}
        {callType === 'audio' && <video ref={remoteVideoRef} autoPlay playsInline style={{ display: 'none' }} />}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
          {mode === 'incoming' ? (
            <>
              <button onClick={onReject} style={btnStyle('#ef4444')}>
                <PhoneOff size={22} color="#fff" />
              </button>
              <button onClick={onAccept} style={btnStyle('#22c55e')}>
                <Phone size={22} color="#fff" />
              </button>
            </>
          ) : (
            <>
              {callType === 'video' && (
                <button onClick={toggleCam} style={btnStyle(camOff ? '#475569' : '#1e293b')}>
                  {camOff ? <VideoOff size={20} color="#fff" /> : <Video size={20} color="#fff" />}
                </button>
              )}
              <button onClick={toggleMute} style={btnStyle(muted ? '#475569' : '#1e293b')}>
                {muted ? <MicOff size={20} color="#fff" /> : <Mic size={20} color="#fff" />}
              </button>
              <button onClick={onEnd} style={btnStyle('#ef4444')}>
                <PhoneOff size={22} color="#fff" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function btnStyle(bg: string) {
  return {
    width: 56, height: 56, borderRadius: 28, background: bg,
    border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}
