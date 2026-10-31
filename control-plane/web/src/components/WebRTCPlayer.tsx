import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface WebRTCPlayerProps {
  pin: string;
  signalingUrl?: string;
  onEndSession: () => void;
  onError?: (err: string) => void;
  className?: string;
}

export type WebRTCConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function getSignalingUrl(sessionPin: string, customUrl?: string): string {
  if (customUrl) return customUrl;
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const proto = isHttps ? 'wss:' : 'ws:';
  const host =
    typeof window !== 'undefined' && window.location.port === '5173'
      ? `${window.location.hostname}:8080`
      : typeof window !== 'undefined'
      ? window.location.host
      : '127.0.0.1:8080';
  const cleanPin = encodeURIComponent(sessionPin.trim().toUpperCase());
  return `${proto}//${host}/v1/support/ws/${cleanPin}`;
}

export const WebRTCPlayer: React.FC<WebRTCPlayerProps> = ({
  pin,
  signalingUrl,
  onEndSession,
  onError,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const statsIntervalRef = useRef<number | null>(null);
  const lastDecodedFramesRef = useRef<number>(0);
  const lastStatsTimeRef = useRef<number>(Date.now());

  const [status, setStatus] = useState<WebRTCConnectionStatus>('connecting');
  const [hasStream, setHasStream] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(0);
  const [resolution, setResolution] = useState<string>('Syncing...');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Clean shutdown of WebRTC and WebSocket
  const cleanup = useCallback(() => {
    if (statsIntervalRef.current) {
      window.clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'bye', pin: pin.trim().toUpperCase() }));
          wsRef.current.close();
        }
      } catch {
        // Ignore during shutdown
      }
      wsRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    pendingIceCandidatesRef.current = [];
  }, [pin]);

  const handleEndSession = useCallback(() => {
    cleanup();
    setStatus('disconnected');
    onEndSession();
  }, [cleanup, onEndSession]);

  // Handle Fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen request failed:', err);
    }
  }, []);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
    };
  }, []);

  // WebRTC & WebSocket initialization
  useEffect(() => {
    if (!pin || pin.trim().length === 0) {
      setStatus('error');
      setErrorMessage('A valid 6-character session PIN is required.');
      return;
    }

    setStatus('connecting');
    setErrorMessage(null);
    setHasStream(false);
    setFps(0);
    setResolution('Syncing...');

    // 1. Create PeerConnection
    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection(RTC_CONFIGURATION);
      pcRef.current = pc;
    } catch (err: any) {
      const msg = `RTCPeerConnection creation failed: ${err.message}`;
      setStatus('error');
      setErrorMessage(msg);
      onError?.(msg);
      return;
    }

    // Set transceivers to receive video & audio
    try {
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
    } catch {
      // In case older implementations prefer ontrack without transceivers
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
          videoRef.current.play().catch(() => {});
        }
        setHasStream(true);
        setStatus('connected');
      }
    };

    // Track connection state changes
    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          setStatus('connected');
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          setStatus('disconnected');
          break;
        case 'connecting':
          setStatus('connecting');
          break;
      }
    };

    // 2. Open Signaling WebSocket
    const url = getSignalingUrl(pin, signalingUrl);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
      wsRef.current = ws;
    } catch (err: any) {
      const msg = `Signaling connection failed: ${err.message}`;
      setStatus('error');
      setErrorMessage(msg);
      onError?.(msg);
      return;
    }

    // Forward local ICE candidates to peer via WebSocket
    pc.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'ICECandidate',
            candidate: event.candidate.toJSON(),
          })
        );
      }
    };

    ws.onopen = () => {
      // Announce Super Admin joined signaling room
      try {
        ws.send(
          JSON.stringify({
            type: 'join',
            role: 'admin',
            pin: pin.trim().toUpperCase(),
          })
        );
      } catch {
        // Ignore
      }
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        const msgType = (msg.type || msg.event || '').toLowerCase();

        if (msgType === 'offer') {
          const sdp = msg.sdp || msg.data?.sdp || msg.payload?.sdp;
          if (!sdp) return;

          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));

          // Flush any pending ICE candidates received before the offer
          while (pendingIceCandidatesRef.current.length > 0) {
            const candidateInit = pendingIceCandidatesRef.current.shift();
            if (candidateInit) {
              await pc.addIceCandidate(new RTCIceCandidate(candidateInit)).catch(() => {});
            }
          }

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          if (ws.readyState === WebSocket.OPEN) {
            // Send answer compatible with both standard Rust and JS endpoints
            ws.send(
              JSON.stringify({
                type: 'Answer',
                sdp: answer.sdp,
              })
            );
          }
        } else if (
          msgType === 'icecandidate' ||
          msgType === 'candidate' ||
          msgType === 'ice-candidate'
        ) {
          const candidateData = msg.candidate || msg.data?.candidate;
          if (candidateData) {
            const rtcCandidate =
              typeof candidateData === 'string'
                ? { candidate: candidateData }
                : candidateData;

            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(rtcCandidate)).catch(() => {});
            } else {
              pendingIceCandidatesRef.current.push(rtcCandidate);
            }
          }
        } else if (msgType === 'bye' || msgType === 'endsession' || msgType === 'close') {
          setStatus('disconnected');
        }
      } catch (err) {
        console.warn('Signaling message handling warning:', err);
      }
    };

    ws.onerror = (e) => {
      console.warn('Signaling WebSocket error occurred:', e);
    };

    ws.onclose = () => {
      if (pc.connectionState !== 'connected') {
        setStatus('disconnected');
      }
    };

    // 3. Telemetry Polling (FPS & Resolution)
    statsIntervalRef.current = window.setInterval(async () => {
      const video = videoRef.current;
      const peer = pcRef.current;

      // Update resolution from video element
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        let label = `${w}×${h}`;
        if (w >= 1920 && h >= 1080) {
          label = '1080p';
        } else if (w >= 1280 && h >= 720) {
          label = '720p';
        } else if (w >= 854 && h >= 480) {
          label = '480p';
        }
        setResolution(label);
      }

      // Compute FPS from WebRTC stats
      if (peer && peer.connectionState === 'connected') {
        try {
          const stats = await peer.getStats();
          stats.forEach((report) => {
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
              if (report.framesPerSecond !== undefined) {
                setFps(Math.round(report.framesPerSecond));
              } else if (report.framesDecoded !== undefined) {
                const now = Date.now();
                const elapsedSec = (now - lastStatsTimeRef.current) / 1000;
                const deltaFrames = report.framesDecoded - lastDecodedFramesRef.current;
                if (elapsedSec > 0.5 && deltaFrames >= 0) {
                  const calculatedFps = Math.round(deltaFrames / elapsedSec);
                  setFps(Math.min(calculatedFps, 120));
                  lastDecodedFramesRef.current = report.framesDecoded;
                  lastStatsTimeRef.current = now;
                }
              }
            }
          });
        } catch {
          // Ignore stats errors
        }
      }
    }, 1000);

    return () => {
      cleanup();
    };
  }, [pin, signalingUrl, cleanup, onError]);

  // Compute status badge styling
  const renderStatusBadge = () => {
    switch (status) {
      case 'connected':
        return (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-semibold shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Connected</span>
          </div>
        );
      case 'connecting':
        return (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-950/80 border border-amber-500/40 text-amber-300 text-xs font-semibold shadow-sm">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span>Connecting...</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-950/80 border border-rose-500/40 text-rose-300 text-xs font-semibold shadow-sm">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span>Error</span>
          </div>
        );
      case 'disconnected':
      default:
        return (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-800/90 border border-slate-700 text-slate-300 text-xs font-semibold shadow-sm">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            <span>Disconnected</span>
          </div>
        );
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl ${
        isFullscreen ? 'w-screen h-screen rounded-none border-none' : 'w-full h-full min-h-[480px]'
      } ${className}`}
    >
      {/* Video Viewport */}
      <div className="relative flex-1 flex items-center justify-center bg-black overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-contain ${hasStream ? 'block' : 'hidden'}`}
        />

        {/* Placeholder / Connecting State */}
        {!hasStream && (
          <div className="flex flex-col items-center justify-center p-8 text-center max-w-md">
            <div className="relative w-20 h-20 mb-6 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-indigo-500/20 animate-ping" />
              <div className="relative w-16 h-16 rounded-2xl bg-indigo-950 border border-indigo-500/40 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <svg
                  className="w-8 h-8 text-indigo-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.75}
                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-white tracking-tight">
              {status === 'connecting'
                ? 'Connecting to POS Terminal...'
                : status === 'error'
                ? 'Connection Issue'
                : 'Session Standby'}
            </h3>

            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              {status === 'connecting'
                ? 'Signaling hub ready. Waiting for cashier to allow screen broadcast on terminal.'
                : status === 'error'
                ? errorMessage || 'Unable to establish WebRTC peer connection.'
                : 'Connection closed or waiting for client session.'}
            </p>

            <div className="mt-6 flex items-center gap-2 bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl text-xs font-mono text-slate-300">
              <span className="text-slate-500">PIN:</span>
              <span className="font-bold text-indigo-400 tracking-wider text-sm">{pin.toUpperCase()}</span>
            </div>
          </div>
        )}

        {/* Live Watermark Overlay (Only when streaming) */}
        {hasStream && (
          <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-200">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold tracking-wide uppercase text-[10px] text-emerald-400">HQ Live</span>
            <span className="text-slate-500">•</span>
            <span className="font-mono text-slate-400">{pin.toUpperCase()}</span>
          </div>
        )}
      </div>

      {/* Control Bar Overlay */}
      <div className="z-20 bg-slate-900/95 backdrop-blur-md border-t border-slate-800/90 px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        {/* Left: Status & Telemetry */}
        <div className="flex items-center gap-3">
          {renderStatusBadge()}

          {/* FPS and Resolution Display */}
          <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-950/90 border border-slate-800 rounded-lg text-xs font-mono text-slate-300">
            <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>
              {hasStream
                ? `${resolution} @ ${fps > 0 ? fps : 60} FPS`
                : 'Waiting for stream...'}
            </span>
          </div>
        </div>

        {/* Right: Controls & End Session */}
        <div className="flex items-center gap-2">
          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {isFullscreen ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            )}
          </button>

          {/* End Session Button */}
          <button
            onClick={handleEndSession}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-rose-500"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
            <span>End Session</span>
          </button>
        </div>
      </div>
    </div>
  );
};
