import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { pool, healthPool } from '../db';
import { parseReleaseFeed, unwrapGoogleAlertLink, googleAlertsTrial, buildSources } from '../services/setIntelligence';

after(async () => { await pool.end(); await healthPool.end(); });

test('trial is present before its deadline and absent at and after it', () => {
  const hasSource = (date: string) => buildSources(new Date(date)).some(s => s.name === googleAlertsTrial.name);
  assert.equal(hasSource('2026-11-23T12:00:00Z'), true);
  assert.equal(hasSource('2027-02-23T05:59:59Z'), true);
  assert.equal(hasSource(googleAlertsTrial.endsAt), false);
  assert.equal(hasSource('2027-03-01'), false);
});

test('Atom leads keep article links and never infer a release date', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Google Alerts</title>
    <entry><title type="html">2026 Marvel trading cards announcement</title>
    <link href="https://www.google.com/url?url=https%3A%2F%2Fexample.com%2Fmarvel&amp;ct=ga"/>
    <published>2026-11-23T00:00:00Z</published>
    <content type="html">New Marvel cards. December 1, 2026.</content></entry>
    <entry><title>Football cards</title><link href="https://example.com/football"/></entry></feed>`;
  const parsed = parseReleaseFeed(xml, googleAlertsTrial.name, 'rss', 40);
  assert.equal(parsed.itemsSeen, 2);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].sourceUrl, 'https://example.com/marvel');
  assert.equal(parsed.items[0].estimatedReleaseDate, null);
  assert.equal(parsed.items[0].baseConfidence, 40);
  assert.match(parsed.items[0].description!, /Unverified Google Alerts lead/);
  assert.match(parsed.items[0].description!, /December 1/);
});

test('empty feed is valid; HTML and unsafe links are not', () => {
  assert.equal(parseReleaseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><title>Alerts</title></feed>', googleAlertsTrial.name, 'rss', 40).items.length, 0);
  assert.throws(() => parseReleaseFeed('<html>Blocked</html>', googleAlertsTrial.name, 'rss', 40));
  assert.equal(unwrapGoogleAlertLink('https://www.google.com/url?q=javascript:alert(1)'), '');
  assert.equal(unwrapGoogleAlertLink('not a url'), '');
  assert.equal(unwrapGoogleAlertLink('https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fnews'), 'https://example.com/news');
});
