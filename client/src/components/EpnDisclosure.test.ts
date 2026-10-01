import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync('client/src/components/EpnDisclosure.tsx', 'utf8');

test('EPN disclosure wording is exactly the approved sentences', async () => {
  const { EPN_DISCLOSURE, EPN_SPONSORED_DISCLOSURE } = await import('./EpnDisclosure');
  assert.equal(EPN_DISCLOSURE, 'As an eBay Partner Network affiliate, MCV earns from qualifying purchases.');
  assert.equal(EPN_SPONSORED_DISCLOSURE, 'Sponsored · As an eBay Partner Network affiliate, MCV earns from qualifying purchases.');
});

test('every client file that renders eBay links or listings shows the disclosure', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(name) && !name.endsWith('.test.tsx')) files.push(full);
    }
  };
  walk('client/src');
  const ebayUi = /Buy on eBay|View on eBay|openEbaySearch\(|buildEbayAffiliateUrl\(|itemWebUrl|itemAffiliateWebUrl/;
  const offenders = files.filter(f => !f.endsWith('EpnDisclosure.tsx'))
    .filter(f => ebayUi.test(readFileSync(f, 'utf8')) && !readFileSync(f, 'utf8').includes('<EpnDisclosure'));
  assert.deepEqual(offenders, []);
});

test('the site-wide sidebar carries the unprefixed disclosure; eBay sections keep "Sponsored · "', () => {
  assert.match(readFileSync('client/src/components/layout/sidebar.tsx', 'utf8'), /<EpnDisclosure sponsored=\{false\}/);
  for (const f of ['client/src/components/cards/card-detail-modal.tsx', 'client/src/pages/market-trends.tsx']) {
    const text = readFileSync(f, 'utf8');
    assert.ok(text.includes('<EpnDisclosure') && !text.includes('sponsored={false}'), f);
  }
});
