import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPWRITE_DATABASE_ID,
  APPWRITE_PROJECT_ID,
  FUNCTION_TARGETS,
  PRODUCTION_FUNCTION_ID,
  PRODUCTION_TABLE_ID,
  resolveFunctionTableTarget,
  TEST_CLOUD_ENDPOINT,
  TEST_FUNCTION_ID,
  TEST_TABLE_ID,
} from './targets.js';

const testEnv = {
  APPWRITE_FUNCTION_ID: TEST_FUNCTION_ID,
  APPWRITE_FUNCTION_PROJECT_ID: APPWRITE_PROJECT_ID,
  DATABASE_ID: APPWRITE_DATABASE_ID,
  TABLE_ID: TEST_TABLE_ID,
};
const productionEnv = {
  APPWRITE_FUNCTION_ID: PRODUCTION_FUNCTION_ID,
  APPWRITE_FUNCTION_PROJECT_ID: APPWRITE_PROJECT_ID,
  DATABASE_ID: APPWRITE_DATABASE_ID,
  TABLE_ID: PRODUCTION_TABLE_ID,
};

test('exact test and production Function identities resolve to separate private table targets', () => {
  assert.deepEqual(resolveFunctionTableTarget(testEnv), {databaseId: APPWRITE_DATABASE_ID, tableId: TEST_TABLE_ID});
  assert.deepEqual(resolveFunctionTableTarget(productionEnv), {databaseId: APPWRITE_DATABASE_ID, tableId: PRODUCTION_TABLE_ID});
  assert.notEqual(TEST_TABLE_ID, PRODUCTION_TABLE_ID);
  assert.equal(FUNCTION_TARGETS[TEST_FUNCTION_ID].frontendEndpoint, TEST_CLOUD_ENDPOINT);
  assert.equal(Object.isFrozen(FUNCTION_TARGETS), true);
  assert.equal(Object.isFrozen(FUNCTION_TARGETS[TEST_FUNCTION_ID]), true);
  assert.equal(Object.isFrozen(FUNCTION_TARGETS[PRODUCTION_FUNCTION_ID]), true);
});

test('unknown Function, wrong project, or mismatched DB/table configuration fails closed', () => {
  const invalidConfigs = [
    {},
    {APPWRITE_FUNCTION_ID: '__proto__'},
    {APPWRITE_FUNCTION_ID: 'constructor'},
    {...testEnv, APPWRITE_FUNCTION_ID: 'unrecognized-function'},
    {...testEnv, APPWRITE_FUNCTION_PROJECT_ID: 'another-project'},
    {...testEnv, DATABASE_ID: 'another-database'},
    {...testEnv, TABLE_ID: PRODUCTION_TABLE_ID},
    {...productionEnv, TABLE_ID: TEST_TABLE_ID},
    {...productionEnv, APPWRITE_FUNCTION_ID: TEST_FUNCTION_ID},
  ];
  for (const env of invalidConfigs) {
    assert.throws(() => resolveFunctionTableTarget(env), error => error.code === 500);
  }
});
