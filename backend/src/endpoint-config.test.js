import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSite, LEGACY_CLOUD_ENDPOINT, PRODUCTION_ENDPOINT_ENV, TEST_CLOUD_ENDPOINT} from '../../scripts/build.mjs';
import {APPWRITE_DATABASE_ID, FUNCTION_TARGETS, PRODUCTION_FUNCTION_ID, PRODUCTION_TABLE_ID, TEST_FUNCTION_ID, TEST_TABLE_ID} from './targets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PRODUCTION_FIXTURE = 'https://ghdraw-production-fixture.fra.appwrite.run';
const VERCEL_CONFIG = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ghdraw-build-config-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

async function expectConfiguredEndpoint(directory, expected) {
  const html = await readFile(path.join(directory, 'index.html'), 'utf8');
  assert.ok(html.includes(`window.GHDRAW_CLOUD_ENDPOINT=${JSON.stringify(expected)};`));
  assert.ok(!html.includes('GHDRAW_CLOUD_ENDPOINT_CONFIG'), 'build marker must be replaced');
  await stat(path.join(directory, 'backend', 'shared', 'board-element-contract.js'));
}

function runVercelBuild(outDir, {vercelEnv, productionEndpoint} = {}) {
  const env = {...process.env, VERCEL_ENV: vercelEnv};
  delete env[PRODUCTION_ENDPOINT_ENV];
  if (productionEndpoint !== undefined) env[PRODUCTION_ENDPOINT_ENV] = productionEndpoint;
  const [runtime, script] = VERCEL_CONFIG.buildCommand.split(' ');
  assert.equal(runtime, 'node');
  return spawnSync(process.execPath, [path.join(ROOT, script), '--out-dir', outDir], {cwd: ROOT, env, encoding: 'utf8'});
}

test('frontend test build and backend allowlist select isolated test and production tables', () => {
  const testTarget = FUNCTION_TARGETS[TEST_FUNCTION_ID];
  const productionTarget = FUNCTION_TARGETS[PRODUCTION_FUNCTION_ID];
  assert.equal(TEST_CLOUD_ENDPOINT, testTarget.frontendEndpoint);
  assert.deepEqual({databaseId: testTarget.databaseId, tableId: testTarget.tableId}, {databaseId: APPWRITE_DATABASE_ID, tableId: TEST_TABLE_ID});
  assert.deepEqual({databaseId: productionTarget.databaseId, tableId: productionTarget.tableId}, {databaseId: APPWRITE_DATABASE_ID, tableId: PRODUCTION_TABLE_ID});
  assert.notEqual(testTarget.tableId, productionTarget.tableId);
});

test('test build explicitly selects the provisioned test Function, independent of production env', async t => {
  const temp = await temporaryDirectory(t);
  const outputDir = path.join(temp, 'test-site');
  await buildSite({target: 'test', outDir: outputDir, env: {[PRODUCTION_ENDPOINT_ENV]: PRODUCTION_FIXTURE}, root: ROOT});
  await expectConfiguredEndpoint(outputDir, TEST_CLOUD_ENDPOINT);
  assert.notEqual(TEST_CLOUD_ENDPOINT, PRODUCTION_FIXTURE);
});

test('production build fails closed when its new Function URL is unset and writes no artifact', async t => {
  const temp = await temporaryDirectory(t);
  const outputDir = path.join(temp, 'must-not-exist');
  await assert.rejects(buildSite({target: 'production', outDir: outputDir, env: {}, root: ROOT}), /requires GHDRAW_CLOUD_PRODUCTION_ENDPOINT/);
  await assert.rejects(stat(outputDir), error => error.code === 'ENOENT');
});

test('production build rejects both the test endpoint and the retired production endpoint', async t => {
  const temp = await temporaryDirectory(t);
  for (const forbidden of [TEST_CLOUD_ENDPOINT, LEGACY_CLOUD_ENDPOINT]) {
    const outputDir = path.join(temp, forbidden === TEST_CLOUD_ENDPOINT ? 'test-as-prod' : 'legacy-as-prod');
    await assert.rejects(buildSite({target: 'production', outDir: outputDir, env: {[PRODUCTION_ENDPOINT_ENV]: forbidden}, root: ROOT}), /test and legacy production endpoints are forbidden/);
    await assert.rejects(stat(outputDir), error => error.code === 'ENOENT');
  }
});

test('production build selects only the explicitly supplied new Appwrite Function origin', async t => {
  const temp = await temporaryDirectory(t);
  const outputDir = path.join(temp, 'production-fixture');
  await buildSite({target: 'production', outDir: outputDir, env: {[PRODUCTION_ENDPOINT_ENV]: PRODUCTION_FIXTURE}, root: ROOT});
  await expectConfiguredEndpoint(outputDir, PRODUCTION_FIXTURE);
  assert.ok(!PRODUCTION_FIXTURE.includes('ghdraw-test-backend'));
  assert.ok(!PRODUCTION_FIXTURE.includes('ghdraw-expiring-links'));
});

test('production build rejects non-Appwrite, insecure, credentialed, or path-bearing URLs', async t => {
  const temp = await temporaryDirectory(t);
  for (const invalid of [
    'http://ghdraw-production.fra.appwrite.run',
    'https://user:pass@ghdraw-production.fra.appwrite.run',
    'https://ghdraw-production.fra.appwrite.run/path',
    'https://ghdraw-production.example.com',
    'https://ghdraw-production.fra.appwrite.run?route=/test',
  ]) {
    await assert.rejects(buildSite({target: 'production', outDir: path.join(temp, `invalid-${Buffer.from(invalid).toString('hex').slice(0, 12)}`), env: {[PRODUCTION_ENDPOINT_ENV]: invalid}, root: ROOT}), /must be an HTTPS Appwrite Function origin/);
  }
});

test('Vercel build config produces real preview/production artifacts and fails closed without the production endpoint', async t => {
  assert.equal(VERCEL_CONFIG.buildCommand, 'node scripts/build-vercel.mjs');
  assert.equal(VERCEL_CONFIG.outputDirectory, 'dist/vercel');
  const temp = await temporaryDirectory(t);

  const previewDir = path.join(temp, 'vercel-preview');
  const preview = runVercelBuild(previewDir, {vercelEnv: 'preview', productionEndpoint: PRODUCTION_FIXTURE});
  assert.equal(preview.status, 0, preview.stderr);
  await expectConfiguredEndpoint(previewDir, TEST_CLOUD_ENDPOINT);

  const missingProductionDir = path.join(temp, 'vercel-production-missing');
  const missingProduction = runVercelBuild(missingProductionDir, {vercelEnv: 'production'});
  assert.notEqual(missingProduction.status, 0);
  assert.match(missingProduction.stderr, /requires GHDRAW_CLOUD_PRODUCTION_ENDPOINT/);
  await assert.rejects(stat(missingProductionDir), error => error.code === 'ENOENT');

  const productionDir = path.join(temp, 'vercel-production-fixture');
  const production = runVercelBuild(productionDir, {vercelEnv: 'production', productionEndpoint: PRODUCTION_FIXTURE});
  assert.equal(production.status, 0, production.stderr);
  await expectConfiguredEndpoint(productionDir, PRODUCTION_FIXTURE);

  const unknownDir = path.join(temp, 'vercel-unknown-environment');
  const unknown = runVercelBuild(unknownDir, {vercelEnv: 'staging'});
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unsupported or missing VERCEL_ENV/);
  await assert.rejects(stat(unknownDir), error => error.code === 'ENOENT');
});
