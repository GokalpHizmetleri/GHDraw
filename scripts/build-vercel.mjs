import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {buildSite} from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_BY_VERCEL_ENV = {
  production: 'production',
  preview: 'test',
  development: 'test',
};

function parseArgs(argv) {
  if (argv.length === 0) return {outDir: path.join(ROOT, 'dist', 'vercel')};
  if (argv.length === 2 && argv[0] === '--out-dir' && argv[1]) {
    return {outDir: path.resolve(argv[1])};
  }
  throw new Error('Usage: node scripts/build-vercel.mjs [--out-dir <path>]');
}

try {
  const environment = process.env.VERCEL_ENV;
  const target = TARGET_BY_VERCEL_ENV[environment];
  if (!target) {
    throw new Error(`Unsupported or missing VERCEL_ENV "${environment ?? ''}"; expected production, preview, or development.`);
  }
  const result = await buildSite({target, ...parseArgs(process.argv.slice(2))});
  console.log(`Vercel ${environment} build selected ${target} endpoint: ${result.endpoint}`);
  console.log(`Output: ${result.outputDir}`);
} catch (error) {
  console.error(`Vercel build failed closed: ${error.message}`);
  process.exitCode = 1;
}
