# BazaarBridge Phase 1 Integration Tests (Agent D)

## Overview
This document describes the Phase 1 integration tests owned by Agent D (Seed Data, QA, Testing and Documentation). Tests verify core capabilities required for Gate 1 approval.

## Test Files

| File | Description | Requirements |
|------|-------------|--------------|
| `backend/src/tests/concurrent-reservations.test.js` | Concurrent reservation race tests using the 1-unit offer | PG_URI |
| `backend/src/tests/duplicate-event-processing.test.js` | Idempotent event processing with `processed_events` guard | PG_URI |
| `backend/src/tests/stale-opensearch-updates.test.js` | External versioning (`external_gte`) prevents stale OpenSearch writes | PG_URI, OPENSEARCH_* |
| `backend/src/tests/database-reconciliation.test.js` | Referential integrity and state machine validation | PG_URI |

## Running Tests

```bash
# Set environment variables (process.env.PG_URI)
export PG_URI="<your-aiven-postgres-connection-uri>"
export OPENSEARCH_URL="<your-aiven-opensearch-uri>" # process.env
export OPENSEARCH_USERNAME="user" # process.env
export OPENSEARCH_PASSWORD="pass" # process.env

# Run all Phase 1 tests
node scripts/run-tests.js
```

## Test Results Classification

Per `agent-rules.md` and `AGENT_D_CONTEXT.md`:

- **PASS**: Test assertions hold against live Aiven PostgreSQL (and OpenSearch where applicable)
- **FAIL**: Test ran but assertions failed — indicates a bug in implementation
- **BLOCKED**: Required service unavailable (PG_URI not set, OpenSearch not reachable, Kafka consumers not running) — **NEVER reported as PASS**

## Gate 1 Verification Mapping

| Gate 1 Requirement | Covered By Test |
|--------------------|-----------------|
| Atomic stock reservation | `concurrent-reservations.test.js` |
| Duplicate event safety | `duplicate-event-processing.test.js` |
| Outbox → Kafka → consumer → OpenSearch pipeline | `stale-opensearch-updates.test.js` (partial) |
| Correct order/reservation mapping | `database-reconciliation.test.js` |

## Integration Assumptions

1. **Seed data must be applied first** — Tests assume the seed data from `backend/src/seed/` has been applied to the target database (specifically the 1-unit offer `70000000-0000-0000-0000-000000000006` at Bangalore Central Warehouse).

2. **Backend services not required** — Tests connect directly to PostgreSQL and OpenSearch. They do not require the Express API, Kafka consumers, or other backend services to be running.

3. **Kafka consumer tests are separate** — Event consumer integration tests (Pattern A/B) require running Kafka consumers and are not included in this Phase 1 suite.

4. **Tests are idempotent** — Each test resets relevant state (e.g., inventory quantities) at the start.

## Adding New Tests

1. Create `backend/src/tests/<name>.test.js` using `node:test` and `node:assert`
2. Follow the pattern: skip if `PG_URI` (or other required env) is not set
3. Use conditional `UPDATE` with `RETURNING` for stock movements (per `agent-rules.md` §16)
4. Add the file to `TEST_FILES` array in `scripts/run-tests.js`
4. Document in this file

## Current Status

- Seed data: ✅ Implemented (`backend/src/seed/`)
- Phase 1 tests: ✅ Created (4 test files)
- Test runner: ✅ Created (`scripts/run-tests.js`)
- Gate 1 verification: ⏳ Pending backend implementation by Agents B & C