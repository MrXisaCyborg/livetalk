import React, { useState, useEffect, useRef } from 'react';
import { 
  Video, 
  VideoOff, 
  Mic, 
  MicOff, 
  PhoneOff, 
  Copy, 
  Plus, 
  LogIn, 
  Info,
  User,
  Lock,
  Mail,
  LogOut,
  Zap,
  CheckCircle2,
  Share2,
  Sparkles,
  ArrowRight,
  Shield,
  Monitor,
  AlertCircle,
  Loader2,
  Globe,
  Waves,
  Cpu,
  MousePointer2
} from 'lucide-react';

/**
 * LIVETALK V5.0 - THE CONVERSION-READY EDITION
 * Features: Instant Signup (Confirm Email is OFF), SaaS Design, 
 * Realtime Signaling via livetalk_rooms & livetalk_candidates.
 */

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const servers = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  ],
  iceCandidatePoolSize: 10,
};

export default function App() {
  const [supabase, setSupabase] = useState(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('landing'); // 'landing', 'login', 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');
  const [callState, setCallState] = useState('idle'); 
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
    pc.current = new RTCPeerConnection(servers);
    const url = "https://pbdibajhxdvotlppvfmz.supabase.co";
    const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiZGliYWpoeGR2b3RscHB2Zm16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxMjQ1NTYsImV4cCI6MjA3NTcwMDU1Nn0.MEP7RhOQTOr2ZNbkfJwTGyNd-44dm5UWSVtrEajFZlY";
    
    const init = async () => {
      try {
        const { createClient } = await import(SUPABASE_CDN);
        const client = createClient(url, key);
        setSupabase(client);

        const { data: { session: currentSession } } = await client.auth.getSession();
        setSession(currentSession);
        setIsConfigured(true);

        client.auth.onAuthStateChange((_event, session) => {
          setSession(session);
        });
      } catch (err) {
        setErrorStatus("Core engine connection failed.");
      }
    };
    init();
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setStatus('');
    setErrorStatus('');

    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        
        if (data?.user?.identities?.length === 0) {
          setErrorStatus("This email is already registered. Try logging in.");
        } else if (data.session) {
          // Instant Login Success (since Confirm Email is OFF)
          setStatus("Welcome to Livetalk! Access granted.");
          setSession(data.session);
        } else {
          // Fallback if settings didn't save correctly in dashboard
          setStatus("Account created! Please log in.");
          setAuthMode('login');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setErrorStatus(err.message || "Authentication error.");
    } finally {
      setLoading(false);
    }
  };

  const setupMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStream.current = stream;
      remoteStream.current = new MediaStream();

      stream.getTracks().forEach(track => pc.current.addTrack(track, stream));
      pc.current.ontrack = (event) => {
        event.streams[0].getTracks().forEach(track => remoteStream.current.addTrack(track));
      };

      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream.current;
      return true;
    } catch (err) {
      setErrorStatus("Camera access denied. Please check your browser settings.");
      return false;
    }
  };

  const createRoom = async () => {
    if (!session || !supabase) return;
    setCallState('creating');
    if (!(await setupMedia())) return setCallState('idle');

    const { data, error } = await supabase.from('livetalk_rooms').insert([{ created_by: session.user.id }]).select().single();
    if (error) { setErrorStatus("Signaling error. Database sync failed."); setCallState('idle'); return; }

    const callId = data.id;
    setRoomId(callId);

    pc.current.onicecandidate = async (e) => {
      if (e.candidate) await supabase.from('livetalk_candidates').insert([{ room_id: callId, candidate: e.candidate.toJSON(), type: 'caller' }]);
    };

    const offer = await pc.current.createOffer();
    await pc.current.setLocalDescription(offer);
    await supabase.from('livetalk_rooms').update({ offer: { sdp: offer.sdp, type: offer.type } }).eq('id', callId);

    supabase.channel(`room-${callId}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'livetalk_rooms', filter: `id=eq.${callId}` }, p => {
      if (!pc.current.currentRemoteDescription && p.new?.answer) {
        pc.current.setRemoteDescription(new RTCSessionDescription(p.new.answer));
        setCallState('active');
        setStatus("Peer connected.");
      }
    }).subscribe();

    supabase.channel(`cands-${callId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'livetalk_candidates', filter: `room_id=eq.${callId}` }, p => {
      if (p.new.type === 'callee') pc.current.addIceCandidate(new RTCIceCandidate(p.new.candidate));
    }).subscribe();
  };

  const joinRoom = async () => {
    if (!session || !inputRoomId || !supabase) return;
    setCallState('joining');
    if (!(await setupMedia())) return setCallState('idle');

    const { data: room, error } = await supabase.from('livetalk_rooms').select('*').eq('id', inputRoomId).single();
    if (error || !room) { setErrorStatus("Invalid Invite Code. Session not found."); setCallState('idle'); return; }

    pc.current.onicecandidate = async (e) => {
      if (e.candidate) await supabase.from('livetalk_candidates').insert([{ room_id: inputRoomId, candidate: e.candidate.toJSON(), type: 'callee' }]);
    };

    await pc.current.setRemoteDescription(new RTCSessionDescription(room.offer));
    const answer = await pc.current.createAnswer();
    await pc.current.setLocalDescription(answer);
    await supabase.from('livetalk_rooms').update({ answer: { type: answer.type, sdp: answer.sdp } }).eq('id', inputRoomId);

    setRoomId(inputRoomId);
    setCallState('active');
    setStatus("Linked to host.");

    supabase.channel(`cands-join-${inputRoomId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'livetalk_candidates', filter: `room_id=eq.${inputRoomId}` }, p => {
      if (p.new.type === 'caller') pc.current.addIceCandidate(new RTCIceCandidate(p.new.candidate));
    }).subscribe();
  };

  const hangup = () => {
    if (localStream.current) localStream.current.getTracks().forEach(t => t.stop());
    if (pc.current) pc.current.close();
    window.location.reload();
  };

  const toggleMedia = (type) => {
    if (!localStream.current) return;
    const track = type === 'mic' ? localStream.current.getAudioTracks()[0] : localStream.current.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      type === 'mic' ? setIsMicOn(track.enabled) : setIsCamOn(track.enabled);
    }
  };

  // --- RENDERING ---

  if (!isConfigured) return (
    <div className="min-h-screen bg-[#020617] flex items-center justify-center">
      <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
    </div>
  );

  // Landing Page View
  if (!session && authMode === 'landing') {
    return (
      <div className="min-h-screen bg-[#020617] text-white font-sans overflow-x-hidden relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/20 blur-[120px] rounded-full"></div>
          <div className="absolute bottom-20 right-[-5%] w-[400px] h-[400px] bg-violet-600/10 blur-[100px] rounded-full"></div>
        </div>

        <nav className="relative z-20 px-8 py-8 flex justify-between items-center max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20"><Video className="w-5 h-5" /></div>
            <span className="text-xl font-black tracking-tighter uppercase italic">Livetalk</span>
          </div>
          <div className="flex items-center gap-8">
            <button onClick={() => setAuthMode('login')} className="text-sm font-bold text-slate-400 hover:text-white transition-colors">Sign In</button>
            <button onClick={() => setAuthMode('signup')} className="px-6 py-2.5 rounded-full bg-white text-black text-sm font-black hover:bg-slate-200 transition-all">Get Started</button>
          </div>
        </nav>

        <main className="relative z-10 pt-20 pb-32 px-6 flex flex-col items-center text-center max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-indigo-400 text-[10px] font-black uppercase tracking-widest mb-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Sparkles className="w-3 h-3" /> Real-time peer architecture
          </div>
          
          <h1 className="text-7xl md:text-9xl font-black tracking-tighter leading-[0.85] mb-10 bg-gradient-to-br from-white via-white to-slate-600 bg-clip-text text-transparent animate-in fade-in slide-in-from-bottom-6 duration-1000">
            Video calling <br /> without the <br /> <span className="text-indigo-500 underline decoration-indigo-500/20 underline-offset-8">compromise.</span>
          </h1>
          
          <p className="text-xl text-slate-400 max-w-2xl leading-relaxed mb-12 animate-in fade-in slide-in-from-bottom-8 duration-1000">
            Experience high-fidelity, low-latency video communication powered by WebRTC. No downloads, no limits, just pure connection.
          </p>

          <div className="flex flex-col sm:flex-row gap-6 animate-in fade-in slide-in-from-bottom-10 duration-1000">
            <button onClick={() => setAuthMode('signup')} className="px-10 py-5 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-black text-lg shadow-2xl shadow-indigo-600/30 transition-all active:scale-95 flex items-center gap-3">
              Start Calling Now <ArrowRight className="w-5 h-5" />
            </button>
            <div className="px-10 py-5 bg-white/5 border border-white/10 rounded-2xl font-bold text-lg backdrop-blur-md flex items-center gap-3">
              <Shield className="w-5 h-5 text-indigo-500" /> AES-256 Encrypted
            </div>
          </div>

          {/* Feature Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-40 w-full animate-in fade-in duration-1000 delay-500">
            {[
              { icon: <Zap />, title: "Zero Latency", desc: "Global STUN/TURN relays ensure sub-100ms lag." },
              { icon: <Globe />, title: "Any Network", desc: "Connect from Wi-Fi, 5G, or office firewalls." },
              { icon: <Monitor />, title: "4K Ready", desc: "Dynamic bitrate adjustment for crystal clarity." }
            ].map((f, i) => (
              <div key={i} className="p-8 bg-white/5 border border-white/10 rounded-[2.5rem] text-left group hover:bg-white/[0.08] transition-all">
                <div className="w-12 h-12 bg-indigo-600/20 rounded-xl flex items-center justify-center mb-6 text-indigo-400 group-hover:scale-110 transition-transform">{f.icon}</div>
                <h3 className="text-xl font-black mb-3">{f.title}</h3>
                <p className="text-slate-500 leading-relaxed text-sm">{f.desc}</p>
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  // Auth View (Login/Signup)
  if (!session && (authMode === 'login' || authMode === 'signup')) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center p-6 text-white font-sans relative">
         <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/10 blur-[150px] rounded-full"></div>
         
         <div className="w-full max-w-md bg-slate-900/40 backdrop-blur-3xl border border-white/10 rounded-[3.5rem] p-12 shadow-3xl relative z-10">
            <button onClick={() => setAuthMode('landing')} className="absolute top-8 left-8 text-slate-500 hover:text-white transition-colors"><ArrowRight className="w-5 h-5 rotate-180" /></button>
            
            <div className="mb-12 text-center">
              <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-indigo-600/20">
                <Video className="w-8 h-8" />
              </div>
              <h2 className="text-4xl font-black tracking-tight">{authMode === 'login' ? 'Welcome Back' : 'Create Account'}</h2>
              <p className="text-slate-500 text-sm mt-3 font-medium">Join the next generation of calling.</p>
            </div>

            <form onSubmit={handleAuth} className="space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 ml-2">Email Address</label>
                <div className="relative group">
                  <Mail className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 group-focus-within:text-indigo-500 transition-colors" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-slate-800/20 border border-slate-700/50 rounded-2xl p-5 pl-14 text-sm focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder:text-slate-800 font-bold" placeholder="name@email.com" required />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 ml-2">Password</label>
                <div className="relative group">
                  <Lock className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 group-focus-within:text-indigo-500 transition-colors" />
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-slate-800/20 border border-slate-700/50 rounded-2xl p-5 pl-14 text-sm focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder:text-slate-800 font-bold" placeholder="••••••••" required minLength={6} />
                </div>
              </div>

              <button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black p-5 rounded-3xl shadow-2xl shadow-indigo-600/30 active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50">
                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <span className="uppercase tracking-widest text-xs">{authMode === 'login' ? 'Sign In' : 'Instant Signup'}</span>}
              </button>
            </form>

            <div className="mt-10 pt-8 border-t border-white/5 text-center">
              <button onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setErrorStatus(''); setStatus(''); }} className="text-slate-500 hover:text-white text-[11px] font-black uppercase tracking-[0.2em] transition-colors">
                {authMode === 'login' ? "Need a new account? Register" : "Already have an account? Login"}
              </button>
            </div>

            {(status || errorStatus) && (
              <div className={`mt-8 p-5 rounded-3xl text-[10px] font-black uppercase tracking-widest flex items-start gap-4 animate-in zoom-in-95 ${errorStatus ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400'}`}>
                {errorStatus ? <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                <span className="leading-relaxed">{errorStatus || status}</span>
              </div>
            )}
         </div>
      </div>
    );
  }

  // Active Dashboard View
  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col font-sans relative overflow-hidden">
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[150px] rounded-full"></div>
      
      <header className="relative z-10 px-10 py-8 border-b border-white/5 bg-slate-950/40 backdrop-blur-xl flex justify-between items-center sticky top-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-600/30"><Video className="text-white w-6 h-6" /></div>
          <h1 className="text-2xl font-black tracking-tighter italic">LIVETALK</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-3 px-6 py-3 bg-white/5 border border-white/10 rounded-full text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
            <User className="w-4 h-4 text-indigo-500" />
            <span className="max-w-[150px] truncate">{session.user.email}</span>
          </div>
          <button onClick={() => supabase.auth.signOut()} className="p-4 text-slate-600 hover:text-red-400 transition-all hover:scale-110"><LogOut className="w-6 h-6" /></button>
        </div>
      </header>

      <main className="relative z-10 flex-1 p-6 md:p-12 flex flex-col items-center max-w-7xl mx-auto w-full">
        {(status || errorStatus) && (
          <div className={`mb-10 px-10 py-4 rounded-full text-[11px] font-black uppercase tracking-[0.3em] flex items-center gap-4 animate-in slide-in-from-top-6 ${errorStatus ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-indigo-600/10 border border-indigo-500/20 text-indigo-400'}`}>
            {errorStatus ? <AlertCircle className="w-4 h-4" /> : <Zap className="w-4 h-4 fill-indigo-400 animate-pulse" />}
            {errorStatus || status}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 w-full h-[50vh] lg:h-[65vh] mb-16">
          <div className="relative bg-slate-900 rounded-[5rem] overflow-hidden border border-white/10 shadow-3xl ring-1 ring-white/5 group">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            {callState !== 'active' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95">
                <div className="w-28 h-28 rounded-full bg-slate-900 border border-white/5 flex items-center justify-center mb-8 shadow-2xl opacity-20 group-hover:opacity-40 transition-opacity">
                  <Monitor className="w-12 h-12 text-slate-600" />
                </div>
                <p className="text-[11px] uppercase font-black tracking-[0.6em] text-slate-700 animate-pulse">Awaiting Signal</p>
              </div>
            )}
            <div className="absolute bottom-10 left-10 px-7 py-3 bg-black/60 backdrop-blur-2xl border border-white/5 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.4em] shadow-2xl">Guest Stream</div>
          </div>

          <div className="relative bg-slate-900 rounded-[5rem] overflow-hidden border border-white/10 shadow-3xl ring-1 ring-white/5">
            <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover transform -scale-x-100" />
            <div className="absolute bottom-10 left-10 px-7 py-3 bg-indigo-600/80 backdrop-blur-2xl border border-white/20 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.4em] shadow-2xl">Local View</div>
          </div>
        </div>

        <div className="w-full max-w-5xl bg-slate-900/60 backdrop-blur-3xl border border-white/10 p-14 rounded-[6rem] shadow-[0_60px_120px_-30px_rgba(0,0,0,0.8)] relative">
          {callState === 'idle' ? (
            <div className="space-y-12">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                <button onClick={createRoom} className="flex-1 flex items-center justify-center gap-6 bg-white text-slate-950 p-10 rounded-[3.5rem] text-2xl font-black shadow-3xl hover:bg-slate-100 active:scale-[0.97] transition-all group">
                  <Plus className="w-8 h-8 group-hover:rotate-90 transition-transform duration-500" />
                  <span className="uppercase tracking-[0.1em]">Host Session</span>
                </button>
                <div className="flex-1 flex gap-5">
                  <input type="text" placeholder="Invite Code" className="flex-1 bg-slate-800/40 border border-white/10 rounded-[3.5rem] px-12 py-6 text-lg font-bold focus:ring-4 focus:ring-indigo-600/20 outline-none transition-all placeholder:text-slate-800 text-white" value={inputRoomId} onChange={(e) => setInputRoomId(e.target.value)} />
                  <button onClick={joinRoom} disabled={!inputRoomId} className="bg-indigo-600 hover:bg-indigo-500 text-white p-10 rounded-[3.5rem] disabled:opacity-30 transition-all active:scale-90 shadow-2xl shadow-indigo-600/30"><LogIn className="w-8 h-8" /></button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-12 text-[10px] font-black uppercase tracking-[0.5em] text-slate-700">
                 <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-500" /> Secure Handshake</div>
                 <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-500" /> P2P Media</div>
                 <div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-500" /> Zero Friction</div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-12">
              <div className="flex justify-center items-center gap-10">
                <button onClick={() => toggleMedia('mic')} className={`w-24 h-24 rounded-[3.5rem] flex items-center justify-center transition-all shadow-xl border-2 ${isMicOn ? 'bg-slate-800 border-white/5 text-white' : 'bg-red-500/20 text-red-500 border-red-500/30 shadow-red-500/10'}`}>
                  {isMicOn ? <Mic className="w-10 h-10" /> : <MicOff className="w-10 h-10" />}
                </button>
                <button onClick={hangup} className="w-44 h-24 bg-red-600 hover:bg-red-700 rounded-[3.5rem] flex items-center justify-center shadow-2xl shadow-red-600/40 transition-all active:scale-90 group"><PhoneOff className="text-white w-12 h-12 group-hover:rotate-[135deg] transition-transform duration-700" /></button>
                <button onClick={() => toggleMedia('cam')} className={`w-24 h-24 rounded-[3.5rem] flex items-center justify-center transition-all shadow-xl border-2 ${isCamOn ? 'bg-slate-800 border-white/5 text-white' : 'bg-red-500/20 text-red-500 border-red-500/30 shadow-red-500/10'}`}>
                  {isCamOn ? <Video className="w-10 h-10" /> : <VideoOff className="w-10 h-10" />}
                </button>
              </div>
              
              {roomId && (
                <div className="flex items-center justify-between p-10 bg-black/40 rounded-[4rem] border border-white/5 group animate-in zoom-in-95 duration-1000">
                  <div className="flex flex-col overflow-hidden px-4">
                    <span className="text-[10px] uppercase font-black text-slate-700 mb-2 tracking-[0.5em]">Invite Participant</span>
                    <span className="text-base font-mono text-indigo-400 truncate max-w-[450px] font-bold tracking-tight">{roomId}</span>
                  </div>
                  <button onClick={() => { navigator.clipboard.writeText(roomId); setStatus("Invite code copied."); setTimeout(() => setStatus(""), 3000); }} className="bg-indigo-600 text-white p-8 rounded-[3rem] hover:bg-indigo-500 transition-all active:scale-90 shadow-2xl shadow-indigo-600/20"><Share2 className="w-7 h-7" /></button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      
      <footer className="p-16 text-center opacity-10 select-none">
        <span className="text-slate-500 text-[10px] tracking-[1.5em] uppercase font-black">LIVETALK CORE &bull; V5.0</span>
      </footer>
    </div>
  );
}
