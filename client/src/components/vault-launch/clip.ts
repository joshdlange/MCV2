import video from './media/vault-entry.mp4';
import poster from './media/vault-poster.webp';

// Rotate the experience here: replace the two assets and update durationMs.
// Keep silent H.264/yuv420p MP4 with faststart, portrait framing, and <=3600ms.
// The independent 4s native guard must never be extended to fit a replacement.
export const vaultClip = { video, poster, durationMs: 3600, fadeMs: 200 } as const;

export const vaultHandoff = {
  normal: { holdMs: 120, revealMs: 300 },
  reduced: { holdMs: 40, revealMs: 180 },
  schedulingMarginMs: 130,
} as const;