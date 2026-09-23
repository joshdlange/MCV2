import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warmNativeDashboard } from './nativeDashboardStartup';

test('warms only native home code, without waiting for auth or issuing data requests', async () => {
  const calls: string[] = [];
  const load = async () => { calls.push('code'); };
  for (const platform of ['ios', 'android']) {
    await warmNativeDashboard({ isNativePlatform: () => true, getPlatform: () => platform }, '/', load);
  }
  assert.deepEqual(calls, ['code', 'code']);
  for (const platform of ['web', 'ios']) {
    await warmNativeDashboard({ isNativePlatform: () => false, getPlatform: () => platform }, '/', load);
  }
  await warmNativeDashboard({ isNativePlatform: () => true, getPlatform: () => 'ios' }, '/my-collection', load);
  await warmNativeDashboard({ isNativePlatform: () => { throw Error('unknown'); }, getPlatform: () => 'ios' }, '/', load);
  assert.equal(calls.length, 2);
});