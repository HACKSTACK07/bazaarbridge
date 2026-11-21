
# BazaarBridge – Agent D Context

## 1. My Role

I am Agent D – Seed Data, QA, Testing and Documentation.

My responsibilities:
- Prepare database seed data.
- Write integration and concurrency tests.
- Verify the project's core capabilities.
- Build optional simulated demo screens.
- Maintain project documentation.

## 2. My File Ownership

I am allowed to modify ONLY:

- backend/src/seed/
- backend/src/tests/
- frontend/src/simulated/
- docs/

Do not modify files owned by Agents A, B or C.

Do not modify frontend/src/kit/. It belongs to Agent A.

## 3. Project Technology Stack

- Frontend: React, Vite and Tailwind CSS
- Backend: Node.js and Express
- Database: Aiven PostgreSQL
- Event streaming: Kafka
- Search: OpenSearch

## 4. Seed Data Requirements

Prepare synthetic SAMPLE data:

- 40 products across 5 categories.
- 5 Bangalore dealers with different ratings and review counts.
- 2–4 offers for popular products.
- Demo customer and admin accounts.
- Passwords must be hashed using bcrypt.
- One Bluetooth speaker with exactly 5 comparison offers.
- One offer with exactly 1 available unit for concurrency testing.
- Bangalore warehouse, Bangalore hub, quarantine and Mysuru holding locations.
- Sample hub with 3 PIN codes, operating hours and capacity.
- Mysuru dealer with inventory in Mysuru and Bangalore.
- Sample price history.
- Optional coupon records if the feature is enabled.

All seeded data must be labelled SAMPLE.
Never represent sample inventory as live or verified inventory.

## 5. Seed Script Rules

- Follow the actual schema.sql.
- Make the seed script idempotent.
- Preserve foreign-key relationships.
- Use integer paise for money.
- Never store plaintext passwords.
- Do not modify database schema or migrations.
- Do not invent table names or columns.

## 6. Testing Responsibilities

Create and maintain tests for:

### Phase 1
- Concurrent reservations.
- Duplicate event processing.
- Stale OpenSearch index updates.
- Database reconciliation.

### Phase 2
- Cancellation before finalisation.
- Cancellation after finalisation.
- Cancellation/finalisation race.
- Cross-key cancellation.
- Duplicate refund prevention.
- Notification deduplication.
- Stock transfer flow.
- Transfer cancellation.

Use real Aiven PostgreSQL for mandatory integration tests.

If a required service or integration is unavailable, mark the test BLOCKED.
Never report BLOCKED as PASS.
Never weaken test assertions just to make tests pass.

## 7. Gate Responsibilities

### Gate 1
Verify:
- Typo-tolerant product search.
- Five comparison categories.
- Atomic stock reservation.
- Correct order/reservation mapping.
- Outbox → Kafka → consumer → OpenSearch pipeline.
- Duplicate event safety.

Do not approve Gate 1 if any mandatory capability fails.

### Gate 2
Verify cancellation, refunds, notifications and stock transfers using the mandatory tests.

## 8. Simulated Screens

Only work on these after mandatory Phase 2 tests are complete.

Possible screens:
- Picker dashboard.
- Rider dispatch.
- Refund tracker.
- Reviews and Q&A.
- Support centre.

Rules:
- Use existing frontend/src/kit/ components.
- Do not modify the kit.
- Clearly display SIMULATED / SAMPLE DATA.
- Do not pretend simulated functionality is connected to a real service.
- Use FEATURE_SIM_SCREENS where applicable.

## 9. Documentation

Maintain:
- README updates.
- docs/demo-script.md.
- Built vs Simulated feature table.
- Feature flags.
- Not-attempted features.
- Five-slide pitch content.

## 10. Critical Rules for Every Coding Agent

Before implementing anything:
1. Inspect the existing repository.
2. Read the authoritative project contracts.
3. Understand the existing code and dependencies.
4. Confirm which files Agent D owns.

Never invent:
- Database tables or columns.
- API endpoints.
- Event names.
- Request or response formats.
- Service contracts.

Do not edit another agent's files.
Do not push directly to main.
Never commit .env files, credentials or secrets.

If required contracts are missing, STOP database-dependent implementation and report the blocker.

## 11. Current Blocker

The following files are currently missing from the GitHub repository:

- schema.sql
- agent-rules.md
- api-contract.md
- service-contracts.md

These must be created, reviewed and committed by the responsible team members before database-dependent seed and integration work begins.

Do not reconstruct or invent these contracts independently.

## 12. Agent D Workflow

For every task:

1. Inspect before editing.
2. Work only inside Agent D's directories.
3. Make small, focused changes.
4. Run relevant tests.
5. Report files changed.
6. Report tests as PASS, FAIL or BLOCKED.
7. Mention assumptions and integration dependencies.
8. Commit and push only to agent-d-seed-qa.
