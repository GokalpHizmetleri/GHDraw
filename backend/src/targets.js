export const APPWRITE_PROJECT_ID = '6ad06200002e031abe05';
export const APPWRITE_DATABASE_ID = 'ghdraw';
export const TEST_FUNCTION_ID = '6ad10a3c0022dd5e25e3';
export const PRODUCTION_FUNCTION_ID = 'ghdraw-production-backend';
export const TEST_TABLE_ID = 'boards-test';
export const PRODUCTION_TABLE_ID = 'boards';
export const TEST_CLOUD_ENDPOINT = 'https://ghdraw-test-backend.fra.appwrite.run';

export const FUNCTION_TARGETS = Object.freeze({
  [TEST_FUNCTION_ID]: Object.freeze({
    projectId: APPWRITE_PROJECT_ID,
    databaseId: APPWRITE_DATABASE_ID,
    tableId: TEST_TABLE_ID,
    frontendEndpoint: TEST_CLOUD_ENDPOINT,
  }),
  [PRODUCTION_FUNCTION_ID]: Object.freeze({
    projectId: APPWRITE_PROJECT_ID,
    databaseId: APPWRITE_DATABASE_ID,
    tableId: PRODUCTION_TABLE_ID,
    frontendEndpoint: null,
  }),
});

export function resolveFunctionTableTarget(env = process.env) {
  const functionId = env.APPWRITE_FUNCTION_ID;
  const target = Object.hasOwn(FUNCTION_TARGETS, functionId) ? FUNCTION_TARGETS[functionId] : null;
  if (!target
    || env.APPWRITE_FUNCTION_PROJECT_ID !== target.projectId
    || env.DATABASE_ID !== target.databaseId
    || env.TABLE_ID !== target.tableId) {
    throw Object.assign(new Error('Appwrite Function database target is not allowlisted or its DATABASE_ID/TABLE_ID configuration does not match.'), {code: 500});
  }
  return {databaseId: target.databaseId, tableId: target.tableId};
}
