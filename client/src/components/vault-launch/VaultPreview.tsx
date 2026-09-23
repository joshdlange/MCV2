import { useCallback, useEffect, useState } from 'react';
import VaultScene from './VaultScene';
import { vaultClip } from './clip';

const devices = [
  ['iPhone · 393 × 852', 393, 852], ['Small iPhone · 375 × 667', 375, 667],
  ['Android · 360 × 800', 360, 800], ['Tall Android · 412 × 915', 412, 915],
] as const;

/** DEV-only studio: never imported in production, not a native-platform override. */
export default function VaultPreview() {
  const [device, setDevice] = useState(0);
  const [take, setTake] = useState(0);
  const [playing, setPlaying] = useState(false);
  const finish = useCallback(() => setPlaying(false), []);
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(finish, 4000);
    return () => clearTimeout(id);
  }, [playing, finish, take]);
  const [, width, height] = devices[device];
  return <main style={{ minHeight: '100vh', background: '#080b10', color: '#f4f4f5', padding: '32px 20px', fontFamily: 'system-ui' }}>
    <div style={{ maxWidth: 1100, margin: 'auto', display: 'flex', flexWrap: 'wrap', gap: 40, alignItems: 'flex-start', justifyContent: 'center' }}>
      <section style={{ maxWidth: 350, paddingTop: 20 }}>
        <p style={{ color: '#fb4b44', fontSize: 11, letterSpacing: 3 }}>NATIVE LAUNCH EXPERIMENT</p>
        <h1 style={{ fontSize: 40, lineHeight: 1.1, margin: '18px 0' }}>Enter the vault.</h1>
        <p style={{ color: '#a4adba', lineHeight: 1.7 }}>One continuous motion. The vault unlocks, the door swings away, and a red universe opens beyond it.</p>
        <p style={{ color: '#a4adba', fontSize: 13, margin: '20px 0' }}>Development preview only. This studio is not available in the published app. Ordinary web sessions never play the launch animation.</p>
        <label style={{ display: 'block', marginBottom: 8 }} htmlFor="vault-device">Preview size</label>
        <select id="vault-device" value={device} onChange={e => { setDevice(Number(e.target.value)); finish(); }}
          style={{ padding: 12, width: '100%', background: '#f4f4f5', color: '#18181b', border: '1px solid #354052', borderRadius: 8 }}>
          {devices.map(([name], index) => <option key={name} value={index}>{name}</option>)}
        </select>
        <button onClick={() => { setTake(t => t + 1); setPlaying(true); }}
          style={{ background: '#df2824', borderRadius: 8, padding: '13px 22px', margin: '18px 0', fontWeight: 650 }}>
          {playing ? 'Replay sequence' : 'Play sequence'}
        </button>
        <p role="status" style={{ color: '#a4adba', fontSize: 13 }}>{playing ? 'Playing · maximum 4 seconds' : 'Ready to preview'}</p>
        <a href={vaultClip.video} download="vault-entry.mp4" style={{ color: '#fca5a5', fontSize: 13 }}>Download optimized clip</a>
        <p style={{ color: '#a4adba', fontSize: 12, marginTop: 16 }}>Silent · 3.6-second video → full black → quick app reveal. The real native app skips or takes a short exit when startup is ready.</p>
        <p style={{ color: '#717d90', fontSize: 12, marginTop: 20 }}>Your OS reduced-motion setting is respected. The dark surface revealed afterward is a preview backdrop, not an imitation of your account.</p>
      </section>
      <div style={{ width: `min(${width}px, calc((100dvh - 64px) * ${width / height}))`, aspectRatio: `${width} / ${height}`, maxWidth: '100%', flexShrink: 0, position: 'relative', transform: 'translateZ(0)', overflow: 'hidden', borderRadius: 28, border: '1px solid #354052', background: '#0b1018' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#728096', textAlign: 'center', padding: 24 }}>App revealed<br />The real app continues loading underneath.</div>
        {take === 0 && <img src={vaultClip.poster} alt="Vault before opening" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
        {playing && <VaultScene key={take} onFinish={finish} />}
      </div>
    </div>
  </main>;
}