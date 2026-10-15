# GHDraw backend deployment preflight

## Frontend endpoint build targets

- The source `index.html` contains no default cloud endpoint. An unbuilt/source page remains offline-only; cloud and AI requests fail closed when no endpoint is configured.
- Build the test frontend explicitly with `node scripts/build.mjs --target test`. This target always selects `https://ghdraw-test-backend.fra.appwrite.run`, regardless of any production environment variable.
- Build production only with the actual, newly provisioned production Function URL: `GHDRAW_CLOUD_PRODUCTION_ENDPOINT=https://<function>.<region>.appwrite.run node scripts/build.mjs --target production`.
- Production builds fail before writing output when the variable is absent, malformed, equal to the test endpoint, or equal to the retired production endpoint. Do not put a guessed or placeholder URL into a deployable artifact.
- The build validates URL shape and rejects known wrong targets; that is **not** proof the Function exists, is active, has the expected runtime, or passes CORS, permission, index, or cleanup checks. Confirm the exact new Function URL and live preflight before routing or deploying production. No production Function URL is currently recorded for this rollout.
- The Chromium E2E suite builds the test target and installs its mock against the endpoint embedded in that build. It does not contact Appwrite; endpoint selection tests are in `backend/src/endpoint-config.test.js`.

Run this checklist against the **exact Appwrite project, database, and table** that the Function will use. Do not enable or schedule expiry cleanup until every check passes.

## Required `expiresAt` index before enabling cleanup

1. In the Appwrite Console, select the target project, then TablesDB database `ghdraw` and table `boards`.
2. Verify that `expiresAt` exists as a scalar **DateTime** column. The cleanup query projects only `$id` and `expiresAt`; board payloads are not selected.
3. In that same table, verify an index whose exact key list is `expiresAt` in **ascending** order. Confirm its status is **available/ready**, not building, failed, or absent. A DateTime column alone does not satisfy this preflight.
4. If the required index is missing or not ready, create/wait for that exact ascending key index in the target table, then repeat the verification. Do not configure the scheduled cleanup until it is ready.
5. Only after this preflight and a successful Function health check may the single GHDraw Function's expiry-cleanup schedule be enabled.

The cleanup uses a bounded `expiresAt <= cutoff` query ordered ascending. If that query fails (including because the index is missing or unavailable), the invocation returns **503**, not a success-shaped `{deleted: 0}` response. It does not delete rows before the first expiry query succeeds. Fix the schema/index in the target project and retry; do not treat a failed invocation as completed cleanup.

## Shared per-room receipt budget and chat retention

- Each room has one private, transactionally updated **9,400-total receipt budget** shared by board operations, history restores, and chat sends. This is a combined ceiling, not 9,400 for each feature. The same quota row is read and updated in the room/chat transaction, so concurrent sends and board edits cannot both consume the last slot.
- A new chat send at the cap is rejected with no room, live-presence, quota, or receipt mutation. A retry whose private `(roomId, clientMessageId)` receipt already exists is looked up before the cap check and returns its prior ACK; reusing that ID with different text is a conflict. Receipt rows store a payload hash, are private, and expire no earlier than the room.
- The private quota row indexes operation/history receipt IDs (`o…`) and durable chat receipt IDs (`j…`); `chatCount` includes every send, while `chatReceiptIds` lists every chat send that created a durable deduplication receipt. Do not remove an ID or alter the counts to make a deletion pass.
- The live chat response retains only the latest 100 messages, independently of the receipt ledger. Do not prune a receipt to make room: it is needed to deduplicate a delayed retry. Expired chat receipts and the shared quota row are reclaimed by the existing indexed, paginated cleanup (`CLEANUP_ROW_BUDGET` bounds rows per run; the scheduler continues on later runs). The 9,400 total ceiling also preserves the worst-case owner-delete policy of at most 94 bulk deletes of 100 combined `o…`/`j…` receipt rows, plus up to five fixed rows, within the 100-operation transaction budget.

## Legacy or migrated room ledger preflight

- This rollout targets a **new, blank `boards` table** and does not migrate old room data. Before routing production clients to this Function, verify the table contains no room rows. If any rows exist, keep routing disabled until every room has been inventoried and its private `q<first-31-room-id-chars>` row has been backfilled and independently verified.
- A valid ledger must identify the same room, contain unique correctly prefixed operation IDs in `receiptIds` and durable chat IDs in `chatReceiptIds`, have safe integer counts within 0–9,400, satisfy `count = receiptIds.length + chatCount`, and satisfy `chatReceiptIds.length <= chatCount`. Backfill must include every extant room-associated operation and chat receipt; never guess missing IDs or infer a complete ledger from the room payload alone.
- The backend rejects missing/incomplete ledgers for room writes, chat sends, and owner deletion. Keep that fail-closed behavior; do not enable a legacy room by bypassing the guard. If the table cannot be proven blank or every ledger cannot be verified, stop the rollout rather than serving the affected room.

## Scope and verification

- This checklist is a deployment prerequisite, not proof that a live Appwrite index currently exists.
- Verify the selected project/database/table in the Console each time; do not infer index state from source code, an old schema note, or a different environment.
- Do not create a second Function for cleanup. Use the existing GHDraw Function and keep its timeout below the backend lock lease as documented in the project README.
- Keep database and row permissions private. Do not use real user board data for cleanup smoke tests.
- When packaging the Function from `backend/`, include `shared/package.json` and `shared/board-element-contract.js`; `src/main.js` imports this nested CommonJS module, and the browser loads the same versioned contract from `/backend/shared/board-element-contract.js`.
