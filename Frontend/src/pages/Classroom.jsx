import React, { useState, useEffect, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { JitsiMeeting } from '@jitsi/react-sdk';
import { AuthContext } from '../context/AuthContext';
import { 
  GraduationCap, ArrowLeft, Video, Clock, AlertCircle, 
  CheckCircle, User, LogOut, PhoneOff, ShieldAlert, Loader2 
} from 'lucide-react';
import { API_URL } from '../config';

export default function Classroom() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);

  const [roomData, setRoomData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [isEnding, setIsEnding] = useState(false);
  const [concludedMessage, setConcludedMessage] = useState(null);

  const jitsiApiRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const token = localStorage.getItem('token');

  // 1. Authorize user and retrieve meeting credentials
  const fetchRoomAccess = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/classes/${id}/access`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Access verification failed.');
      }

      setRoomData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    fetchRoomAccess();

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [id]);

  // 2. Attendance tracking & End-of-lecture detection: Heartbeat every 20 seconds
  useEffect(() => {
    if (sessionId) {
      heartbeatIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API_URL}/api/classes/${id}/attendance/heartbeat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ sessionId })
          });
          const data = await res.json();

          // If the teacher has ended the lecture or duration expired
          if (data && data.ended) {
            clearInterval(heartbeatIntervalRef.current);
            setConcludedMessage('The instructor has concluded this live lecture. Returning to dashboard...');
            if (jitsiApiRef.current) {
              try {
                jitsiApiRef.current.executeCommand('hangup');
              } catch (e) {}
            }
            setTimeout(() => {
              navigate('/dashboard');
            }, 3500);
          }
        } catch (err) {
          // Silent catch for network blips
        }
      }, 20000);
    }

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [sessionId, id, token]);

  // 3. Attendance tracking: Reliable beacon / keepalive fetch on browser close/refresh
  useEffect(() => {
    const reportExit = () => {
      if (!token || !id) return;

      const payload = JSON.stringify({ sessionId });

      // Primary: Modern fetch with keepalive: true (supports custom headers)
      try {
        fetch(`${API_URL}/api/classes/${id}/attendance/leave`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: payload,
          keepalive: true
        }).catch(() => {});
      } catch (e) {}

      // Fallback: sendBeacon with query token parameter
      try {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(`${API_URL}/api/classes/${id}/attendance/leave?token=${encodeURIComponent(token)}`, blob);
      } catch (e) {}
    };

    window.addEventListener('beforeunload', reportExit);
    window.addEventListener('pagehide', reportExit);

    return () => {
      window.removeEventListener('beforeunload', reportExit);
      window.removeEventListener('pagehide', reportExit);
    };
  }, [sessionId, id, token]);

  // Record Join Attendance
  const handleJoinedConference = async () => {
    try {
      const res = await fetch(`${API_URL}/api/classes/${id}/attendance/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.sessionId) {
        setSessionId(data.sessionId);
      }
    } catch (err) {
      console.error('Attendance join reporting error:', err);
    }
  };

  // Record Leave Attendance
  const handleLeftConference = async () => {
    try {
      await fetch(`${API_URL}/api/classes/${id}/attendance/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sessionId })
      });
    } catch (err) {
      console.error('Attendance leave reporting error:', err);
    }
  };

  const handleLeaveClassroom = async () => {
    if (jitsiApiRef.current) {
      try {
        jitsiApiRef.current.executeCommand('hangup');
      } catch (e) {}
    }
    await handleLeftConference();
    navigate('/dashboard');
  };

  // Teacher: End Lecture for Everyone
  const handleEndLecture = async () => {
    if (!window.confirm('Are you sure you want to end this lecture for all participants?')) return;
    setIsEnding(true);

    try {
      // 1. Tell Jitsi to end the conference for all participants if supported
      if (jitsiApiRef.current) {
        try {
          jitsiApiRef.current.executeCommand('endConference');
        } catch (e) {
          try {
            jitsiApiRef.current.executeCommand('hangup');
          } catch (e2) {}
        }
      }

      // 2. Mark lecture ended in the backend (finalizes all attendance records)
      const res = await fetch(`${API_URL}/api/classes/${id}/end`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error('Failed to end lecture');

      await handleLeftConference();
      navigate('/dashboard');
    } catch (err) {
      alert(err.message);
      setIsEnding(false);
    }
  };

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-10 h-10 text-red-500 animate-spin" />
        <h2 className="text-xl font-bold">Verifying Lecture Access...</h2>
        <p className="text-sm text-slate-400">Connecting securely to Madrastak Virtual Classroom.</p>
      </div>
    );
  }

  // Error / Unauthorized / Ended State
  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-8 rounded-3xl space-y-6 shadow-2xl">
          <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center mx-auto border border-red-500/20">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black">Classroom Access Restricted</h2>
            <p className="text-slate-400 text-sm leading-relaxed">{error}</p>
          </div>
          <div className="pt-2 flex flex-col gap-3">
            <button 
              onClick={() => navigate('/dashboard')} 
              className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-semibold text-sm transition cursor-pointer"
            >
              Return to Dashboard
            </button>
            <button 
              onClick={fetchRoomAccess} 
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl font-semibold text-sm transition cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  const jitsiDomain = import.meta.env.VITE_JITSI_DOMAIN || 'meet.jit.si';

  // Toolbar options tailored to host vs student
  const teacherToolbar = [
    'camera', 'chat', 'closedcaptions', 'desktop', 'fullscreen', 
    'hangup', 'microphone', 'mute-everyone', 'mute-video-everyone', 
    'participants-pane', 'profile', 'raisehand', 'recording', 
    'select-background', 'settings', 'tileview', 'toggle-camera', 'videoquality'
  ];

  const studentToolbar = [
    'camera', 'chat', 'closedcaptions', 'desktop', 'fullscreen', 
    'hangup', 'microphone', 'profile', 'raisehand', 
    'select-background', 'settings', 'tileview', 'toggle-camera', 'videoquality'
  ];

  return (
    <div className="h-screen w-screen bg-slate-950 flex flex-col overflow-hidden text-white select-none relative">
      {/* Concluded Notification Overlay */}
      {concludedMessage && (
        <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl max-w-md w-full text-center space-y-4 shadow-2xl animate-fade-in">
            <div className="w-12 h-12 bg-red-500/20 text-red-400 rounded-2xl flex items-center justify-center mx-auto">
              <PhoneOff className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-black text-white">Lecture Ended</h3>
            <p className="text-sm text-slate-300">{concludedMessage}</p>
          </div>
        </div>
      )}

      {/* Top Classroom Bar */}
      <header className="h-16 bg-slate-900/90 border-b border-slate-800/80 px-6 flex items-center justify-between z-30 shrink-0 backdrop-blur-md">
        {/* Left: Madrastak Brand & Class Info */}
        <div className="flex items-center gap-4">
          <div 
            onClick={handleLeaveClassroom}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <div className="bg-red-600 text-white p-2 rounded-xl group-hover:bg-red-700 transition">
              <GraduationCap className="w-4 h-4" />
            </div>
            <span className="text-lg font-black tracking-tight hidden sm:inline">Madrastak</span>
          </div>

          <div className="h-5 w-px bg-slate-800 hidden sm:block"></div>

          <div className="flex items-center gap-3">
            <h1 className="text-sm sm:text-base font-bold text-slate-100 max-w-[200px] sm:max-w-md truncate">
              {roomData?.title}
            </h1>
            <span className="hidden md:inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              Live Session
            </span>
          </div>
        </div>

        {/* Center: Instructor Display */}
        <div className="hidden lg:flex items-center gap-2 text-xs font-medium text-slate-400 bg-slate-800/60 px-3.5 py-1.5 rounded-xl border border-slate-700/50">
          <User className="w-3.5 h-3.5 text-red-500" />
          <span>Instructor: <strong className="text-slate-200">{roomData?.teacher_name}</strong></span>
          {roomData?.isHost && (
            <span className="ml-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
              Host
            </span>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3">
          {roomData?.isHost && (
            <button
              onClick={handleEndLecture}
              disabled={isEnding}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm shadow-red-600/20 cursor-pointer"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">End Lecture for All</span>
            </button>
          )}

          <button
            onClick={handleLeaveClassroom}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-slate-700/60 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Leave Classroom</span>
          </button>
        </div>
      </header>

      {/* Embedded Jitsi Meeting Canvas */}
      <main className="flex-1 w-full h-full relative bg-slate-950">
        {roomData?.meeting_room_id && (
          <JitsiMeeting
            domain={jitsiDomain}
            roomName={roomData.meeting_room_id}
            configOverwrite={{
              startWithAudioMuted: !roomData.isHost,
              startWithVideoMuted: false,
              disableDeepLinking: true,
              prejoinPageEnabled: false,
              enableWelcomePage: false,
              disableInviteFunctions: true,
              disableModeratorIndicator: false,
              toolbarButtons: roomData.isHost ? teacherToolbar : studentToolbar
            }}
            interfaceConfigOverwrite={{
              SHOW_JITSI_WATERMARK: false,
              SHOW_WATERMARK_FOR_GUESTS: false,
              TOOLBAR_ALWAYS_VISIBLE: true,
              DEFAULT_REMOTE_DISPLAY_NAME: roomData.isHost ? 'Student' : 'Participant'
            }}
            userInfo={{
              displayName: user?.full_name || (roomData.isHost ? 'Instructor' : 'Student'),
              email: user?.email || ''
            }}
            onApiReady={(externalApi) => {
              jitsiApiRef.current = externalApi;

              // Event: Successfully entered call
              externalApi.on('videoConferenceJoined', () => {
                handleJoinedConference();
              });

              // Event: Left call
              externalApi.on('videoConferenceLeft', () => {
                handleLeftConference();
              });

              // Event: Hang up pressed inside Jitsi UI
              externalApi.on('readyToClose', () => {
                handleLeaveClassroom();
              });
            }}
            onReadyToClose={() => {
              handleLeaveClassroom();
            }}
            getIFrameRef={(iframeRef) => {
              if (iframeRef) {
                iframeRef.style.height = '100%';
                iframeRef.style.width = '100%';
                iframeRef.style.border = 'none';
              }
            }}
          />
        )}
      </main>
    </div>
  );
}
