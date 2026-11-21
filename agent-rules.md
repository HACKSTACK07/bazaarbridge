# BazaarBridge Agent Rules

Authoritative contract file for the BazaarBridge project (24-hour hackathon, four collaborators on one GitHub repo).
All four parallel agents MUST obey these rules. Do NOT write application logic or deviate from these specifications.

---

## 1. Stack and Basics

- **Stack**: React/Vite + Tailwind, Node/Express, Aiven PostgreSQL, Aiven Kafka, Aiven OpenSearch. No other datastore, queue, cache, or search engine.
- **Money**: `bigint` paise everywhere; JSON carries integer paise. No floats.
- **Secrets**: Environment variables only. Never commit `.env`, `*.key`, `*.cert`, `*.crt`, `*.pem`.
- **OTP handling (v7.1)**: Raw codes exist ONLY in the admin request body and two display endpoints. Events carry `otp_proof = HMAC(secret, 'hash:' + code)` only. Never log, index, or publish a raw code.
- **Git**: Commit only to your own assigned branch (`agent-a-frontend`, `agent-b-backend`, `agent-c-events`, `agent-d-seed-qa`). Never push to `main`.
- **Routes**: ALL Express routes live in `backend/src/api/` (Agent B). Agent C exports services and consumers only. Agent B's `/api/search` route calls Agent C's `searchService`.
- **Concurrency**: Every stock/coupon/usage/transfer change is ONE conditional statement whose ROW COUNT IS CHECKED. Never read-then-write. A stock movement attached to a transition that matched 0 rows is a bug.
- **Lock order (v7.2)**: Any statement or transaction touching several stock rows processes them `ORDER BY offer_id, location_id`. A Postgres deadlock (`40P01`) is RETRYABLE: roll back and retry up to 3 times with jitter; in a consumer, throw so Kafka redelivers. Never swallow it, never mark progress.

---

## 2. Kafka Architecture & Event Ordering

Confirm free-tier topic and partition limits in the console at pre-flight (design uses 2 topics x 2 partitions):
- **Topics**:
  - `bazaar.core.events` (2 partitions)
  - `bazaar.fulfilment.events` (2 partitions)
- **Message Keys (Partition Keys)**:
  - `inventory-updated` -> `offer_id`
  - `offer-price-updated` -> `offer_id`
  - `order-item-cancelled` -> `offer_id`
  - `order-placed` -> `order_id`
  - `refund-credit-requested` -> `order_item_id`
  - `fulfilment-status-updated` -> `group_id`
  - `stock-transfer-status-updated` -> `group_id`
  - `eta-updated` -> `group_id`
  - `notification-created` -> `user_id`

Same key -> same partition -> per-key order. Consume with `eachMessage`.
Keying alone is NOT sufficient (due to retries, rebalances, and replays): the **revision guard** is mandatory.

---

## 3. Reservation State Machine

```
reserved  -> confirmed : order placement
reserved  -> expired   : expiry cleanup (ONLY status = 'reserved')
reserved  -> released  : POST /api/cart/release, cart-item delete, or re-reserve after PRICE_CHANGED
confirmed -> released  : ONLY cancellation while stock_finalised = false
confirmed is TERMINAL once stock_finalised = true.
```

- Cleanup never touches `confirmed` rows.
- A confirmed reservation can NEVER be released by `/api/cart/release` -> `409 CANNOT_RELEASE_CONFIRMED` (use cancel).

---

## 4. Stock Movement Helpers (Use these, do not hand-roll)

- **`hold_units` / `release_hold`**: Conditional `UPDATE` on an EXISTING row; `rowCount` must be 1 else `RAISE`.
- **`deduct_units`**: Conditional `UPDATE`; `rowCount` must be 1 else `RAISE` and roll back the whole transaction.
- **`restock_units(offer, loc, q)`**: ONE UPSERT, because the destination row may not exist yet (e.g., a Section B offer that was never stocked in Bangalore):
  ```sql
  INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
  VALUES ($offer, $loc, $q, 0)
  ON CONFLICT (offer_id, location_id)
  DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity
  RETURNING quantity;
  ```
  The upsert is unconditional by itself, so it MUST be called only after a conditional transition matched exactly one row, in the same transaction.

---

## 5. Transfer State Machine (`stock_transfers.status`)

```
requested        -> in_transit          : simulator: Mark In Transit
in_transit       -> received_checked    : simulator: Mark Received and QC'd
received_checked -> allocated           : simulator: Allocate to Order
requested        -> cancelled_at_origin : cancel wins before dispatch
in_transit       -> restocked_bangalore : receipt with cancel_on_receipt
received_checked -> restocked_bangalore : cancel wins after QC
allocated        -> restocked_bangalore : cancel wins after allocation
```

- `cancelled_at_origin` and `restocked_bangalore` are TERMINAL.
- `received_checked` and `allocated` are SEPARATE steps. Never collapse them.

---

## 6. Stock Accounting for a Section B (Transfer) Order

1. `reserve_offer` holds units at the HOLDING location.
2. `finalizer`: `deduct_units` at origin (`quantity` AND `reserved_quantity`), and creates the `stock_transfers` row (`'requested'`, WITH `offer_id`) in the SAME transaction.
3. `in_transit` / `received_checked`: Units are in flight or in receiving. They are in NO location's quantity. No stock movement.
4. `allocated`: `order_items.stock_location_id = Bangalore`. NO quantity change. The units belong to this order and are NEVER free Bangalore stock.
5. `cancel` settles the units EXACTLY ONCE into a terminal transfer status:
   - `cancelled_at_origin` -> `restock_units` at ORIGIN
   - `restocked_bangalore` -> `restock_units` at BANGALORE (upsert; row may be new)

---

## 7. Cancel / Finalise / Transfer Serialisation

Cancel and finalizer gate on a conditional `UPDATE` of the SAME `order_items` row. Cancel and the transfer pipeline gate on conditional `UPDATE`s of the SAME `stock_transfers` row. Every branch uses `RETURNING` and moves stock ONLY if it matched. 0 rows -> fall through to the next branch. The branch set covers every non-terminal status, so exactly one matches or the row is already terminal (the other path settled it) -> no movement.

---

## 8. Consumer Execution Patterns

### Consumer Pattern A (PostgreSQL-only consumers)
ONE transaction:
```sql
INSERT INTO processed_events (event_id, consumer_name) VALUES ($1, $2)
ON CONFLICT DO NOTHING RETURNING event_id;
```
- 0 rows -> commit, ack, skip.
- Otherwise do the business change AND any outbox inserts in the SAME transaction; commit; then ack.
- Any guarded stock `UPDATE` that matches 0 rows when it MUST match raises and rolls back the marker too. Never mark progress on a no-op stock movement.

### Consumer Pattern B (Consumers that write to OpenSearch)
PostgreSQL and OpenSearch CANNOT share a transaction.
1. Check `processed_events`; if marked -> ack, skip.
2. Read truth AND revision in ONE statement (see Truth Statement below).
3. Upsert document `id = offer_id` with `version_type=external_gte&version=rev`.
   - `409 version_conflict` = a NEWER revision is indexed = SUCCESS.
4. ONLY after the write succeeds (or is stale-success): execute one PostgreSQL transaction with the marker (`ON CONFLICT DO NOTHING`) plus any outbox events; commit.
5. Ack. NEVER put the OpenSearch call inside a PostgreSQL transaction.

### Truth Statement (Paused-hub units are NOT available)
```sql
SELECT o.offer_id, o.product_id, o.selling_price, o.status, v.revision,
coalesce(sum(case when l.is_sellable and (h.hub_id is null or h.active)
then i.quantity - i.reserved_quantity else 0 end), 0) as free_units,
coalesce(sum(case when l.is_sellable and l.is_home
then i.quantity - i.reserved_quantity else 0 end), 0) as home_units
FROM dealer_offers o
JOIN offer_state_versions v on v.offer_id = o.offer_id
LEFT JOIN inventory i on i.offer_id = o.offer_id
LEFT JOIN stock_locations l on l.location_id = i.location_id
LEFT JOIN fulfilment_hubs h on h.location_id = l.location_id
WHERE o.offer_id = $1
GROUP BY o.offer_id, o.product_id, o.selling_price, o.status, v.revision;
```

---

## 9. Quick Delivery Is Never Indexed

`quick_available` and `hub_units` are NOT OpenSearch fields. Quick eligibility is computed in the PostgreSQL recheck on every read, exactly like price. A Quick filter is applied AFTER the recheck.

---

## 10. Single Writer + Single Producer for Notifications

ONLY the `notifier` consumer inserts into the `notifications` table.

Exactly ONE producer of `'notification-created'` per situation:
- **order confirmed** -> `inventory-finalizer` (`order-placed`)
- **fulfilment step / OTP** -> `fulfilment-pipeline` (`fulfilment-status-updated`)
- **transfer step** -> `fulfilment-pipeline` (`stock-transfer-status-updated`)
- **revised ETA** -> `fulfilment-pipeline` (`eta-updated`)
- **cancellation + refund** -> `cancellation-handler` (`order-item-cancelled`, emits AFTER its OpenSearch upsert succeeds)
- **refund credited (SIM)** -> `refund-credit` consumer (`refund-credit-requested`)
- **stock / price alert** -> `alert-watcher` (`inventory-updated` AND `order-item-cancelled`) `[FEATURE_ALERTS]`

API routes NEVER emit `'notification-created'` and NEVER move money or stock for refunds. Routes enqueue; consumers act.
`shipment_timeline` is APPEND-ONLY and written ONLY by consumers.

---

## 11. Delivery Mode, Grouping and Fees

### Resolution Steps
- **Step 1 - Resolve the hub**: (`pin_code` is UNIQUE, returns 0 or 1 row)
  ```sql
  hub := SELECT h.* FROM hub_service_areas a
         JOIN fulfilment_hubs h USING (hub_id)
         WHERE a.pin_code = $pin AND h.active = true;
  ```
- **Step 2 - Classify each CONFIRMED reservation by its stock location**:
  - `location_type = 'hub'` -> candidate quick
  - `is_home = true` -> standard (Bangalore warehouse)
  - `location_type = 'holding'` -> transfer (Section B)
  - `quarantine` -> 409 `LOCATION_NOT_SELLABLE` (unreachable)
- **Step 3 - Grant quick only if ALL are true**:
  - `hub` exists AND `hub.location_id = reservation.location_id`
  - AND `now()` is inside `hub.hours` (`jsonb`, Asia/Kolkata)
  - AND groups accepted at that hub today < `hub.order_capacity`
  - AND `'quick' = any(dealer_offers.eligible_modes)`
  - *Otherwise*:
    - Preference explicitly `'quick'` -> `409 QUICK_NOT_AVAILABLE`
    - No preference -> fall back to `'standard'` from that hub
- **Step 4 - Preferences**:
  - `'standard'` on a hub reservation is ALLOWED (customer downgrade).
  - `'quick'` on a non-hub reservation is ALWAYS rejected. Never silently upgrade.
- **Step 5 - Grouping**:
  - `group key = (location_id, mode)`. Exactly one `fulfilment_groups` row per key.
  - Every order line is in exactly one group.
  - Initial status: `transfer` -> `'reserved_at_origin'`, else `'order_accepted'`.

### Fees (Configured SAMPLE constants, `backend/src/api/fees.js`, bigint paise)
- `FEE_QUICK_PAISE` = 4900 (Rs.49)
- `FEE_STANDARD_PAISE` = 2900 (Rs.29)
- `FEE_TRANSFER_PAISE` = 6900 (Rs.29 handling + Rs.40 inter-location)
- `FREE_STANDARD_THRESHOLD_PAISE` = 99900 (Rs.999)

**Group fee rules**:
- `quick` -> 4900
- `standard` -> 0 if the group's `items_total >= 99900`, else 2900
- `transfer` -> 6900 (never waived)
- `delivery_fee_total` = `SUM(group_fee)`

### Allocation (Do not improvise)
- `discount_share = allocate(discount_total, ALL line_prices)` -- global
- `delivery_fee_share = allocate(group_fee, line_prices WITHIN THAT GROUP)`
- `allocate()` = floor proportional, leftover paise allocated one each in `order_item_id` order.

### Tested Invariants
- `group.fee_total = SUM(delivery_fee_share of its lines)`
- `SUM(order_items.paid_amount) = orders.total_amount`
- `total_amount = items_total - discount_total + delivery_fee_total`

---

## 12. Delivery OTP Rules (The code NEVER travels in events)

### Derivation (Deterministic, reproducible by simulator)
```javascript
raw = HMAC_SHA256(OTP_HASH_SECRET, "otp:" + group_id) // hex
code = String(parseInt(raw.slice(0, 8), 16) % 1000000).padStart(6, '0')
otp_hash = HMAC_SHA256(OTP_HASH_SECRET, "hash:" + code) // stored on group
```

### In Events (v7.1 - The code NEVER travels)
- `POST /api/simulator/fire-event {group_id, event_type: 'otp_verified', otp}`
  - Admin only, HTTPS. The raw OTP exists ONLY in the request body.
  - The route computes `otp_proof = HMAC_SHA256(OTP_HASH_SECRET, "hash:" + otp)` via Agent C's `hashOtpSubmission(otp)`, and writes ONLY `{group_id, event_type, otp_proof}` into the outbox payload.
  - OTP missing on `otp_verified` -> `400 OTP_REQUIRED`.
  - Never log the request body. Never persist the raw code anywhere.
- **Pipeline (`otp_verified`)**:
  - Constant-time compare `payload.otp_proof` with `fulfilment_groups.otp_hash` (Agent C's `verifyOtpProof(groupId, proof)`). No derivation in the consumer.
  - Equal -> delivered path (ALL three modes).
  - Unequal -> `otp_failed` timeline row; NEVER delivered.
  - Live-proof panel displays `otp_proof` (a hash), which is safe to display.
- **Scope**: EVERY group gets an `otp_hash` at creation — quick, standard, AND transfer. All three modes require OTP proof at delivery. No mode is exempt.
- **Raw Code Visibility**: The raw code appears ONLY in two API responses:
  1. `GET /api/orders/:id` -> `delivery_otp` (owning customer only, while group is undelivered, labelled "SAMPLE DEMO OTP")
  2. `GET /api/admin/groups/:id/demo-otp` -> admin, autofills the correct-OTP button.
  - The wrong-OTP button submits `(parseInt(code) + 1) % 1000000`, zero-padded; route hashes it identically, producing a non-matching proof.
- **Strict Prohibition**: Never log the code, index it, put it in a Kafka payload, or expose another customer's code.

---

## 13. Refund Credit Rules

### Roles
- **Cancel route**: Creates `refunds` row with status `'requested'`. No money moved.
- **Refund-stub worker (Agent C)**: SIMULATED gateway. After short delay:
  ```sql
  UPDATE refunds SET status = 'initiated', initiated_at = now()
  WHERE refund_id = $1 AND status = 'requested'; -- no money
  ```
  Then writes outbox `'refund-credit-requested'` (key `order_item_id`).
- **Admin route**: `POST /api/admin/refunds/:id/credit` writes the SAME outbox event immediately, returning `202 {event_id}`. Never touches money. (Hit twice by double-refund test).
- **Refund-credit consumer**: The ONLY component that credits money, and the ONLY producer of `'notification-created'` for refund status.

### One Transaction (Pattern A, marker included)
```sql
UPDATE refunds SET status = 'credited', credited_at = now(), gateway_ref = $2
WHERE refund_id = $1 AND status IN ('requested', 'initiated')
RETURNING order_item_id, item_amount, fee_amount;

-- 0 rows -> SELECT status:
--   'credited' -> already done, commit marker, ack, NO money movement
--   'failed'   -> log and skip

UPDATE order_items
SET item_refunded_amount = item_refunded_amount + $i,
    fee_refunded_amount  = fee_refunded_amount + $f
WHERE order_item_id = $oi AND $i >= 0 AND $f >= 0
  AND item_refunded_amount + $i <= line_price - discount_share
  AND fee_refunded_amount + $f <= delivery_fee_share
RETURNING 1;

-- 0 rows -> RAISE REFUND_CAP_EXCEEDED (status change rolls back).
-- Then, in a SEPARATE transaction, stop retry loop:
-- UPDATE refunds SET status = 'failed' WHERE refund_id = $1 AND status IN ('requested', 'initiated');

-- Emit ONE outbox 'notification-created' ("Refund credited") in credit txn.
```

- **Retry Safety**: A crash before commit rolls back everything; gate matches again. A retry after commit finds `status = 'credited'` and moves no money.

---

## 14. Group Status Vocabularies & State Machines

Group status is one-way, set ONLY by `fulfilment-pipeline`:
- **quick**:
  `order_accepted -> picked -> packed -> rider_assigned -> picked_up -> out_for_delivery -> delivered`
- **standard**:
  `order_accepted -> processing -> packed -> rider_assigned -> picked_up -> in_transit -> out_for_delivery -> delivered`
- **transfer**:
  `reserved_at_origin -> transfer_requested -> in_transit_to_bangalore -> received_checked -> allocated -> packed -> rider_assigned -> picked_up -> out_for_delivery -> delivered`
- **Terminal statuses**: `delivered`, `cancelled`.
- `otp_failed` and `exception` add a timeline row and DO NOT advance status.

### Cancellation Permission
Cancellation is ALLOWED only while group status is NOT IN:
`('picked_up', 'out_for_delivery', 'delivered', 'cancelled')`
- A transfer group at `in_transit_to_bangalore` IS still cancellable: the unit has not left Bangalore for the customer.

---

## 15. Comparison Rules, Scoring, and ETA

### Eligibility for All Five Categories
Offer status = `'active'`, sellable free units (`quantity - reserved_quantity`) > 0, `location.is_sellable = true`.
`effective_days = bangalore_delivery_days` when the offer has free units at the `is_home` location, otherwise `transfer_days_max` (a 2-3 day offer counts as 3).

| Category | Rank By | Tie-Break |
| :--- | :--- | :--- |
| **Best Budget** | `selling_price ASC` | `effective_days ASC`, `rating DESC` |
| **Fastest Delivery** | `effective_days ASC` | `selling_price ASC` |
| **Best Rated Dealer**| `dealer_rating DESC`| `total_reviews DESC`, `price ASC` |
| **Best Value** | `weighted score DESC`| `selling_price ASC` |
| **Most Available** | `sellable free units DESC` | `selling_price ASC` |

### Best Value Scoring
```
BEST VALUE = 0.45 * price + 0.25 * delivery + 0.20 * rating + 0.10 * stock
```
Each factor normalized 0–100 across eligible offers of that product:
- `price = 100 * (max_price - price) / (max_price - min_price)`
- `delivery = 100 * (max_days - days) / (max_days - min_days)`
- `rating = 100 * dealer_rating / 5`
- `stock = 100` for any in-stock offer (MVP indicator)
- Zero denominator on a factor -> every offer scores 100 on that factor.
- Units at non-sellable locations never count anywhere.
- Every category response MUST include a reason string built ONLY from stored fields (e.g., `"Lowest price Rs.699 among 5 in-stock offers - 4-day delivery"`). One SQL per category; never reuse one sort for all five.

### ETA Rules (`backend/src/api/eta.js`, no routing API)
- `quick` = accept 5m + `picking_queue` * 4m + pack 5m + assign 5m + travel 20m, shown as a RANGE +/- 15m.
- `standard` = warehouse 1 business day + local 1-2 days.
- `transfer` = `transfer_days_max` + warehouse 1 day + local 1-2 days.
- `picking_queue` = live count of groups at that hub in `('order_accepted', 'picked', 'packed')` today, read from PostgreSQL.
- Store `eta_window_start`/`end` + `eta_basis` on group; `promised_*` on items. Never a fixed 10-minute promise. Paused / at-capacity hub -> Quick hidden.
- Material change writes an `eta-updated` outbox event keyed by `group_id`.

---

## 16. Authentication & Security

- Seeded demo customer + admin.
- `POST /api/auth/login` issues a 12h JWT and is rate-limited (10 per minute per IP).
- Only customer demo login is ever prefilled (`demo@bazaarbridge.dev` / `Demo@1234`).
- Admin password comes from `SEED_ADMIN_PASSWORD` (v7.2, default `Admin@1234` for local only; NEVER prefilled in UI).
- Identity ALWAYS comes from the verified JWT. Admin routes require `role = 'admin'`.

---

## 17. Honesty and Scope

- Simulated features behind flags, seeded rows, yellow `"SIMULATED / SAMPLE DATA"` badge via `<SimulatedWrapper>`.
- Seeded price history, hubs, riders, reviews, delivery fees, and demo OTP are SAMPLE. Never "genuine", "live", or "verified" about seeded data.
- Dropped feature: flag OFF, routes and nav hidden, tests SKIPPED, removed from Built column.
- Priority B features are never BUILT — only 30-minute labelled seeded screens.
