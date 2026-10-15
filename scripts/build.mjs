import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const TEST_CLOUD_ENDPOINT = 'https://ghdraw-test-backend.fra.appwrite.run';
export const LEGACY_CLOUD_ENDPOINT = 'https://ghdraw-expiring-links.fra.appwrite.run';
export const PRODUCTION_ENDPOINT_ENV = 'GHDRAW_CLOUD_PRODUCTION_ENDPOINT';
const CONFIG_MARKER = '<!-- GHDRAW_CLOUD_ENDPOINT_CONFIG -->';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_FILES = ['logo.svg', 'manifest.webmanifest', 'sw.js'];

export function resolveCloudEndpoint(target, env = process.env) {
  if (target === 'test') return TEST_CLOUD_ENDPOINT;
  if (target !== 'production') {
    throw new Error(`Unknown build target "${target}"; use "test" or "production".`);
  }

  const supplied = env[PRODUCTION_ENDPOINT_ENV];
  if (typeof supplied !== 'string' || !supplied.trim()) {
    throw new Error(`Production build requires ${PRODUCTION_ENDPOINT_ENV} to be set to the new Appwrite Function URL.`);
  }
  if (supplied !== supplied.trim()) {
    throw new Error(`${PRODUCTION_ENDPOINT_ENV} must not contain leading or trailing whitespace.`);
  }

  let url;
  try {
    url = new URL(supplied);
  } catch {
    throw new Error(`${PRODUCTION_ENDPOINT_ENV} must be a valid HTTPS Appwrite Function URL.`);
  }

  const functionHost = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.appwrite\.run$/i;
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' || !functionHost.test(url.hostname)) {
    throw new Error(`${PRODUCTION_ENDPOINT_ENV} must be an HTTPS Appwrite Function origin (https://<function>.<region>.appwrite.run), without path, query, or credentials.`);
  }

  const endpoint = url.origin;
  if ([TEST_CLOUD_ENDPOINT, LEGACY_CLOUD_ENDPOINT].includes(endpoint.toLowerCase())) {
    throw new Error('Production endpoint must be the separately provisioned new production Function URL; test and legacy production endpoints are forbidden.');
  }
  return endpoint;
}

export async function buildSite({target, outDir, env = process.env, root = ROOT}) {
  const endpoint = resolveCloudEndpoint(target, env);
  const outputDir = path.resolve(outDir ?? path.join(root, 'dist', target));
  const source = await readFile(path.join(root, 'index.html'), 'utf8');
  if (source.split(CONFIG_MARKER).length !== 2) {
    throw new Error(`Expected exactly one ${CONFIG_MARKER} marker in index.html.`);
  }
  const configured = source.replace(CONFIG_MARKER,
    `<script id="ghdraw-cloud-config">window.GHDRAW_CLOUD_ENDPOINT=${JSON.stringify(endpoint)};</script>`);

  await mkdir(outputDir, {recursive: true});
  await writeFile(path.join(outputDir, 'index.html'), configured);
  for (const relative of STATIC_FILES) {
    await copyFile(path.join(root, relative), path.join(outputDir, relative));
  }
  const sharedOutput = path.join(outputDir, 'backend', 'shared');
  await mkdir(sharedOutput, {recursive: true});
  await copyFile(path.join(root, 'backend', 'shared', 'board-element-contract.js'), path.join(sharedOutput, 'board-element-contract.js'));
  return {target, endpoint, outputDir};
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target' || arg === '--out-dir') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value.`);
      options[arg === '--target' ? 'target' : 'outDir'] = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.target) throw new Error('Explicit --target test|production is required.');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildSite(parseArgs(process.argv.slice(2)));
    console.log(`Built ${result.target} frontend at ${result.outputDir}`);
    console.log(`Cloud endpoint: ${result.endpoint}`);
  } catch (error) {
    console.error(`Build failed closed: ${error.message}`);
    process.exitCode = 1;
  }
}
