import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { hasUsableScanCardImage, scanCorrection, submitScanPhoto } from '../../client/src/lib/scanConfirmation';

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
    mutationFn: (variables: { cardId: number; epoch: number }) => Promise<unknown>;
    onSuccess: (result: any) => Promise<void>;
    onError: (error: Error, variables: { cardId: number; epoch: number }) => void;
  }>(declaration.initializer.getText(tree), context);
}

function scanHarness(options: {
  cardId?: number; submitImage?: boolean; imageUrl?: string | null;
  failCollection?: boolean; failImage?: boolean; visualV1?: boolean;
  telemetry?: boolean;
  frontFile?: File | null; token?: string | null; autoApproved?: boolean;
  owned?: boolean; afterCollection?: (context: Record<string, any>) => void;
  afterToken?: (context: Record<string, any>) => void;
  afterUpload?: (context: Record<string, any>) => void;
} = {}) {
  const calls: Array<{ path: string; body: any; headers?: any }> = [];
  const states: string[] = [];
  const toasts: any[] = [];
  const pending: Promise<unknown>[] = [];
  const telemetryEvents: Array<{ update: unknown; pathsAtAttempt: string[] }> = [];
  const selectedCard = { cardId: options.cardId ?? 902, name: 'Manually selected card' };
  const context: Record<string, any> = {
    Error,
    selectedCard,
    scanEpoch: { current: 7 },
    scanTelemetry: { current: options.telemetry ? {
      record: (update: unknown) => telemetryEvents.push({ update: JSON.parse(JSON.stringify(update)), pathsAtAttempt: calls.map(call => call.path) }),
    } : null },
    visualV1: options.visualV1 ?? false,
    frontFile: options.frontFile === undefined ? new File(['cropped photo'], 'front.jpg', { type: 'image/jpeg' }) : options.frontFile,
    alreadyOwned: options.owned ?? false,
    user: { getIdToken: async () => {
      options.afterToken?.(context);
      return options.token === undefined ? 'firebase-test-token' : options.token;
    } },
    scanResult: { imageUrl: options.imageUrl === undefined ? 'https://example.com/scan.jpg' : options.imageUrl, scanUploadId: null, matches: [] },
    submitImage: options.submitImage ?? true,
    photoSubmission: 'idle',
    feedbackGiven: false,
    useMutation: (config: unknown) => config,
    apiRequest: async (_method: string, path: string, body: any) => {
      calls.push({ path, body });
      if (path === '/api/collection' && options.failCollection) throw Error('Collection unavailable');
      if (path.endsWith('/submit-scan-image') && options.failImage) throw Error('Image unavailable');
      if (path === '/api/collection') options.afterCollection?.(context);
      return { json: async () => path === '/api/collection' ? { id: 1 } : { autoApproved: false } };
    },
    qc: { invalidateQueries: () => {} },
    setStage: (state: string) => states.push(`stage:${state}`),
    setPhotoSubmission: (state: string) => { states.push(`photo:${state}`); context.photoSubmission = state; },
    toast: (value: unknown) => toasts.push(value),
    sendFeedback: () => {},
    scanCorrection, submitScanPhoto,
  };
  // Evaluate the actual upload helper with a local mocked fetch, never a network
  // call or process-wide fetch override.
  const helperSource = readFileSync(new URL('../../client/src/lib/scanConfirmation.ts', import.meta.url), 'utf8');
  const helperTree = sourceFile(helperSource, ts.ScriptKind.TS);
  const helper = walk(helperTree, node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'uploadScanFrontPhoto') as ts.FunctionDeclaration;
  context.uploadScanFrontPhoto = evaluate(`(${helper.getText(helperTree).replace(/^export /, '')})`, {
    Error,
    FormData,
    fetch: async (path: string, request: any) => {
      calls.push({ path, body: request.body, headers: request.headers });
      options.afterUpload?.(context);
      return {
        ok: !options.failImage,
        json: async () => options.failImage ? { message: 'Image unavailable' } : { autoApproved: options.autoApproved ?? false },
      };
    },
  });
  const mutation = scanMutation(context);
  context.addToCollectionMutation = {
    isPending: false,
    mutate: (variables: { cardId: number; epoch: number }) => {
      const operation = mutation.mutationFn(variables).then(result => mutation.onSuccess(result), error => mutation.onError(error, variables));
      pending.push(operation);
    },
  };
  const tree = sourceFile(scanSource, ts.ScriptKind.TSX);
  const declaration = walk(tree, node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'confirmCard') as ts.FunctionDeclaration | undefined;
  assert.ok(declaration, 'Scan to Add must have confirmation handler');
  const confirm = evaluate<() => void>(`(${declaration.getText(tree)})`, context);
  return { mutation, confirm, calls, states, pending, context, toasts, telemetryEvents };
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

test('visual opted-in photo uses retained front File, Firebase Bearer, and multipart only after collection save', async () => {
  const front = new File(['real cropped front'], 'cropped.webp', { type: 'image/webp' });
  const harness = scanHarness({ visualV1: true, frontFile: front, imageUrl: null });
  await performMutation(harness);
  assert.deepEqual(harness.calls.map(call => call.path), ['/api/collection', '/api/cards/902/upload']);
  assert.equal(harness.calls[0].body.cardId, 902);
  const upload = harness.calls[1];
  assert.equal(upload.headers.Authorization, 'Bearer firebase-test-token');
  assert.equal(upload.headers['Content-Type'], undefined, 'browser supplies multipart boundary');
  assert.ok(upload.body instanceof FormData);
  assert.deepEqual([...upload.body.keys()], ['frontImage']);
  const submitted = upload.body.get('frontImage') as File;
  assert.equal(submitted.name, front.name);
  assert.equal(await submitted.text(), await front.text());
  assert.ok(harness.states.includes('photo:submitted'));
});

test('visual photo opt-out never uploads, including an already-owned card', async () => {
  for (const owned of [false, true]) {
    const harness = scanHarness({ visualV1: true, submitImage: false, owned });
    await performMutation(harness);
    assert.deepEqual(harness.calls.map(call => call.path), ['/api/collection']);
    assert.ok(harness.states.includes('stage:success'));
  }
});

test('already-owned visual card still follows collection add then optional upload', async () => {
  const harness = scanHarness({ visualV1: true, owned: true });
  await performMutation(harness);
  assert.deepEqual(harness.calls.map(call => call.path), ['/api/collection', '/api/cards/902/upload']);
});

test('visual upload failure cannot undo ownership or turn collection success into failure', async () => {
  const harness = scanHarness({ visualV1: true, failImage: true });
  await performMutation(harness);
  assert.deepEqual(harness.calls.map(call => call.path), ['/api/collection', '/api/cards/902/upload']);
  assert.ok(harness.states.includes('stage:success'));
  assert.ok(harness.states.includes('photo:failed'));
  assert.equal(harness.toasts[0].title, 'Photo was not submitted');
});

test('visual failed collection never uploads even when explicitly opted in', async () => {
  const harness = scanHarness({ visualV1: true, failCollection: true });
  await performMutation(harness);
  assert.deepEqual(harness.calls.map(call => call.path), ['/api/collection']);
  assert.equal(harness.states.includes('stage:success'), false);
});

test('visual mode, File, and opt-in are snapshotted before the collection await', async () => {
  const front = new File(['original front'], 'original.jpg', { type: 'image/jpeg' });
  const harness = scanHarness({
    visualV1: true, frontFile: front,
    afterCollection: context => {
      context.frontFile = new File(['new scan'], 'new.jpg');
      context.submitImage = false;
      context.visualV1 = false;
      context.scanResult.imageUrl = 'https://example.com/unrelated.jpg';
    },
  });
  await performMutation(harness);
  assert.equal(harness.calls[1].path, '/api/cards/902/upload');
  assert.equal(await (harness.calls[1].body.get('frontImage') as File).text(), 'original front');
});

test('visual upload respects server admin/trusted auto-approval response', async () => {
  const harness = scanHarness({ visualV1: true, autoApproved: true });
  await performMutation(harness);
  assert.ok(harness.states.includes('photo:approved'));
  assert.equal(harness.states.includes('photo:submitted'), false);
});

test('visual missing token or File never sends unauthenticated upload or falls back to scan URL', async () => {
  for (const options of [{ token: null }, { frontFile: null }]) {
    const harness = scanHarness({ visualV1: true, ...options });
    await performMutation(harness);
    assert.deepEqual(harness.calls.map(call => call.path), ['/api/collection']);
    assert.ok(harness.states.includes('stage:success'));
    assert.ok(harness.states.includes('photo:failed'));
  }
});

test('visual photo size allows 5MB and reports larger photos without undoing collection save', async () => {
  for (const size of [5 * 1024 * 1024, 5 * 1024 * 1024 + 1]) {
    const harness = scanHarness({ visualV1: true, frontFile: new File([new Uint8Array(size)], 'front.jpg', { type: 'image/jpeg' }) });
    await performMutation(harness);
    assert.ok(harness.states.includes('stage:success'));
    if (size > 5 * 1024 * 1024) {
      assert.equal(harness.calls.length, 1);
      assert.ok(harness.states.includes('photo:failed'));
      assert.match(harness.toasts[0].description, /5MB.*crop/i);
    } else {
      assert.equal(harness.calls[1].path, '/api/cards/902/upload');
    }
  }
});

test('stale collection or token completion cannot upload a reset scan photo', async () => {
  for (const change of ['afterCollection', 'afterToken'] as const) {
    const harness = scanHarness({ visualV1: true, [change]: (context: Record<string, any>) => { context.scanEpoch.current += 1; } });
    await performMutation(harness);
    assert.deepEqual(harness.calls.map(call => call.path), ['/api/collection']);
    assert.equal(harness.states.includes('photo:failed'), false, 'stale callbacks must not update reset UI');
  }
});

test('stale upload completion cannot overwrite a reset scan UI', async () => {
  const harness = scanHarness({
    visualV1: true,
    afterUpload: context => { context.scanEpoch.current += 1; },
  });
  await performMutation(harness);
  assert.deepEqual(harness.calls.map(call => call.path), ['/api/collection', '/api/cards/902/upload']);
  assert.equal(harness.states.includes('photo:submitted'), false);
  assert.equal(harness.states.includes('photo:failed'), false);
});

test('visual recognition sends image for scanning only, never submits a review photo', () => {
  const tree = sourceFile(scanSource, ts.ScriptKind.TSX);
  const declaration = walk(tree, node => ts.isVariableDeclaration(node)
    && node.name.getText(tree) === 'scanMutation') as ts.VariableDeclaration;
  const recognition = declaration.initializer!.getText(tree);
  assert.match(recognition, /fetch\("\/api\/cards\/scan"/);
  assert.doesNotMatch(recognition, /uploadScanFrontPhoto|submitScanPhoto|submit-scan-image|\/upload/);
});

test('photo telemetry records an actual multipart attempt only after collection success', async () => {
  for (const failImage of [false, true]) {
    const harness = scanHarness({ visualV1: true, telemetry: true, failImage });
    await performMutation(harness);
    assert.deepEqual(harness.telemetryEvents, [{
      update: { photoSubmitUsed: true },
      pathsAtAttempt: ['/api/collection'],
    }]);
    assert.equal(harness.calls[1].path, '/api/cards/902/upload');
    assert.ok(harness.states.includes('stage:success'));
  }
});

test('photo telemetry does not record checkbox opt-in without an actual submission attempt', async () => {
  const cases = [
    { submitImage: false },
    { failCollection: true },
    { frontFile: null },
    { token: null },
    { frontFile: new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.jpg') },
    { afterToken: (context: Record<string, any>) => { context.scanEpoch.current += 1; } },
  ];
  for (const options of cases) {
    const harness = scanHarness({ visualV1: true, telemetry: true, ...options });
    await performMutation(harness);
    assert.deepEqual(harness.telemetryEvents, []);
  }
});

test('photo telemetry uses the recorder snapshotted before the collection await', async () => {
  const harness = scanHarness({
    visualV1: true, telemetry: true,
    afterCollection: context => {
      context.scanTelemetry.current = { record: () => assert.fail('must not use a different scan recorder') };
    },
  });
  await performMutation(harness);
  assert.equal(harness.telemetryEvents.length, 1);
});

test('visual review checkbox uses missing/failed image and retained front File, not scan URL', () => {
  const tree = sourceFile(scanSource, ts.ScriptKind.TSX);
  const condition = walk(tree, node => ts.isVariableDeclaration(node)
    && node.name.getText(tree) === 'cardMissingImage') as ts.VariableDeclaration;
  for (const imageUrl of [null, '', 'data:image/png;base64,abc', 'https://via.placeholder.com/200?text=Card',
    'https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png?cache=1']) {
    assert.ok(evaluate(condition.initializer!.getText(tree), { selectedCard: { imageUrl }, dbImageBroken: false, visualV1: true, hasUsableScanCardImage }));
  }
  assert.ok(evaluate(condition.initializer!.getText(tree), { selectedCard: { imageUrl: 'https://example.com/card.jpg' }, dbImageBroken: true, visualV1: true, hasUsableScanCardImage }));
  assert.equal(evaluate(condition.initializer!.getText(tree), { selectedCard: { imageUrl: 'https://example.com/card.jpg' }, dbImageBroken: false, visualV1: true, hasUsableScanCardImage }), false);
  assert.equal(evaluate(condition.initializer!.getText(tree), { selectedCard: { imageUrl: '/legacy-relative.jpg' }, dbImageBroken: false, visualV1: false, hasUsableScanCardImage }), false, 'legacy image behavior is unchanged');
  assert.match(scanSource, /cardMissingImage && \(visualV1 \? frontFile : scanResult\?\.imageUrl\)/);
  assert.match(scanSource, /onError=\{\(\) => setDbImageBroken\(true\)\}/);
  assert.match(scanSource, /const \[submitImage, setSubmitImage\] = useState\(false\)/);
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