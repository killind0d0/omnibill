import React, { useState, useEffect, useRef } from 'react';
import {
  Headset,
  ScreenShare,
  ScreenShareOff,
  Copy,
  Check,
  ShieldCheck,
  X,
  AlertCircle,
  Radio,
} from 'lucide-react';
import {
  WebRTCSupportClient,
  generateSessionPin,
  formatSessionPin,
  WebRTCConnectionState,
} from './webrtcClient';

interface LiveSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  signalingUrl?: string;
}

export const LiveSupportModal: React.FC<LiveSupportModalProps> = ({
  isOpen,
  onClose,
  signalingUrl,
}) => {
  const [pin, setPin] = useState<string>(() => generateSessionPin());
  const [connectionState, setConnectionState] = useState<WebRTCConnectionState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);

  const clientRef = useRef<WebRTCSupportClient | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  // Synchronize local preview stream to <video> element
  useEffect(() => {
    if (videoPreviewRef.current) {
      if (previewStream) {
        videoPreviewRef.current.srcObject = previewStream;
        videoPreviewRef.current.play().catch(() => {});
      } else {
        videoPreviewRef.current.srcObject = null;
      }
    }
  }, [previewStream]);

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, connectionState]);

  // Reset or initialize PIN when opening afresh while idle
  useEffect(() => {
    if (isOpen && connectionState === 'idle') {
      const newPin = generateSessionPin();
      setPin(newPin);
      setErrorMessage(null);
    }
  }, [isOpen]);

  const handleStartShare = async () => {
    setErrorMessage(null);

    const client = new WebRTCSupportClient({
      pin,
      signalingUrl,
      onStateChange: (newState) => {
        setConnectionState(newState);
      },
      onError: (err) => {
        setErrorMessage(err.message || 'Screen sharing connection failed.');
      },
      onLocalStream: (stream) => {
        setPreviewStream(stream);
      },
    });

    clientRef.current = client;

    try {
      await client.start();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to start screen share.');
      setConnectionState('idle');
      setPreviewStream(null);
    }
  };

  const handleStopShare = () => {
    if (clientRef.current) {
      clientRef.current.stop();
      clientRef.current = null;
    }
    setPreviewStream(null);
    setConnectionState('idle');
    setErrorMessage(null);
  };

  const handleClose = () => {
    if (connectionState === 'connected' || connectionState === 'connecting') {
      handleStopShare();
    }
    onClose();
  };

  const handleCopyPin = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(pin);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isOpen) return null;

  const isSharing = connectionState === 'connected' || connectionState === 'connecting';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-support-modal-title"
    >
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70 select-none">
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 text-white shadow-md shadow-sky-500/20">
              <Headset className="w-5 h-5" />
            </div>
            <div>
              <h3 id="live-support-modal-title" className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span>OmniBill Live Remote Assistance</span>
              </h3>
              <p className="text-xs text-slate-400">Direct encrypted screen-share with HQ Super Admin</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            title="Close (Esc)"
            aria-label="Close modal (Escape)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Status Indicator Banner */}
          <div className="rounded-xl border p-4 transition-all duration-200 bg-slate-950/60 border-slate-800">
            {connectionState === 'idle' && (
              <div className="flex items-start gap-3">
                <Radio className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-slate-200">Ready to Share</div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Share your screen with OmniBill Super Admin for 1-click troubleshooting.
                  </p>
                </div>
              </div>
            )}

            {connectionState === 'connecting' && (
              <div className="flex items-center gap-3">
                <div className="w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-sky-300">Connecting to Signaling Relay...</div>
                  <p className="text-xs text-slate-400">Waiting for Super Admin cockpit to establish DTLS handshake.</p>
                </div>
              </div>
            )}

            {connectionState === 'connected' && (
              <div className="flex items-center gap-3">
                <div className="relative flex h-3.5 w-3.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-emerald-400">
                    Screen Shared with HQ (Session PIN: {formatSessionPin(pin)})
                  </div>
                  <p className="text-xs text-emerald-300/80">Real-time 60 FPS remote diagnosis stream active.</p>
                </div>
              </div>
            )}

            {connectionState === 'failed' && (
              <div className="flex items-start gap-3 text-rose-300">
                <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold">Connection Failed</div>
                  <p className="text-xs text-rose-300/80 mt-0.5">{errorMessage || 'Check network connection and try again.'}</p>
                </div>
              </div>
            )}
          </div>

          {/* Session PIN Box */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-center">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">
              Your 6-Character Session PIN
            </span>
            <div className="flex items-center justify-center gap-3 mt-2">
              <span className="font-mono text-3xl font-black text-sky-400 tracking-wider select-all">
                {formatSessionPin(pin)}
              </span>
              <button
                type="button"
                onClick={handleCopyPin}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                title="Copy PIN to clipboard"
                aria-label="Copy session PIN to clipboard"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              Provide this PIN to your OmniBill representative to grant screen access.
            </p>
          </div>

          {/* Video Preview if sharing */}
          {isSharing && (
            <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-black aspect-video max-h-48 flex items-center justify-center">
              <video
                ref={videoPreviewRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain"
              />
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-slate-900/80 backdrop-blur-xs text-[10px] font-mono text-emerald-400 flex items-center gap-1.5 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Preview
              </div>
            </div>
          )}

          {/* Action Trigger Button */}
          <div>
            {!isSharing ? (
              <button
                type="button"
                onClick={handleStartShare}
                className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white shadow-lg shadow-sky-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                <ScreenShare className="w-4 h-4" />
                <span>Start Live Screen Share</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopShare}
                className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
              >
                <ScreenShareOff className="w-4 h-4" />
                <span>Stop Sharing</span>
              </button>
            )}
          </div>

          {/* Security Badge */}
          <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400 pt-1 select-none">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Encrypted DTLS-SRTP Peer-to-Peer. Zero video is saved or stored.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
