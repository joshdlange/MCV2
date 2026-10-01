import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { suppressAutomaticCatalogMutations } from '../devCatalogSnapshot';

test('catalog suppression requires exact on, development, and no deployment', () => {
  for (const NODE_ENV of [undefined, '', 'development', 'production', 'test', 'Development']) {
    for (const REPLIT_DEPLOYMENT of [undefined, '', '1', 'true', 'false', '0']) {
      for (const SCAN_VISUAL_RETRIEVAL of [undefined, '', 'on', 'off', 'true', '1', 'ON', ' on', 'on ']) {
        assert.equal(
          suppressAutomaticCatalogMutations({ NODE_ENV, REPLIT_DEPLOYMENT, SCAN_VISUAL_RETRIEVAL }),
          NODE_ENV === 'development' && !REPLIT_DEPLOYMENT && SCAN_VISUAL_RETRIEVAL === 'on',
          JSON.stringify({ NODE_ENV, REPLIT_DEPLOYMENT, SCAN_VISUAL_RETRIEVAL }),
        );
      }
    }
  }
  assert.equal(suppressAutomaticCatalogMutations({}), false);
});

function source(path: string) {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  // Syntax-only parsing avoids importing startup code or connecting to a database.
  const result = ts.transpileModule(file.text, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  });
  assert.deepEqual(result.diagnostics, [], `${path} must parse`);
  return file;
}

function nodesMatching(file: ts.Node, matches: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  function visit(node: ts.Node) {
    if (matches(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

function isGuarded(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isIfStatement(parent)
      && parent.expression.getText() === '!suppressAutomaticCatalogMutations()'
      && node.pos >= parent.thenStatement.pos && node.end <= parent.thenStatement.end) return true;
  }
  return false;
}

function assertImportsGuarded(file: ts.SourceFile, modules: string[], expected: boolean) {
  for (const module of modules) {
    const imports = nodesMatching(file, node => ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === module);
    assert.ok(imports.length > 0, `missing import ${module}`);
    for (const node of imports) assert.equal(isGuarded(node), expected, module);
  }
}

test('startup catalog imports and image worker are guarded; badge/feed and readiness remain live', () => {
  const file = source('server/index.ts');
  assertImportsGuarded(file, [
    './seeds/importSkyboxWizardChromium1996',
    './seeds/importToppsVaultMarvel2026',
    './seeds/mergeDuplicateLegacySets',
    './seeds/restoreTwinMergeImages',
    './seeds/fixTcms2025Checklist',
    './seeds/fixTcms2025Inserts',
    './seeds/fixParallelLeaks',
    './seeds/fixSuperfractor2026JunkSets',
    './services/imageMigration',
  ], true);
  const seeds = nodesMatching(file, node => ts.isVariableDeclaration(node) && node.name.getText() === 'runDataFixSeeds');
  assert.equal(seeds.length, 1);
  const transactions = nodesMatching(seeds[0], node => ts.isCallExpression(node) && node.expression.getText() === 'db.transaction');
  assert.equal(transactions.length, 3, 'retain all badge/feed transactions');
  for (const transaction of transactions) assert.equal(isGuarded(transaction), false);
  const ready = nodesMatching(seeds[0], node => ts.isCallExpression(node) && node.expression.getText() === 'dataFixWriteGate.markReady');
  assert.equal(ready.length, 1);
  assert.equal(isGuarded(ready[0]), false, 'suppressed seeds must still release the write gate');
});

test('route startup catalog repairs are guarded without guarding routes, badges, or setup', () => {
  const file = source('server/routes.ts');
  assertImportsGuarded(file, [
    './seeds/seedCardfunEternalGlory',
    './seeds/fixKakawowCosmosCards',
    './seeds/seedToppsChromeMarvel2026',
    './seeds/seedToppsMintMarvel2026',
    './seeds/seedToppsChromeSapphire2026',
    './seeds/seedToppsFinestFF2026',
    './seeds/fixToppsFinestFF2026Images',
    './services/auDuplicateCleanup',
    './services/xmenAuSetCleanup',
    './seeds/seedUltraWolverine1996Base',
    './services/ultraXmen1996DupeRemoval',
    './services/skybox1993S2Merge',
    './services/spiderman1992Reorg',
  ], true);
  assertImportsGuarded(file, [
    './services/setIntelligence',
    './services/neverLeaveBadgeSeed',
    './services/vaultRegularBadgeSeed',
    './services/topTenBadgeSeed',
    './services/userPlatformsSetup',
  ], false);
  const routes = nodesMatching(file, node => ts.isCallExpression(node)
    && /^app\.(get|post|put|patch|delete|use)$/.test(node.expression.getText()));
  assert.ok(routes.length > 0);
  for (const route of routes) assert.equal(isGuarded(route), false);
});

test('central upcoming publication returns zero before any database work', () => {
  const file = source('server/services/upcomingSetRelease.ts');
  const declarations = nodesMatching(file, node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'publishDueUpcomingSets') as ts.FunctionDeclaration[];
  assert.equal(declarations.length, 1);
  const first = declarations[0].body!.statements[0];
  assert.ok(ts.isIfStatement(first));
  assert.equal(first.expression.getText(), 'suppressAutomaticCatalogMutations()');
  assert.ok(ts.isReturnStatement(first.thenStatement));
  assert.equal(first.thenStatement.expression?.getText(), '0');
  assert.ok(declarations[0].body!.statements[1].getText().includes('await db.select()'));
});