import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { createLaunchClaim, guardVaultLaunch, isNativeVaultPlatform } from './lifecycle';

// No frame import or download occurs unless the native gate actually opens.
const VaultScene = lazy(() => import('./VaultScene'));
const claimLaunch = createLaunchClaim();

class FailOpen extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function NativeVaultLaunch() {
  const [visible, setVisible] = useState(false);
  const cleanup = useRef<(() => void) | undefined>();
  const deadline = useRef(0);
  const finish = useCallback(() => {
    cleanup.current?.();
    cleanup.current = undefined;
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!isNativeVaultPlatform(Capacitor) || !claimLaunch()) return;
    // Playback is independent of authentication and route readiness.
    if (document.hidden || window.innerWidth > window.innerHeight) return;
    deadline.current = performance.now() + 4000;
    setVisible(true);
    cleanup.current = guardVaultLaunch(finish, window, document);
    return () => cleanup.current?.();
    // Capture startup only. Later auth/route changes must never replay the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;
  return <FailOpen onFailure={finish}>
    <Suspense fallback={null}><VaultScene onFinish={finish} deadline={deadline.current} /></Suspense>
  </FailOpen>;
}