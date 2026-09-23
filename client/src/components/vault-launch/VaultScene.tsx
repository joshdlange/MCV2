import { useEffect, useRef, useState } from 'react';
import { vaultClip } from './clip';
import './vault-launch.css';

/** Silent continuous footage; platform/auth gating remains outside this layer. */
export default function VaultScene({ onFinish }: { onFinish: () => void }) {
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [started, setStarted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let disposed = false;
    let fade: number | undefined;
    let stalled: number | undefined;
    const finish = () => { if (!disposed) onFinish(); };
    const timeout = window.setTimeout(finish, reduced ? 450 : 3900);
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    preference.addEventListener('change', finish);
    const video = videoRef.current;
    const playing = () => {
      window.clearTimeout(stalled);
      window.clearTimeout(fade);
      setStarted(true);
      // Track actual media time, never restart the overall launch deadline.
      fade = window.setTimeout(() => setExiting(true),
        Math.max(0, vaultClip.durationMs - video!.currentTime * 1000 - vaultClip.fadeMs));
    };
    const waiting = () => {
      window.clearTimeout(stalled);
      stalled = window.setTimeout(finish, 450);
    };
    if (video) {
      video.addEventListener('playing', playing);
      video.addEventListener('waiting', waiting);
      video.addEventListener('stalled', waiting);
      video.addEventListener('error', finish);
      video.addEventListener('ended', finish);
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
        video.removeEventListener('ended', finish);
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [onFinish, reduced]);

  return <div className={`vault-launch ${reduced ? 'vault-launch--reduced' : ''}`}
    aria-hidden="true" data-vault-launch="">
    <div className={`vault-launch__surface ${exiting ? 'vault-launch__surface--exiting' : ''}`}>
      <img className="vault-launch__media" src={vaultClip.poster} alt="" draggable={false}
        decoding="async" onError={onFinish} data-vault-poster="" />
      {!reduced && <video ref={videoRef} src={vaultClip.video} muted playsInline preload="auto"
        disablePictureInPicture disableRemotePlayback tabIndex={-1}
        className={`vault-launch__media vault-launch__video ${started ? 'vault-launch__video--started' : ''}`}
        data-vault-video="" />}
    </div>
  </div>;
}