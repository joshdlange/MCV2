import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { vaultClip, vaultHandoff } from './clip';
import './vault-launch.css';

/** Playback owns completion; app readiness never truncates the footage. */
export default function VaultScene({ onFinish, deadline }: { onFinish: () => void; deadline?: number }) {
  const finishBy = useRef(deadline ?? performance.now() + 4000);
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const handoff = reduced ? vaultHandoff.reduced : vaultHandoff.normal;
  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<'playing' | 'blackening' | 'black' | 'revealing'>('playing');
  const videoRef = useRef<HTMLVideoElement>(null);
  const fadeStarted = useRef(false);
  const fadeComplete = useRef(false);
  const mediaEnded = useRef(reduced);
  const holding = useRef(false);
  const handoffTimer = useRef<number>();

  const holdBlack = useCallback(() => {
    // Both conditions matter: finish the real media AND paint opaque black.
    if (!mediaEnded.current || !fadeComplete.current || holding.current) return;
    holding.current = true;
    setPhase('black');
    handoffTimer.current = window.setTimeout(() => setPhase('revealing'), handoff.holdMs);
  }, [handoff.holdMs]);
  const fadeToBlack = useCallback(() => {
    if (fadeStarted.current) return;
    fadeStarted.current = true;
    setPhase('blackening');
  }, []);
  useEffect(() => () => window.clearTimeout(handoffTimer.current), []);

  useEffect(() => {
    let disposed = false;
    let frame: number | undefined;
    let fade: number | undefined;
    let stalled: number | undefined;
    const finish = () => { if (!disposed) onFinish(); };
    // Error-only watchdog, not normal completion. Native gate also bounds the
    // entire launch (including loading) at 4s.
    const timeout = window.setTimeout(finish, reduced ? 450 : 4000);
    if (reduced) fade = window.setTimeout(fadeToBlack, 100);
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    preference.addEventListener('change', finish);
    const video = videoRef.current;
    const tick = () => {
      if (disposed || !video) return;
      const duration = Number.isFinite(video.duration) ? video.duration * 1000 : vaultClip.durationMs;
      if (video.currentTime * 1000 >= duration - vaultClip.fadeMs) fadeToBlack();
      frame = requestAnimationFrame(tick);
    };
    const playing = () => {
      window.clearTimeout(stalled);
      // Reserve the black hold + complete reveal, including a scheduling margin.
      // A modest rate adjustment absorbs normal chunk/decode startup cost without
      // skipping media or allowing the safety guard to cut the handoff short.
      const remaining = vaultClip.durationMs - video!.currentTime * 1000;
      const reservation = handoff.holdMs + handoff.revealMs + vaultHandoff.schedulingMarginMs;
      const budget = finishBy.current - performance.now() - reservation;
      const rate = Math.max(1, remaining / budget);
      if (budget <= 0 || rate > 1.25) { finish(); return; }
      video!.playbackRate = rate;
      setStarted(true);
      if (frame === undefined) frame = requestAnimationFrame(tick);
    };
    const waiting = () => {
      window.clearTimeout(stalled);
      stalled = window.setTimeout(finish, 450);
    };
    const ended = () => {
      window.clearTimeout(stalled);
      mediaEnded.current = true;
      fadeToBlack();
      holdBlack();
    };
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
      if (frame !== undefined) cancelAnimationFrame(frame);
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
  }, [onFinish, reduced, fadeToBlack, holdBlack, handoff]);

  return <div className={`vault-launch vault-launch--${phase}`}
    style={{
      '--vault-fade': `${reduced ? 80 : vaultClip.fadeMs}ms`,
      '--vault-reveal': `${handoff.revealMs}ms`,
    } as CSSProperties}
    onAnimationEnd={event => {
      if (event.target === event.currentTarget && event.animationName === 'vault-reveal') onFinish();
    }}
    aria-hidden="true" data-vault-launch="" data-vault-phase={phase}>
    <div className="vault-launch__surface" onAnimationEnd={event => {
      if (event.target !== event.currentTarget || event.animationName !== 'vault-to-black') return;
      fadeComplete.current = true;
      holdBlack();
    }}>
      <img className="vault-launch__media" src={vaultClip.poster} alt="" draggable={false}
        decoding="async" onError={onFinish} data-vault-poster="" />
      {!reduced && <video ref={videoRef} src={vaultClip.video} muted playsInline preload="auto"
        disablePictureInPicture disableRemotePlayback tabIndex={-1}
        className={`vault-launch__media vault-launch__video ${started ? 'vault-launch__video--started' : ''}`}
        data-vault-video="" />}
    </div>
  </div>;
}