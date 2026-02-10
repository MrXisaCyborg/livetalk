import React, { useState, useEffect, useRef } from 'react';
import { 
  Video, VideoOff, Mic, MicOff, PhoneOff, Copy, Plus, 
  LogIn, LogOut, Zap, CheckCircle2, Share2, Sparkles, 
  ArrowRight, Shield, Monitor, AlertCircle, Loader2, 
  Globe, LayoutGrid, Users, Settings, Radio
} from 'lucide-react';

// Using ESM CDN for Supabase to resolve environment compilation issues
const SUPABASE_CDN = 'https://esm.sh/@supabase/supabase-js@2.39.3';

const servers = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  ],
  iceCandidatePoolSize: 10,
};

// Configuration
const SUPABASE_URL = "https://pbdibajhxdvotlppvfmz.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiZGliYWpoeGR2b3RscHB2Zm16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxMjQ1NTYsImV4cCI6MjA3NTcwMDU1Nn0.MEP7RhOQTOr2ZNbkfJwTGyNd-44dm5UWSVtrEajFZlY";

export default function App() {
  const [supabase, setSupabase] = useState(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('landing'); 
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');
  const [callState, setCallState] = useState('idle'); // idle, creating, joining, active
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [status, setStatus] = useState('');
  const [errorStatus, setErrorStatus] = useState('');

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pc = useRef(null);
  const localStream = useRef(null);
  const remoteStream = useRef(null);

  useEffect(() => {
    const init = async () => {
      try {
        const { createClient } = await import(SUPABASE_CDN);
        const client = createClient(SUPABASE_URL, SUPABASE_KEY);
        setSupabase(client);

        const { data: { session: currentSession } } = await client.auth.getSession();
        setSession(currentSession);
        setIsConfigured(true);

        client.auth.onAuthStateChange((_event, session) => {
          setSession(session);
        });
      } catch (err) {
        setErrorStatus("Connection to core server failed.");
      }
    };
    init();

    return () => {
      if (pc.current) pc.current.close();
    };
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setErrorStatus('');

    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data?.user?.identities?.length === 0) {
          setErrorStatus("Email already in use.");
        } else if (data.session) {
          setSession(data.session);
        } else {
          setAuthMode('login');
          setStatus("Check your email or log in now.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setErrorStatus(err.message);
    } finally {
      setLoading(false);
    }
  };

  const setupMedia = async () => {
    try {
      pc.current = new RTCPeerConnection(servers);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStream.current = stream;
      remoteStream.current = new MediaStream();

      stream.getTracks().forEach(track => pc.current.addTrack(track, stream));
      
      pc.current.ontrack = (event) => {
        event.streams[0].getTracks().forEach(track => {
          remoteStream.current.addTrack(track);
        });
      };

      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream.current;
      
      return true;
    } catch (err) {
      setErrorStatus("Hardware access denied.");
      return false;
    }
  };

  const createRoom = async () => {
    if (!session || !supabase) return;
    setCallState('creating');
    if (!(await setupMedia())) return setCallState('idle');

    const { data, error } = await supabase
      .from('livetalk_rooms')
      .insert([{ created_by: session.user.id }])
      .select()
      .single();

    if (error) {
      setErrorStatus("Signaling server unreachable.");
      setCallState('idle');
      return;
    }

    const callId = data.id;
    setRoomId(callId);

    pc.current.onicecandidate = async (e) => {
      if (e.candidate) {
        await supabase.from('livetalk_candidates').insert([{ 
          room_id: callId, 
          candidate: e.candidate.toJSON(), 
          type: 'caller' 
        }]);
      }
    };

    const offer = await pc.current.createOffer();
    await pc.current.setLocalDescription(offer);
    await supabase.from('livetalk_rooms').update({ 
      offer: { sdp: offer.sdp, type: offer.type } 
    }).eq('id', callId);

    // Watch for answer
    supabase.channel(`room-${callId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'livetalk_rooms', filter: `id=eq.${callId}` }, p => {
        if (!pc.current.currentRemoteDescription && p.new?.answer) {
          pc.current.setRemoteDescription(new RTCSessionDescription(p.new.answer));
          setCallState('active');
        }
      }).subscribe();

    // Watch for callee candidates
    supabase.channel(`cands-${callId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'livetalk_candidates', filter: `room_id=eq.${callId}` }, p => {
        if (p.new.type === 'callee') {
          pc.current.addIceCandidate(new RTCIceCandidate(p.new.candidate));
        }
      }).subscribe();
  };

  const joinRoom = async () => {
    if (!session || !inputRoomId || !supabase) return;
    setCallState('joining');
    if (!(await setupMedia())) return setCallState('idle');

    const { data: room, error } = await supabase
      .from('livetalk_rooms')
      .select('*')
      .eq('id', inputRoomId)
      .single();

    if (error || !room) {
      setErrorStatus("Room not found or expired.");
      setCallState('idle');
      return;
    }

    pc.current.onicecandidate = async (e) => {
      if (e.candidate) {
        await supabase.from('livetalk_candidates').insert([{ 
          room_id: inputRoomId, 
          candidate: e.candidate.toJSON(), 
          type: 'callee' 
        }]);
      }
    };

    await pc.current.setRemoteDescription(new RTCSessionDescription(room.offer));
    const answer = await pc.current.createAnswer();
    await pc.current.setLocalDescription(answer);
    await supabase.from('livetalk_rooms').update({ 
      answer: { type: answer.type, sdp: answer.sdp } 
    }).eq('id', inputRoomId);

    setRoomId(inputRoomId);
    setCallState('active');

    // Watch for caller candidates
    supabase.channel(`cands-join-${inputRoomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'livetalk_candidates', filter: `room_id=eq.${inputRoomId}` }, p => {
        if (p.new.type === 'caller') {
          pc.current.addIceCandidate(new RTCIceCandidate(p.new.candidate));
        }
      }).subscribe();
  };

  const toggleMedia = (type) => {
    if (!localStream.current) return;
    const track = type === 'mic' ? localStream.current.getAudioTracks()[0] : localStream.current.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      type === 'mic' ? setIsMicOn(track.enabled) : setIsCamOn(track.enabled);
    }
  };

  const hangup = () => {
    if (localStream.current) localStream.current.getTracks().forEach(t => t.stop());
    if (pc.current) pc.current.close();
    window.location.reload();
  };

  if (!isConfigured) return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
      <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
      <p className="text-slate-500 font-mono text-xs uppercase tracking-[0.3em]">Establishing Uplink...</p>
    </div>
  );

  // --- LANDING PAGE ---
  if (!session && authMode === 'landing') return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col relative overflow-hidden font-sans">
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] bg-indigo-600/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-blue-600/10 blur-[120px] rounded-full"></div>
      </div>

      <nav className="relative z-10 p-8 flex justify-between items-center max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-3 group cursor-default">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20 group-hover:rotate-12 transition-transform">
            <Radio className="text-white w-5 h-5 animate-pulse" />
          </div>
          <span className="text-xl font-black tracking-tighter uppercase italic">Livetalk</span>
        </div>
        <div className="flex items-center gap-6">
          <button onClick={() => setAuthMode('login')} className="text-sm font-bold text-slate-400 hover:text-white transition-colors">Sign In</button>
          <button onClick={() => setAuthMode('signup')} className="px-6 py-2.5 bg-white text-slate-950 rounded-full text-sm font-black hover:bg-slate-200 transition-all">Join Pulse</button>
        </div>
      </nav>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-indigo-400 text-[10px] font-black uppercase tracking-widest mb-8 animate-bounce">
          <Sparkles className="w-3 h-3" /> P2P Encrypted Engine
        </div>
        <h1 className="text-6xl md:text-8xl font-black tracking-tighter leading-[0.9] mb-8 bg-gradient-to-b from-white to-slate-500 bg-clip-text text-transparent">
          Next-Gen <br /> Real-time <br /> <span className="text-indigo-500">Video.</span>
        </h1>
        <p className="text-slate-400 text-lg max-w-xl mb-12 leading-relaxed font-medium">
          Zero-latency peer-to-peer calling. No intermediaries. Just you and your audience, connected instantly through the browser.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <button onClick={() => setAuthMode('signup')} className="px-12 py-5 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-black text-lg shadow-xl shadow-indigo-600/20 flex items-center gap-3 transition-all active:scale-95">
            Start a Call <ArrowRight />
          </button>
          <div className="px-10 py-5 bg-slate-900/50 border border-white/5 rounded-2xl flex items-center gap-4 text-slate-300 backdrop-blur-md">
            <Shield className="w-5 h-5 text-indigo-500" />
            <span className="font-bold">End-to-End Secure</span>
          </div>
        </div>
      </main>
    </div>
  );

  // --- AUTH PAGE ---
  if (!session) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md bg-slate-900/50 backdrop-blur-2xl border border-white/5 p-12 rounded-[3.5rem] shadow-2xl relative">
        <button onClick={() => setAuthMode('landing')} className="mb-10 text-slate-500 hover:text-white transition-colors">
          <ArrowRight className="rotate-180" />
        </button>
        
        <h2 className="text-4xl font-black text-white tracking-tight mb-2">
          {authMode === 'login' ? 'Welcome Back' : 'Create Access'}
        </h2>
        <p className="text-slate-500 text-sm mb-10 font-medium">Enter your credentials to continue.</p>

        <form onSubmit={handleAuth} className="space-y-6">
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest ml-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-slate-800/40 border border-white/5 p-5 rounded-2xl text-white outline-none focus:ring-2 focus:ring-indigo-600 transition-all font-bold" placeholder="name@domain.com" required />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest ml-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-slate-800/40 border border-white/5 p-5 rounded-2xl text-white outline-none focus:ring-2 focus:ring-indigo-600 transition-all font-bold" placeholder="••••••••" required minLength={6} />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-white text-slate-950 py-5 rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-lg hover:bg-slate-200 transition-all active:scale-95 disabled:opacity-50">
            {loading ? <Loader2 className="animate-spin mx-auto" /> : authMode}
          </button>
        </form>

        <button onClick={() => {setAuthMode(authMode === 'login' ? 'signup' : 'login'); setErrorStatus('');}} className="mt-8 w-full text-slate-500 text-xs font-black uppercase tracking-widest hover:text-indigo-400 transition-colors">
          Switch to {authMode === 'login' ? 'Signup' : 'Login'}
        </button>

        {errorStatus && (
          <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-[10px] font-black uppercase flex items-center gap-3">
            <AlertCircle size={14} /> {errorStatus}
          </div>
        )}
      </div>
    </div>
  );

  // --- DASHBOARD ---
  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col font-sans relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
        <div className="absolute top-[10%] left-[20%] w-[300px] h-[300px] bg-indigo-500 blur-[150px] rounded-full"></div>
      </div>

      <header className="relative z-20 px-10 py-6 border-b border-white/5 bg-slate-950/40 backdrop-blur-md flex justify-between items-center sticky top-0">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20"><Radio size={18} /></div>
          <h1 className="text-lg font-black tracking-tighter uppercase italic">Livetalk Pro</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex flex-col items-end">
            <span className="text-[9px] uppercase font-black text-slate-500 tracking-widest">Operator</span>
            <span className="text-xs font-bold text-indigo-400 truncate max-w-[150px]">{session.user.email}</span>
          </div>
          <button onClick={() => supabase.auth.signOut()} className="p-3 bg-white/5 border border-white/5 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"><LogOut size={18} /></button>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-6 md:p-12 w-full max-w-7xl mx-auto">
        {callState === 'idle' ? (
          <div className="w-full max-w-xl space-y-10 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-4">
              <h2 className="text-5xl md:text-6xl font-black tracking-tighter">Ready to <span className="text-indigo-500">broadcast?</span></h2>
              <p className="text-slate-400 font-medium leading-relaxed">Choose an action below to start your peer-to-peer session.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button onClick={createRoom} className="group relative flex flex-col items-center justify-center p-10 bg-indigo-600 rounded-[3rem] overflow-hidden transition-all hover:scale-[1.02] active:scale-95 shadow-2xl shadow-indigo-600/20">
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <Plus size={40} className="mb-4" />
                <span className="font-black uppercase tracking-widest text-xs">Host New Call</span>
              </button>
              
              <div className="flex flex-col gap-3">
                <div className="relative group">
                  <LogIn className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input 
                    type="text" 
                    placeholder="Paste Session ID" 
                    value={inputRoomId}
                    onChange={e => setInputRoomId(e.target.value)}
                    className="w-full bg-slate-900 border border-white/5 rounded-3xl p-6 pl-16 outline-none focus:ring-2 focus:ring-indigo-600 transition-all text-sm font-bold uppercase tracking-widest"
                  />
                </div>
                <button 
                  onClick={joinRoom}
                  disabled={!inputRoomId}
                  className="w-full py-6 bg-white text-slate-950 font-black uppercase text-xs tracking-widest rounded-3xl hover:bg-slate-200 transition-all disabled:opacity-30 active:scale-95"
                >
                  Join Call
                </button>
              </div>
            </div>

            <div className="pt-10 flex justify-center gap-8 opacity-40">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"><Globe size={14} /> Global Relay</div>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"><Shield size={14} /> Encrypted</div>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"><Radio size={14} /> HD P2P</div>
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col gap-6 animate-in zoom-in-95 duration-500">
            {/* Video Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-[400px]">
              <div className="relative bg-slate-900 rounded-[3rem] overflow-hidden border border-white/5 group shadow-2xl">
                <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover transform -scale-x-100" />
                <div className="absolute top-6 left-6 flex items-center gap-2 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full border border-white/10">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <span className="text-[10px] font-black uppercase tracking-widest">Operator (You)</span>
                </div>
                <div className="absolute bottom-6 left-6 flex gap-2">
                  {!isMicOn && <div className="p-3 bg-red-500/20 text-red-500 rounded-xl backdrop-blur-md"><MicOff size={16} /></div>}
                  {!isCamOn && <div className="p-3 bg-red-500/20 text-red-500 rounded-xl backdrop-blur-md"><VideoOff size={16} /></div>}
                </div>
              </div>

              <div className="relative bg-slate-900 rounded-[3rem] overflow-hidden border border-white/5 group shadow-2xl">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                <div className="absolute top-6 left-6 flex items-center gap-2 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full border border-white/10">
                  <div className={`w-2 h-2 rounded-full ${callState === 'active' ? 'bg-indigo-500 animate-pulse' : 'bg-slate-700'}`}></div>
                  <span className="text-[10px] font-black uppercase tracking-widest">Remote Participant</span>
                </div>
                {callState !== 'active' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm">
                    <div className="w-20 h-20 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-6"></div>
                    <p className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 animate-pulse">Establishing Peer Connection</p>
                  </div>
                )}
              </div>
            </div>

            {/* Floating Controls */}
            <div className="flex flex-col md:flex-row items-center gap-4 bg-slate-900/40 backdrop-blur-3xl p-6 rounded-[3.5rem] border border-white/5 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)]">
              <div className="flex items-center gap-3">
                <button onClick={() => toggleMedia('mic')} className={`p-5 rounded-3xl transition-all ${isMicOn ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-red-500 text-white shadow-lg shadow-red-500/20'}`}>
                  {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
                </button>
                <button onClick={() => toggleMedia('cam')} className={`p-5 rounded-3xl transition-all ${isCamOn ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-red-500 text-white shadow-lg shadow-red-500/20'}`}>
                  {isCamOn ? <Video size={24} /> : <VideoOff size={24} />}
                </button>
                <button onClick={hangup} className="px-10 py-5 bg-red-600 hover:bg-red-700 text-white rounded-3xl transition-all shadow-xl shadow-red-600/20 flex items-center justify-center">
                  <PhoneOff size={24} />
                </button>
              </div>

              <div className="h-10 w-[1px] bg-white/5 hidden md:block mx-4"></div>

              {roomId && (
                <div className="flex-1 flex items-center justify-between bg-black/40 border border-white/5 p-3 px-6 rounded-[2rem] min-w-0">
                  <div className="flex flex-col truncate pr-4">
                    <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Invite Link</span>
                    <span className="text-xs font-mono font-bold text-indigo-400 truncate">{roomId}</span>
                  </div>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(roomId);
                      setStatus('Link Copied');
                      setTimeout(() => setStatus(''), 2000);
                    }}
                    className="flex-shrink-0 p-3 bg-indigo-600/10 text-indigo-400 rounded-2xl hover:bg-indigo-600 hover:text-white transition-all"
                  >
                    {status ? <CheckCircle2 size={18} /> : <Share2 size={18} />}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {errorStatus && callState !== 'idle' && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 px-8 py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-2xl animate-in fade-in slide-in-from-bottom-2">
          {errorStatus}
        </div>
      )}

      <footer className="p-10 text-center opacity-20 pointer-events-none">
        <span className="text-[10px] font-black tracking-[1.5em] uppercase text-slate-500 italic">Core Pulse V5.2.0</span>
      </footer>
    </div>
  );
}
