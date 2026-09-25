import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { scanCorrection, submitScanPhoto } from '../../client/src/lib/scanConfirmation';

// Exercise the actual scan mutation callbacks and image-review route with in-memory
// collaborators. Extracting just these functions avoids importing routes.ts (which
// initializes DB-backed services) or mounting a browser, but does not test React
// rendering, network middleware, or database persistence.
const scanSource = readFileSync(new URL('../../client/src/pages/scan.tsx', import.meta.url), 'utf8');
const routesSource = readFileSync(new URL('../routes.ts', import.meta.url), 'utf8');

function sourceFile(text: string, kind: ts.ScriptKind) {
  return ts.createSourceFile('fixture.tsx', text, ts.ScriptTarget.Latest, true, kind);
}

function walk(node: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node | undefined {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => walk(child, predicate));
}

function evaluate<T>(expression: string, context: Record<string, unknown>): T {
  const js = ts.transpileModule(`globalThis.result = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText;
  return runInNewContext(`${js}\nglobalThis.result`, context) as T;
}

function scanMutation(context: Record<string, unknown>) {
  const tree = sourceFile(scanSource, ts.ScriptKind.TSX);
  const declaration = walk(tree, node => ts.isVariableDeclaration(node)
    && node.name.getText(tree) === 'addToCollectionMutation') as ts.VariableDeclaration | undefined;
  assert.ok(declaration?.initializer, 'Scan to Add must keep its collection mutation');
  return evaluate<{
    mutationFn: (cardId: number) => Promise<unknown>;
    onSuccess: (result: any) => Promise<void>;
    onError: (error: Error) => void;
  }>(declaration.initializer.getText(tree), context);
}

function scanHarness(options: { cardId?: number; submitImage?: boolean; imageUrl?: string | null; failCollection?: boolean; failImage?: boolean } = {}) {
  const calls: Array<{ path: string; body: any }> = [];
  const states: string[] = [];
  const pending: Promise<unknown>[] = [];
  const selectedCard = { cardId: options.cardId ?? 902, name: 'Manually selected card' };
  const context: Record<string, any> = {
    selectedCard,
    scanResult: { imageUrl: options.imageUrl === undefined ? 'https://example.com/scan.jpg' : options.imageUrl, scanUploadId: null, matches: [] },
    submitImage: options.submitImage ?? true,
    photoSubmission: 'idle',
    feedbackGiven: false,
    useMutation: (config: unknown) => config,
    apiRequest: async (_method: string, path: string, body: any) => {
      calls.push({ path, body });
      if (path === '/api/collection' && options.failCollection) throw Error('Collection unavailable');
      if (path.endsWith('/submit-scan-image') && options.failImage) throw Error('Image unavailable');
      return { json: async () => path === '/api/collection' ? { id: 1 } : { autoApproved: false } };
    },
    qc: { invalidateQueries: () => {} },
    setStage: (state: string) => states.push(`stage:${state}`),
    setPhotoSubmission: (state: string) => { states.push(`photo:${state}`); context.photoSubmission = state; },
    toast: () => {},
    sendFeedback: () => {},
    scanCorrection, submitScanPhoto,
  };
  const mutation = scanMutation(context);
  context.addToCollectionMutation = {
    isPending: false,
    mutate: (cardId: number) => {
      const operation = mutation.mutationFn(cardId).then(result => mutation.onSuccess(result), mutation.onError);
      pending.push(operation);
    },
  };
  const tree = sourceFile(scanSource, ts.ScriptKind.TSX);
  const declaration = walk(tree, node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'confirmCard') as ts.FunctionDeclaration | undefined;
  assert.ok(declaration, 'Scan to Add must have confirmation handler');
  const confirm = evaluate<() => void>(`(${declaration.getText(tree)})`, context);
  return { mutation, confirm, calls, states, pending };
}

async function performMutation(harness: ReturnType<typeof scanHarness>) {
  harness.confirm();
  await Promise.all(harness.pending);
  // Photo work may be fire-and-forget; let its completion callback settle too.
  await new Promise(resolve => setImmediate(resolve));
}

test('Scan to Add saves collection before optional photo submission', async () => {
  const harness = scanHarness();
  await performMutation(harness);
  assert.deepEqual(harness.calls.map(call => call.path), ['/api/collection', '/api/cards/902/submit-scan-image']);
  assert.equal(harness.calls[0].body.cardId, 902);
  assert.equal(harness.calls[1].body.imageUrl, 'https://example.com/scan.jpg');
  assert.ok(harness.states.includes('stage:success'));
});

test('failed image submission leaves successful collection save intact', async () => {
  const harness = scanHarness({ failImage: true });
  await performMutation(harness);
  assert.deepEqual(harness.calls.map(call => call.path), ['/api/collection', '/api/cards/902/submit-scan-image']);
  assert.ok(harness.states.includes('stage:success'));
  assert.ok(harness.states.includes('photo:failed'));
  assert.equal(harness.calls.some(call => call.path.startsWith('/api/collection/')), false);
});

test('manual picker selection drives the saved ID, not the top scan match', async () => {
  const tree = sourceFile(scanSource, ts.ScriptKind.TSX);
  const picker = walk(tree, node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'handlePickerCardSelect') as ts.FunctionDeclaration | undefined;
  assert.ok(picker, 'manual picker handler must exist');
  let chosenId = 0;
  const select = evaluate<(card: unknown) => void>(`(${picker.getText(tree)})`, {
    pickerSubsetName: '', pickerSetName: 'Set', pickerYear: 2024,
    setSelectedCard: (card: { cardId: number }) => { chosenId = card.cardId; },
    setStage: () => {},
  });
  select({ id: 371, name: 'Manual parallel', cardNumber: '7', variation: 'Gold', frontImageUrl: null });
  // Guard the JSX bridge between the chosen card and the mutation, too.
  const harness = scanHarness({ cardId: chosenId, submitImage: false });
  await performMutation(harness);
  assert.equal(harness.calls[0].body.cardId, 371);
  assert.equal(harness.calls.length, 1);
});

test('failed collection save does not start image submission', async () => {
  const harness = scanHarness({ failCollection: true });
  await performMutation(harness);
  assert.deepEqual(harness.calls.map(call => call.path), ['/api/collection']);
  assert.equal(harness.states.includes('stage:success'), false);
});

type RouteHandler = (req: any, res: any) => Promise<void>;
function routeHandler(path: string, context: Record<string, unknown>): RouteHandler {
  const tree = sourceFile(routesSource, ts.ScriptKind.TS);
  const call = walk(tree, node => ts.isCallExpression(node)
    && node.expression.getText(tree) === 'app.post'
    && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === path) as ts.CallExpression | undefined;
  assert.ok(call, `route ${path} must exist`);
  return evaluate<RouteHandler>(call.arguments.at(-1)!.getText(tree), context);
}

async function invokeRoute(handler: RouteHandler, body: unknown, user: Record<string, unknown> = { id: 4, isAdmin: false }, files?: unknown) {
  let status = 200;
  let response: any;
  const res = {
    status(code: number) { status = code; return this; },
    json(data: unknown) { response = data; return this; },
  };
  await handler({ params: { cardId: '902', id: '17' }, body, user, files }, res);
  return { status, response };
}

test('multipart scan declares optional backImage and validates each file separately before scanning', async () => {
  const tree = sourceFile(routesSource, ts.ScriptKind.TS);
  const route = walk(tree, node => ts.isCallExpression(node)
    && node.expression.getText(tree) === 'app.post'
    && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === '/api/cards/scan') as ts.CallExpression | undefined;
  assert.ok(route, 'multipart recognition route must exist');
  assert.match(route.arguments[2].getText(tree), /name:\s*['"]image['"],\s*maxCount:\s*1/);
  assert.match(route.arguments[2].getText(tree), /name:\s*['"]backImage['"],\s*maxCount:\s*1/);
  const handler = routeHandler('/api/cards/scan', { console });
  const smallJpeg = { size: 42, mimetype: 'image/jpeg' };
  const largeJpeg = { size: 10 * 1024 * 1024 + 1, mimetype: 'image/jpeg' };
  const invalidType = { size: 42, mimetype: 'application/pdf' };
  const request = (front: unknown, back?: unknown) =>
    invokeRoute(handler, {}, undefined, { image: front ? [front] : [], ...(back ? { backImage: [back] } : {}) });
  const missingFront = await request(null, smallJpeg);
  assert.equal(missingFront.status, 400, 'front is required even if back exists');
  assert.match(missingFront.response.message, /required/i);
  for (const files of [[largeJpeg, smallJpeg], [smallJpeg, largeJpeg]] as const) {
    const result = await request(...files);
    assert.equal(result.status, 400, 'each side has its own size limit');
    assert.match(result.response.message, /too large/i);
  }
  for (const files of [[invalidType, smallJpeg], [smallJpeg, invalidType]] as const) {
    const result = await request(...files);
    assert.equal(result.status, 400, 'each side has its own type validation');
    assert.match(result.response.message, /invalid file type/i);
  }
  // Every rejected request must stop before logging usage, uploading, or AI identification.
});

test('admin photo rejection only changes pending-image review state, not card or collection', async () => {
  const updates: any[] = [];
  const handler = routeHandler('/api/admin/pending-images/:id/reject', {
    parseInt, Date, console,
    storage: {
      getPendingCardImage: async () => ({ id: 17, status: 'pending', cardId: 902 }),
      updatePendingCardImage: async (_id: number, update: unknown) => updates.push(update),
      updateCard: async () => { throw Error('rejection must not change card'); },
      addToCollection: async () => { throw Error('rejection must not change collection'); },
      updateCollectionItem: async () => { throw Error('rejection must not change collection'); },
      removeFromCollection: async () => { throw Error('rejection must not change collection'); },
    },
  });
  const result = await invokeRoute(handler, { rejectionReason: 'Blurred photo' }, { id: 1, isAdmin: true });
  assert.equal(result.status, 200);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'rejected');
  assert.equal(updates[0].rejectionReason, 'Blurred photo');
});