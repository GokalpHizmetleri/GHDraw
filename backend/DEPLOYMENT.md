# GHDraw backend deployment preflight

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
- The live chat response retains only the latest 100 messages, independently of the receipt ledger. Do not prune a receipt to make room: it is needed to deduplicate a delayed retry. Expired chat receipts and the shared quota row are reclaimed by the existing indexed, paginated cleanup (`CLEANUP_ROW_BUDGET` bounds rows per run; the scheduler continues on later runs). The 9,400 total ceiling also preserves the existing worst-case owner-delete policy of at most 94 bulk deletes of 100 operation-receipt rows, plus fixed rows, within the staged-operation budget.

## Scope and verification

- This checklist is a deployment prerequisite, not proof that a live Appwrite index currently exists.
- Verify the selected project/database/table in the Console each time; do not infer index state from source code, an old schema note, or a different environment.
- Do not create a second Function for cleanup. Use the existing GHDraw Function and keep its timeout below the backend lock lease as documented in the project README.
- Keep database and row permissions private. Do not use real user board data for cleanup smoke tests.
- When packaging the Function from `backend/`, include `shared/package.json` and `shared/board-element-contract.js`; `src/main.js` imports this nested CommonJS module, and the browser loads the same versioned contract from `/backend/shared/board-element-contract.js`.
