import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSite, LEGACY_CLOUD_ENDPOINT, PRODUCTION_ENDPOINT_ENV, TEST_CLOUD_ENDPOINT} from '../../scripts/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PRODUCTION_FIXTURE = 'https://ghdraw-production-fixture.fra.appwrite.run';

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
