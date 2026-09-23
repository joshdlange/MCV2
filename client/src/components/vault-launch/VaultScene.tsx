import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { vaultClip } from './clip';
import './vault-launch.css';

/** Silent continuous footage; platform/auth gating remains outside this layer. */
export default function VaultScene({ onFinish, exitRequested = false }: {
  onFinish: () => void;
  exitRequested?: boolean;
}) {
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [started, setStarted] = useState(false);
  const [fadeMs, setFadeMs] = useState<number | null>(null);
  const exiting = useRef(false);
  const handoffTimer = useRef<number>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const beginExit = useCallback((quick = false) => {
    if (exiting.current) return;
    exiting.current = true;
    // First hide the footage over opaque black, hold a fully black frame,
    // then reveal the untouched app. Readiness never waits for the whole clip.
    const fade = quick ? 80 : vaultClip.fadeMs;
    setFadeMs(fade);
    handoffTimer.current = window.setTimeout(onFinish, fade + 40 + 180);
  }, [onFinish]);

  useEffect(() => {
    if (exitRequested) beginExit(true);
  }, [exitRequested, beginExit]);
  useEffect(() => () => window.clearTimeout(handoffTimer.current), []);

  useEffect(() => {
    let disposed = false;
    let fade: number | undefined;
    let stalled: number | undefined;
    const finish = () => { if (!disposed) onFinish(); };
    const timeout = window.setTimeout(finish, reduced ? 450 : 3900);
    if (reduced) fade = window.setTimeout(() => beginExit(true), 100);
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    preference.addEventListener('change', finish);
    const video = videoRef.current;
    const playing = () => {
      window.clearTimeout(stalled);
      window.clearTimeout(fade);
      setStarted(true);
      // Track actual media time, never restart the overall launch deadline.
      fade = window.setTimeout(() => beginExit(),
        Math.max(0, vaultClip.durationMs - video!.currentTime * 1000 - vaultClip.fadeMs));
    };
    const waiting = () => {
      window.clearTimeout(stalled);
      stalled = window.setTimeout(finish, 450);
    };
    const ended = () => beginExit();
    if (video) {
      video.addEventListener('playing', playing);
      video.addEventListener('waiting', waiting);
      video.addEventListener('stalled', waiting);
      video.addEventListener('error', finish);
      video.addEventListener('ended', ended);
      video.muted = true;
      try { void video.play().catch(finish); } catch { finish(); }
    }
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      window.clearTimeout(fade);
      window.clearTimeout(stalled);
      preference.removeEventListener('change', finish);
      if (video) {
        video.removeEventListener('playing', playing);
        video.removeEventListener('waiting', waiting);
        video.removeEventListener('stalled', waiting);
        video.removeEventListener('error', finish);
        video.removeEventListener('ended', ended);
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [onFinish, reduced, beginExit]);

  return <div className={`vault-launch ${fadeMs !== null ? 'vault-launch--exiting' : ''}`}
    style={{ '--vault-fade': `${fadeMs ?? vaultClip.fadeMs}ms` } as CSSProperties}
    aria-hidden="true" data-vault-launch="">
    <div className="vault-launch__surface">
      <img className="vault-launch__media" src={vaultClip.poster} alt="" draggable={false}
        decoding="async" onError={onFinish} data-vault-poster="" />
      {!reduced && <video ref={videoRef} src={vaultClip.video} muted playsInline preload="auto"
        disablePictureInPicture disableRemotePlayback tabIndex={-1}
        className={`vault-launch__media vault-launch__video ${started ? 'vault-launch__video--started' : ''}`}
        data-vault-video="" />}
    </div>
  </div>;
}