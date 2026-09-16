import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';
import CallModal from './CallModal';

const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

type CallState =
  | { phase: 'idle' }
  | { phase: 'incoming'; from: number; callerName: string; offer: RTCSessionDescriptionInit; callType: 'audio' | 'video' }
  | { phase: 'outgoing'; to: number; remoteName: string; callType: 'audio' | 'video' }
  | { phase: 'active'; remoteName: string; callType: 'audio' | 'video' };

export default function CallManager() {
  const { socket } = useSocket();
  const { user } = useAuth();
  const [call, setCall] = useState<CallState>({ phase: 'idle' });
  const pc = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  // Use ref so onicecandidate always has the current remote user id
  const remoteIdRef = useRef<number | null>(null);
  // Buffer ICE candidates that arrive before remote description is set
  const iceBuf = useRef<RTCIceCandidateInit[]>([]);

  const cleanup = () => {
    pc.current?.close(); pc.current = null;
    localStream.current?.getTracks().forEach(t => t.stop()); localStream.current = null;
    setRemoteStream(null);
    remoteIdRef.current = null;
    iceBuf.current = [];
    setCall({ phase: 'idle' });
  };

  const makePC = () => {
    const p = new RTCPeerConnection(STUN);
    const rs = new MediaStream();
    p.ontrack = e => {
      e.streams[0]?.getTracks().forEach(t => rs.addTrack(t));
      setRemoteStream(new MediaStream(rs.getTracks()));
    };
    p.onicecandidate = e => {
      if (!e.candidate || !socket || !remoteIdRef.current) return;
      socket.emit('ice-candidate', { to: remoteIdRef.current, candidate: e.candidate });
    };
    p.onconnectionstatechange = () => {
      if (p.connectionState === 'disconnected' || p.connectionState === 'failed') cleanup();
    };
    return p;
  };

  const addIceCandidate = async (candidate: RTCIceCandidateInit) => {
    if (!pc.current) return;
    if (pc.current.remoteDescription) {
      await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      iceBuf.current.push(candidate);
    }
  };

  const flushIceBuf = async () => {
    for (const c of iceBuf.current) {
      try { await pc.current?.addIceCandidate(new RTCIceCandidate(c)); } catch {}
    }
    iceBuf.current = [];
  };

  // Listen for signaling events
  useEffect(() => {
    if (!socket) return;

    socket.on('call-incoming', ({ from, offer, callerName, callType }) => {
      if (call.phase !== 'idle') { socket.emit('call-reject', { to: from }); return; }
      setCall({ phase: 'incoming', from, callerName, offer, callType });
    });

    socket.on('call-answered', async ({ answer }) => {
      if (!pc.current) return;
      await pc.current.setRemoteDescription(new RTCSessionDescription(answer));
      await flushIceBuf();
      setCall(c => c.phase === 'outgoing' ? { phase: 'active', remoteName: (c as any).remoteName, callType: (c as any).callType } : c);
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      await addIceCandidate(candidate);
    });

    socket.on('call-ended', cleanup);
    socket.on('call-rejected', () => { cleanup(); alert('Call was declined.'); });

    return () => {
      socket.off('call-incoming');
      socket.off('call-answered');
      socket.off('ice-candidate');
      socket.off('call-ended');
      socket.off('call-rejected');
    };
  }, [socket, call.phase]);

  const getStream = async (callType: 'audio' | 'video'): Promise<{ stream: MediaStream; type: 'audio' | 'video' }> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' });
      return { stream, type: callType };
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return { stream, type: 'audio' };
      } catch {
        throw new Error('No microphone found. Please connect a microphone and try again.');
      }
    }
  };

  const startCall = async (toUserId: number, remoteName: string, callType: 'audio' | 'video') => {
    if (!socket || !user) return;
    let stream: MediaStream;
    try {
      const r = await getStream(callType);
      stream = r.stream; callType = r.type;
    } catch (e: any) { alert(e.message); return; }

    remoteIdRef.current = toUserId;
    localStream.current = stream;
    const p = makePC();
    pc.current = p;
    stream.getTracks().forEach(t => p.addTrack(t, stream));
    const offer = await p.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: callType === 'video' });
    await p.setLocalDescription(offer);
    setCall({ phase: 'outgoing', to: toUserId, remoteName, callType });
    socket.emit('call-offer', { to: toUserId, from: user.id, offer, callerName: user.name, callType });
  };

  const acceptCall = async () => {
    if (call.phase !== 'incoming' || !socket) return;
    const { from, offer } = call;
    let { callType } = call;
    let stream: MediaStream;
    try {
      const r = await getStream(callType);
      stream = r.stream; callType = r.type;
    } catch (e: any) { alert(e.message); return; }

    remoteIdRef.current = from;
    localStream.current = stream;
    const p = makePC();
    pc.current = p;
    stream.getTracks().forEach(t => p.addTrack(t, stream));
    await p.setRemoteDescription(new RTCSessionDescription(offer));
    await flushIceBuf();
    const answer = await p.createAnswer();
    await p.setLocalDescription(answer);
    socket.emit('call-answer', { to: from, answer });
    setCall({ phase: 'active', remoteName: call.callerName, callType });
  };

  const rejectCall = () => {
    if (call.phase !== 'incoming' || !socket) return;
    socket.emit('call-reject', { to: call.from });
    cleanup();
  };

  const endCall = () => {
    if (!socket) return;
    const to = call.phase === 'outgoing' ? (call as any).to : call.phase === 'incoming' ? (call as any).from : remoteIdRef.current;
    if (to) socket.emit('call-end', { to });
    cleanup();
  };

  // Expose startCall globally so Messages.tsx can trigger it
  useEffect(() => {
    (window as any).__startCall = startCall;
    return () => { delete (window as any).__startCall; };
  }, [socket, user, call.phase]);

  if (call.phase === 'idle') return null;

  return (
    <CallModal
      mode={call.phase === 'incoming' ? 'incoming' : call.phase === 'outgoing' ? 'outgoing' : 'active'}
      callType={(call as any).callType}
      remoteName={(call as any).remoteName ?? (call as any).callerName}
      localStream={localStream.current}
      remoteStream={remoteStream}
      onAccept={acceptCall}
      onReject={rejectCall}
      onEnd={endCall}
    />
  );
}
