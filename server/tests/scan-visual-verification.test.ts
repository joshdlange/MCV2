import { test } from 'node:test';
import assert from 'node:assert/strict';

// The service imports the DB-backed matcher, but these tests exercise only
// pure parsing/reranking; no database or paid AI request is made.
process.env.DATABASE_URL ||= 'postgres://unused:unused@localhost:5432/unused';
delete process.env.OPENAI_API_KEY;

const { buildParsedScan, rerankVisualMatches, identifyCardWithVision, verifyCandidateArt } =
  await import('../services/scanService');

const vision = (values: Record<string, string | null>) => ({
  ocrText: null, characterName: null, setName: null, subsetName: null,
  cardNumber: null, year: null, brand: null, variant: null,
  copyrightLine: null, serialIndicator: null, ...values,
});
const parsed = buildParsedScan(vision({ characterName: 'Spider-Man', cardNumber: '7' }));
const match = (id: number, imageUrl: string | null, subsetName: string | null = null) => ({
  cardId: id, name: 'Spider-Man', setName: 'Marvel Masterpieces',
  subsetName, cardNumber: '7', year: 2024, imageUrl,
  confidence: 80, confidenceLevel: 'medium' as const, matchReasons: ['Card number matched'],
});

test('serial print runs never become checklist numbers, including OCR fallback', () => {
  assert.equal(buildParsedScan(vision({ serialIndicator: '23/100', ocrText: '23/100 Marvel' })).cardNumber, null);
  assert.equal(buildParsedScan(vision({ cardNumber: '23/100', ocrText: '23/100 No. 7' })).cardNumber, '7');
  assert.equal(buildParsedScan(vision({ cardNumber: 'MM-7', serialIndicator: '23/100' })).cardNumber, 'MM-7');
});

test('visual verification reranks shortlist without dropping missing-image text matches', () => {
  const matches = [match(1, 'https://images.example.com/a.jpg'), match(2, null),
    match(3, 'https://images.example.com/b.jpg')];
  const result = rerankVisualMatches(matches, [
    { cardId: 1, judgement: 'mismatch' },
    { cardId: 3, judgement: 'strong' },
  ], parsed);
  assert.deepEqual(result.map(m => m.cardId), [3, 2, 1]);
  assert.equal(result.find(m => m.cardId === 2)?.confidence, 80);
  assert.equal(result.find(m => m.cardId === 3)?.confidence, 94);
});

test('invalid IDs, missing or unsafe image references and invalid judgements cannot affect ranking', () => {
  const matches = [match(1, 'http://127.0.0.1/a.jpg'), match(2, null)];
  const result = rerankVisualMatches(matches, [
    { cardId: 1, judgement: 'strong' }, { cardId: 2, judgement: 'mismatch' },
    { cardId: 999, judgement: 'strong' },
  ], parsed);
  assert.deepEqual(result.map(m => m.confidence), [80, 80]);
});

test('art cannot certify a parallel when the scan has no explicit variant cue', () => {
  const matches = [match(1, 'https://images.example.com/a.jpg', 'Gold'),
    match(2, 'https://images.example.com/b.jpg', 'Silver')];
  const result = rerankVisualMatches(matches, [{ cardId: 1, judgement: 'strong' }], parsed);
  assert.equal(result[0].confidence, 84);
  assert.equal(result[0].confidenceLevel, 'medium');
  const explicit = { ...parsed, variant: 'Gold' };
  assert.equal(rerankVisualMatches(matches, [{ cardId: 1, judgement: 'strong' }], explicit)[0].confidence, 94);
});

test('high numeric score for character-only match stays capped even after strong art', () => {
  const candidate = { ...match(1, 'https://images.example.com/a.jpg'), confidence: 110, confidenceLevel: 'medium' as const };
  const [result] = rerankVisualMatches([candidate], [{ cardId: 1, judgement: 'strong' }], parsed);
  assert.equal(result.confidence, 124);
  assert.equal(result.confidenceLevel, 'medium');
});

test('top-two ambiguity after rerank caps otherwise eligible high matches', () => {
  const a = { ...match(1, 'https://images.example.com/a.jpg'), confidence: 115, confidenceLevel: 'high' as const };
  const b = { ...match(2, 'https://images.example.com/b.jpg'), confidence: 95, confidenceLevel: 'high' as const };
  const result = rerankVisualMatches([a, b], [{ cardId: 2, judgement: 'strong' }], parsed);
  assert.deepEqual(result.map(m => m.confidenceLevel), ['medium', 'medium']);
  assert.deepEqual(result.map(m => m.confidence), [115, 109]);
});

test('unsupported visual judgements never add corroboration or alter score', () => {
  const candidate = match(1, 'https://images.example.com/a.jpg');
  const result = rerankVisualMatches([candidate],
    [{ cardId: 1, judgement: 'identical parallel' as any }], parsed);
  assert.equal(result[0].confidence, 80);
  assert.deepEqual(result[0].matchReasons, candidate.matchReasons);
  assert.equal(rerankVisualMatches([candidate], [
    { cardId: 1, judgement: 'unsupported' as any },
    { cardId: 1, judgement: 'strong' },
  ], parsed)[0].confidence, 94);
});

test('mock OpenAI comparison uses bounded options and only shortlisted reference images', async () => {
  const calls: { body: any; options: any }[] = [];
  const client = { chat: { completions: { create: async (body: any, options: any) => {
    calls.push({ body, options });
    return { choices: [{ message: { content: JSON.stringify({
      assessments: [{ cardId: 2, judgement: 'strong' }, { cardId: 3, judgement: 'fabricated' }],
    }) } }] };
  } } } } as unknown as Parameters<typeof verifyCandidateArt>[4];
  const candidates = [
    match(1, null), match(2, 'https://images.example.com/b.jpg'),
    match(3, 'https://images.example.com/c.jpg'), match(4, 'https://images.example.com/d.jpg'),
    match(5, 'https://images.example.com/e.jpg'),
  ];
  const result = await verifyCandidateArt(Buffer.from('front'), 'image/png', candidates, parsed, client);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { timeout: 8000, maxRetries: 0 });
  assert.equal(calls[0].body.timeout, undefined);
  assert.equal(calls[0].body.maxRetries, undefined);
  const content = calls[0].body.messages[0].content;
  assert.equal(content.filter((part: any) => part.type === 'image_url').length, 4); // front + 3 references
  assert.equal(content.some((part: any) => part.image_url?.url?.endsWith('/e.jpg')), false);
  assert.equal(result.status, 'verified');
  assert.equal(result.matches.length, 5);
  assert.equal(result.matches.find(m => m.cardId === 3)?.confidence, 80);
});

test('mock OCR call includes optional back and applies timeout as SDK options', async () => {
  const calls: { body: any; options: any }[] = [];
  const client = { chat: { completions: { create: async (body: any, options: any) => {
    calls.push({ body, options });
    return { choices: [{ message: { content: '{"ocrText":"No. 7","cardNumber":"7"}' } }] };
  } } } } as unknown as Parameters<typeof identifyCardWithVision>[3];
  const result = await identifyCardWithVision(Buffer.from('front'), 'image/png',
    { buffer: Buffer.from('back'), mimeType: 'image/jpeg' }, client);
  assert.equal(result.cardNumber, '7');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { timeout: 10000, maxRetries: 0 });
  assert.equal(calls[0].body.timeout, undefined);
  assert.equal(calls[0].body.messages[0].content.filter((part: any) => part.type === 'image_url').length, 2);
});

test('visual API failure retains original metadata candidates', async () => {
  const candidates = [match(1, 'https://images.example.com/a.jpg'), match(2, null)];
  const client = { chat: { completions: { create: async () => { throw new Error('mock timeout'); } } } } as
    unknown as Parameters<typeof verifyCandidateArt>[4];
  const oldWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await verifyCandidateArt(Buffer.from('front'), 'image/jpeg', candidates, parsed, client);
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.matches, candidates);
  } finally {
    console.warn = oldWarn;
  }
});