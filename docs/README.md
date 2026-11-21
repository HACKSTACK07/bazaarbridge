# BazaarBridge Documentation (docs/README.md)

**Phase 1 Authoritative Project Guide (Version 7.2 Frozen)**  
Maintained by **Agent D (Seed Data, QA & Documentation)**

---

## 1. Project Overview & Quick Start

BazaarBridge connects local Bangalore and regional Karnataka dealers with online customers, featuring real-time price comparison across 5 distinct categories, atomic stock reservation, multi-hub quick delivery, and idempotent stock accounting.

### Prerequisites
- Node.js >= 20
- PostgreSQL 15+ (Aiven PostgreSQL recommended)
- Aiven Kafka (2 topics x 2 partitions)
- Aiven OpenSearch (offers index)

### Setup & Installation
```bash
# 1. Clone repository
git clone https://github.com/HACKSTACK07/bazaarbridge.git
cd bazaarbridge

# 2. Configure environment variables
cp .env.example .env
# Edit .env with your PostgreSQL, Kafka, and OpenSearch connection details

# 3. Apply locked database schema (Agent B)
psql $PG_URI -f schema.sql

# 4. Apply database seed data (Agent D)
node backend/src/seed/seed.js
# or via psql:
psql $PG_URI -f backend/src/seed/seed.sql

# 5. Run Stage 0 secrets scan
bash scripts/check-secrets.sh

# 6. Run Phase 1 integration test suite
node scripts/run-tests.js
```

---

## 2. Seeded Demo Credentials

| Role | Email | Password | Details |
| :--- | :--- | :--- | :--- |
| **Customer** | `demo@bazaarbridge.dev` | `Demo@1234` | Prefilled in demo UI. Has pre-created cart and address. |
| **Administrator** | `admin@bazaarbridge.dev` | `Admin@1234` | Configured via `SEED_ADMIN_PASSWORD`. Required for `/api/simulator/*` and admin APIs. |
| **Express Rider** | `rider@bazaarbridge.dev` | `Rider@1234` | Express delivery courier for quick fulfillment tests. |

*All password hashes are generated using standard bcrypt with cost factor 10.*

---

## 3. Feature Flags Table

All feature flags are controlled via `FEATURE_FLAGS` comma-separated list in `.env`.

| Feature Flag | Default Status | Category | Scope & Behavior |
| :--- | :--- | :--- | :--- |
| `FEATURE_COUPONS` | Enabled | Commerce | Cart & checkout coupon redemption (`SINGLE10`, `PERCUST1`, `SAVE10`) |
| `FEATURE_WISHLIST` | Enabled | Engagement | User wishlist save and toggle |
| `FEATURE_ALERTS` | Enabled | Engagement | Price drop and back-in-stock alert subscriptions |
| `FEATURE_ADDRESSES` | Enabled | Checkout | Customer multiple delivery address management |
| `FEATURE_SAVE_LATER` | Enabled | Cart | Save-for-later and restore cart item holds |
| `FEATURE_COMPARE` | Enabled | Discovery | Side-by-side product attribute comparison matrix |
| `FEATURE_ASSISTANT` | Optional | AI Logic | Gemini-powered conversational shopping assistant |
| `FEATURE_REVIEWS` | Optional | Engagement | Customer product reviews and ratings |
| `FEATURE_SUPPORT` | Optional | Support | Customer support ticket submission and FAQ |
| `FEATURE_SIM_SCREENS` | Phase 2 | Operations | Simulated operational consoles (Picker, Dispatch, Refund tracker) |

---

## 4. Built vs Simulated Capabilities Matrix

| Capability | Status | Implementation Truth | Notes |
| :--- | :--- | :--- | :--- |
| **Typo-Tolerant Search** | BUILT | Real OpenSearch fuzzy query | OpenSearch hits candidate offers; PostgreSQL rechecks price and stock |
| **5 Comparison Categories** | BUILT | Real PostgreSQL queries | Budget, Fastest, Best Rated, Best Value, Most Available |
| **Stock Reservation** | BUILT | Real PostgreSQL atomic UPDATE | Conditional hold; `rowCount === 1` checked |
| **Order Placement** | BUILT | Real PostgreSQL transaction | Atomically converts reservations to confirmed orders |
| **Outbox → Kafka Pipeline** | BUILT | Real Aiven Kafka events | Outbox table polled, events published with aggregate keys |
| **Consumer Idempotency** | BUILT | Real PostgreSQL marker | `processed_events (event_id, consumer_name)` gate |
| **Monotonic Revision Guard** | BUILT | Real OpenSearch `external_gte` | Prevents stale async event indexing from overwriting fresh state |
| **Payment Gateway** | SIMULATED | `payments` table status | Simulated sandbox UPI payment confirmation |
| **Bank Refund Transfer** | SIMULATED | Refund-stub worker | Simulated credit delay; database caps & money allocation are REAL |
| **Courier Rider Dispatch** | SIMULATED | Simulator fire-event API | Triggers real event pipeline with cryptographic OTP proof |
| **Picker Dashboard** | SIMULATED | Phase 2 UI screen | Labelled with standard `SIMULATED / SAMPLE DATA` badge |

---

## 5. Not-Attempted / Excluded Features

To maintain strict delivery within hackathon limits, the following are intentionally **not attempted**:
1. **Live Payment Gateway Aggregator (Razorpay / Stripe live API)**: Replaced with deterministic sandbox UPI payment model.
2. **Third-party Courier Tracking Webhooks (Shiprocket / Dunzo live API)**: Replaced with deterministic local event simulator.
3. **SMS Gateway / Push Notifications (Twilio / Firebase Cloud Messaging)**: Notifications are persisted directly to the `notifications` table by the `notifier` Kafka consumer.
4. **Dynamic Map Routing & Live GPS Coordinate Stream**: Hub ETA calculations use verified deterministic formulas based on live PostgreSQL picking queues and delivery windows (`eta_window_start`/`end`).

