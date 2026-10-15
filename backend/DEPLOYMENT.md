# GHDraw backend deployment preflight

## Frontend endpoint build targets

- The source `index.html` contains no default cloud endpoint. An unbuilt/source page remains offline-only; cloud and AI requests fail closed when no endpoint is configured.
- Build the test frontend explicitly with `node scripts/build.mjs --target test`. The endpoint comes from `backend/src/targets.js` and selects the isolated test Function, regardless of any production environment variable.
- Build production only with the actual, newly provisioned production Function URL: `GHDRAW_CLOUD_PRODUCTION_ENDPOINT=https://<function>.<region>.appwrite.run node scripts/build.mjs --target production`.
- Vercel uses the root `vercel.json` build command (`node scripts/build-vercel.mjs`) and publishes only `dist/vercel/`. The wrapper maps `VERCEL_ENV=production` to the production target and `preview`/`development` to the test target; absent or unknown `VERCEL_ENV` fails closed.
- Set `GHDRAW_CLOUD_PRODUCTION_ENDPOINT` in Vercel's Production environment only, after the new Function URL exists. Preview builds ignore it and use the test Function. The source root is not a deployable cloud artifact.
- Production builds fail before writing output when the variable is absent, malformed, equal to the test endpoint, or equal to the retired production endpoint. Do not put a guessed or placeholder URL into a deployable artifact.
- The build validates URL shape and rejects known wrong targets; that is **not** proof the Function exists, is active, has the expected runtime, or passes CORS, permission, index, or cleanup checks. Confirm the exact new Function URL and live preflight before routing or deploying production. No production Function URL is currently recorded for this rollout.
- The Chromium E2E suite builds the test target and installs its mock against the endpoint embedded in that build. It does not contact Appwrite; endpoint selection tests are in `backend/src/endpoint-config.test.js`.

## Runtime Function/table allowlist

- `backend/src/targets.js` is the single source of truth for Function IDs, database/table targets, and the frontend test endpoint.
- The test Function ID `6ad10a3c0022dd5e25e3` must be configured with `DATABASE_ID=ghdraw` and `TABLE_ID=boards-test`. Its frontend endpoint is `https://ghdraw-test-backend.fra.appwrite.run`.
- The production Function must use the exact ID `ghdraw-production-backend` and `DATABASE_ID=ghdraw`, `TABLE_ID=boards`. Do not create or enable it until code review and test gates pass.
- Before any database operation, the backend checks Appwrite's `APPWRITE_FUNCTION_ID` and `APPWRITE_FUNCTION_PROJECT_ID` against the allowlist and requires the configured `DATABASE_ID`/`TABLE_ID` to match. Every TablesDB row operation is then bound to that target; a mismatch fails closed before the database client is constructed. Request data cannot choose a target.
- Table permissions stay empty; public access, when enabled for anonymous GHDraw routes, belongs only to the Function's execute permission.

Run the checklist below against the **exact Appwrite project, database, and table** for each Function. Do not enable or schedule expiry cleanup until every check passes.

## Required `expiresAt` index before enabling cleanup

1. In the Appwrite Console, select project `6ad06200002e031abe05`, TablesDB database `ghdraw`, and the exact target table: `boards-test` for the test Function or `boards` for production.
2. Verify `payload` is required Longtext and `expiresAt` is an optional scalar **DateTime** column. The cleanup query projects only `$id` and `expiresAt`; board payloads are not selected.
3. In that same table, verify the exact `expiresAt_asc` **Key** index on `expiresAt` in ascending order. Confirm its status is **Available/ready**, not building, failed, or absent. A DateTime column alone does not satisfy this preflight.
4. If the required index is missing or not ready, create/wait for that exact ascending key index in that target table, then repeat the verification. Do not configure scheduled cleanup until it is ready.
5. Only after this preflight and a successful Function health check may that Function's expiry-cleanup schedule be enabled.

The cleanup uses a bounded `expiresAt <= cutoff` query ordered ascending. If that query fails (including because the index is missing or unavailable), the invocation returns **503**, not a success-shaped `{deleted: 0}` response. It does not delete rows before the first expiry query succeeds. Fix the schema/index in the target project and retry; do not treat a failed invocation as completed cleanup.

## Shared per-room receipt budget and chat retention

- Each room has one private, transactionally updated **9,400-total receipt budget** shared by board operations, history restores, and chat sends. This is a combined ceiling, not 9,400 for each feature. The same quota row is read and updated in the room/chat transaction, so concurrent sends and board edits cannot both consume the last slot.
- A new chat send at the cap is rejected with no room, live-presence, quota, or receipt mutation. A retry whose private `(roomId, clientMessageId)` receipt already exists is looked up before the cap check and returns its prior ACK; reusing that ID with different text is a conflict. Receipt rows store a payload hash, are private, and expire no earlier than the room.
- The private quota row indexes operation/history receipt IDs (`o…`) and durable chat receipt IDs (`j…`); `chatCount` includes every send, while `chatReceiptIds` lists every chat send that created a durable deduplication receipt. Do not remove an ID or alter the counts to make a deletion pass.
- The live chat response retains only the latest 100 messages, independently of the receipt ledger. Do not prune a receipt to make room: it is needed to deduplicate a delayed retry. Expired chat receipts and the shared quota row are reclaimed by the existing indexed, paginated cleanup (`CLEANUP_ROW_BUDGET` bounds rows per run; the scheduler continues on later runs). The 9,400 total ceiling also preserves the worst-case owner-delete policy of at most 94 bulk deletes of 100 combined `o…`/`j…` receipt rows, plus up to five fixed rows, within the 100-operation transaction budget.

## No legacy data migration

- This rollout targets a new, blank production `boards` table and a separate `boards-test` table. Do not access the old Appwrite project, migrate room data, backfill ledgers, or modify unexpected rows.
- If either table contains any unexpected row before smoke testing, stop and keep routing disabled; do not delete, backfill, migrate, or otherwise alter it. Recheck the exact project/database/table identity and resolve the discrepancy before proceeding.
- The only pre-routing production data permitted is one explicitly disposable, already-expired cleanup fixture on the new `boards` table, created solely to verify the scheduled production cleanup. Confirm that an actual Schedule execution of the exact production deployment deletes it and that `boards` is empty again before routing. Never use real user data.
- The backend intentionally rejects legacy room rows without a complete receipt ledger. Do not bypass that guard; this rollout does not provide a migration path.

## Scope and verification

- This checklist is a deployment prerequisite, not proof that a live Appwrite index currently exists.
- Verify the selected project/database/table in the Console each time; do not infer index state from source code, an old schema note, or the other environment's table.
- Do not create a second Function for cleanup. Use the existing GHDraw Function and keep its timeout below the backend lock lease as documented in the project README.
- Keep database and row permissions private. Do not use real user board data for cleanup smoke tests. Functional smoke-test rows belong only in `boards-test`; the one production cleanup fixture must be expired, deleted by the scheduled run, and absent before routing.
- When packaging the Function from `backend/`, include `shared/package.json` and `shared/board-element-contract.js`; `src/main.js` imports this nested CommonJS module, and the browser loads the same versioned contract from `/backend/shared/board-element-contract.js`.
