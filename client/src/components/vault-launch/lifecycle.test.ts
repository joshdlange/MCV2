import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLaunchClaim, guardVaultLaunch, isNativeVaultPlatform } from './lifecycle';

test('requires explicit Capacitor native AND ios/android, failing closed on errors', () => {
  for (const platform of ['web', 'ios', 'android', 'unknown', '']) {
    for (const native of [true, false]) {
      assert.equal(isNativeVaultPlatform({
        isNativePlatform: () => native, getPlatform: () => platform,
      }), native && ['ios', 'android'].includes(platform));
    }
  }
  assert.equal(isNativeVaultPlatform({
    isNativePlatform: () => { throw Error('missing bridge'); }, getPlatform: () => 'ios',
  }), false);
});

test('claims once per launch, not again on route/auth renders', () => {
  const claim = createLaunchClaim();
  assert.equal(claim(), true);
  for (let i = 0; i < 20; i++) assert.equal(claim(), false);
  assert.equal(createLaunchClaim()(), true);
});

function environment() {
  const timers = new Map<number, () => void>();
  const winListeners = new Map<string, () => void>();
  const docListeners = new Map<string, () => void>();
  let delay = 0;
  const host = {
    innerWidth: 393, innerHeight: 852,
    setTimeout(fn: () => void, ms: number) { timers.set(1, fn); delay = ms; return 1; },
    clearTimeout(id: number) { timers.delete(id); },
    addEventListener(name: string, fn: () => void) { winListeners.set(name, fn); },
    removeEventListener(name: string) { winListeners.delete(name); },
  };
  const doc = {
    hidden: false,
    addEventListener(name: string, fn: () => void) { docListeners.set(name, fn); },
    removeEventListener(name: string) { docListeners.delete(name); },
  };
  return { host, doc, timers, winListeners, docListeners, delay: () => delay };
}

test('hard deadline includes loading time, fires once, and removes every listener/timer', () => {
  const env = environment();
  let finished = 0;
  const cleanup = guardVaultLaunch(() => finished++, env.host as any, env.doc as any);
  assert.equal(env.delay(), 4000);
  const fire = env.timers.get(1)!;
  fire(); fire(); cleanup();
  assert.equal(finished, 1);
  assert.equal(env.timers.size + env.winListeners.size + env.docListeners.size, 0);
});

test('background, navigation exit, and landscape fail open; unmount cleans without finishing', () => {
  for (const cause of ['visibility', 'pagehide', 'resize', 'unmount']) {
    const env = environment();
    let finished = 0;
    const cleanup = guardVaultLaunch(() => finished++, env.host as any, env.doc as any);
    if (cause === 'visibility') { env.doc.hidden = true; env.docListeners.get('visibilitychange')!(); }
    if (cause === 'pagehide') env.winListeners.get('pagehide')!();
    if (cause === 'resize') { env.host.innerWidth = 1000; env.winListeners.get('resize')!(); }
    if (cause === 'unmount') cleanup();
    assert.equal(finished, cause === 'unmount' ? 0 : 1);
    assert.equal(env.timers.size + env.winListeners.size + env.docListeners.size, 0);
  }
});