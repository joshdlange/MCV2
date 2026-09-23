import { useEffect, useState, type CSSProperties } from 'react';
import frame1 from './frames/frame-1.webp';
import frame2 from './frames/frame-2.webp';
import frame3 from './frames/frame-3.webp';
import frame4 from './frames/frame-4.webp';
import frame5 from './frames/frame-5.webp';
import frame6 from './frames/frame-6.webp';
import './vault-launch.css';

export const vaultFrames = [frame1, frame2, frame3, frame4, frame5, frame6];

/** Pure visual layer. Native gating lives outside; no auth, API, audio, or haptics. */
export default function VaultScene({ onFinish }: { onFinish: () => void }) {
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(onFinish, reduced ? 450 : 3900);
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => onFinish();
    preference.addEventListener('change', changed);
    return () => {
      clearTimeout(timeout);
      preference.removeEventListener('change', changed);
    };
  }, [onFinish, reduced]);

  return <div className={`vault-launch ${started ? 'vault-launch--started' : ''} ${reduced ? 'vault-launch--reduced' : ''}`}
    aria-hidden="true" data-vault-launch="">
    <div className="vault-launch__camera">
      <div className="vault-launch__shake">
        {(reduced ? vaultFrames.slice(0, 1) : vaultFrames).map((src, index) =>
          <img key={src} src={src} alt="" draggable={false}
            className="vault-launch__frame"
            style={{ '--frame-delay': `${[0, 800, 1250, 1700, 2150, 2650][index]}ms` } as CSSProperties}
            data-vault-frame={index + 1}
            decoding="async"
            onLoad={() => { if (index === 0) setStarted(true); }}
            onError={onFinish} />,
        )}
      </div>
    </div>
    <div className="vault-launch__energy" />
    <div className="vault-launch__shade" />
  </div>;
}