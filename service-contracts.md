
# BazaarBridge Service Contracts (service-contracts.md)

Authoritative Service Interfaces, OpenSearch Mappings, and Shared Library Contracts for BazaarBridge (Version 7.2).
Frozen at Hour 2.

---

## 1. Agent C Exports (`backend/src/search/index.js`)

Agent B imports these functions directly into the Express API routes:

### `searchOffers({ q, category, maxPricePaise, city, limit })`
- **Purpose**: Typo-tolerant discovery and candidate retrieval via OpenSearch.
- **Parameters**:
  - `q` (string): Search query text.
  - `category` (string, optional): Category filter.
  - `maxPricePaise` (bigint/number, optional): Maximum selling price ceiling in integer paise.
  - `city` (string, optional): Matches `dealer_city`.
  - `limit` (number, optional): Max candidate hits.
- **Returns**: `{ hits: [{ offer_id, product_id }] }`
- **Rule**: Never return price, stock, or quick delivery eligibility from OpenSearch. Those fields are rechecked strictly against PostgreSQL.

### `upsertOffer(offerId)`
- **Purpose**: Indexes or updates an offer in OpenSearch with external versioning.
- **Behavior**:
  1. Reads truth AND revision in ONE atomic PostgreSQL statement (Truth Statement from `agent-rules.md`).
  2. Upserts document `id = offer_id` with `version_type=external_gte&version=rev`.
  3. If OpenSearch returns `409 Version Conflict`, treats it as `'stale'` (newer revision already indexed = success).
- **Returns**: `{ revision: number, outcome: 'written' | 'stale' }`

### `ensureIndex()`
- **Purpose**: Creates the OpenSearch `offers` index with the typo-tolerant analyzer and required schema mappings if it does not already exist.

### `deriveOtp(groupId)`
- **Purpose**: Deterministically computes 6-digit numeric OTP string for display endpoints.
- **Derivation**:
  ```javascript
  raw = HMAC_SHA256(OTP_HASH_SECRET, "otp:" + groupId); // hex
  code = String(parseInt(raw.slice(0, 8), 16) % 1000000).padStart(6, '0');
  return code;
  ```
- **Returns**: String `'######'` (e.g., `'481920'`). Used only for display to the owning customer and admin demo button.

### `hashOtpSubmission(code)`
- **Purpose**: Converts submitted 6-digit OTP code into proof hash before it enters outbox payload.
- **Derivation**: `HMAC_SHA256(OTP_HASH_SECRET, "hash:" + code)`
- **Returns**: Hex string. Used by Agent B's `/api/simulator/fire-event` route.

### `verifyOtpProof(groupId, proof)`
- **Purpose**: Constant-time comparison between submitted `otp_proof` and stored `fulfilment_groups.otp_hash`.
- **Returns**: `boolean` (`true` if match, `false` otherwise). Consumer never derives or sees raw code.

---

## 2. Agent A Exports (`frontend/src/kit/`)

Agent D imports these in Phase 2 for simulated screens and UI tests:

### `<SimulatedWrapper featureFlag label>`
- Wraps simulated features and displays the standard yellow `"SIMULATED / SAMPLE DATA"` badge.

### `formatPaise(paise)`
- Converts integer paise into Indian Rupee currency format (e.g., `76900` -> `"₹769"` or `"₹769.00"`).

### `usePolling(fn, ms)`
- React hook to poll an asynchronous fetch function at an interval with automatic cleanup.

---

## 3. OpenSearch Index Specification

### Document Structure (`offers` index, `_id = offer_id`)
```json
{
  "offer_id": "uuid",
  "product_id": "uuid",
  "product_name": "string",
  "brand": "string",
  "category_name": "string",
  "specs": {},
  "dealer_id": "uuid",
  "shop_name": "string",
  "dealer_city": "string",
  "dealer_state": "string",
  "origin_city": "string",
  "origin_state": "string",
  "is_outside_bangalore": true,
  "fulfilment_route": "string",
  "selling_price": 76900,
  "available_units": 40,
  "home_units": 0,
  "eligible_modes": ["standard"],
  "bangalore_delivery_days": null,
  "transfer_days_max": 3,
  "effective_days": 3,
  "dealer_rating": 4.1,
  "total_reviews": 40,
  "verified": true,
  "warranty_months": 12,
  "revision": 5
}
```

### Mapping Rules (v7.2)
- **Keyword Fields** (exact match, case-insensitive lowercase normalizer):
  - `category_name`
  - `dealer_city`
  - `dealer_state`
- **Fuzzy Text Fields** (fuzziness-enabled analyzer, typo-tolerant):
  - `product_name`
  - `brand`

### Prohibited from Indexing (Never indexed in OpenSearch)
- `quick_available` (computed live from PostgreSQL)
- `hub_units` (computed live from PostgreSQL)
- 30-day reference price / price history
- OTPs (raw codes OR proof hashes)
- Customer phone numbers, addresses, personal information, or secrets

---

## 4. Comparison Rules & Ranking Algorithms

### Eligibility
An offer is eligible for comparison if:
1. `offer.status = 'active'`
2. Sellable free units (`quantity - reserved_quantity`) > 0
3. `stock_locations.is_sellable = true`
4. `effective_days = bangalore_delivery_days` when free units exist at `is_home = true`, otherwise `transfer_days_max`.

### Ranking Matrix
| Category | Primary Sort | Tie-Break Sort |
| :--- | :--- | :--- |
| **Best Budget** | `selling_price ASC` | `effective_days ASC`, `dealer_rating DESC` |
| **Fastest Delivery** | `effective_days ASC` | `selling_price ASC` |
| **Best Rated Dealer**| `dealer_rating DESC`| `total_reviews DESC`, `selling_price ASC` |
| **Best Value** | `weighted score DESC`| `selling_price ASC` |
| **Most Available** | `sellable free units DESC`| `selling_price ASC` |

### Best Value Formula
```
BEST VALUE SCORE = 0.45 * price + 0.25 * delivery + 0.20 * rating + 0.10 * stock
```
Normalized 0–100 across eligible offers for that product:
- `price = 100 * (max_price - price) / (max_price - min_price)`
- `delivery = 100 * (max_days - days) / (max_days - min_days)`
- `rating = 100 * dealer_rating / 5`
- `stock = 100` for any in-stock offer (MVP indicator)
*(Note: If denominator is 0 for any factor, score 100 for that factor).*

**Requirement**: Every category response MUST include a human-readable `reason` string generated solely from stored database fields (e.g., `"Lowest price Rs.699 among 5 in-stock offers - 4-day delivery"`).

---

## 5. ETA Estimation Formulas (`backend/src/api/eta.js`)

- **Quick Mode**:
  `accept (5m) + (picking_queue * 4m) + pack (5m) + assign (5m) + travel (20m)`
  - Rendered as a RANGE `+/- 15m`.
  - `picking_queue` = live count of groups at that hub today in status `('order_accepted', 'picked', 'packed')` from PostgreSQL.
  - Never a fixed 10-minute promise.
- **Standard Mode**:
  `warehouse (1 business day) + local (1-2 days)`
- **Transfer Mode**:
  `transfer_days_max + warehouse (1 day) + local (1-2 days)`
- Store `eta_window_start`, `eta_window_end`, and `eta_basis` on the group; store `promised_delivery_start` / `promised_delivery_end` on order items.
- Material changes emit an `eta-updated` outbox event keyed by `group_id`.

---

## 6. Environment Configuration (`.env.example`)

```bash
PG_URI=
KAFKA_BROKERS=
KAFKA_SECURITY_PROTOCOL=SASL_SSL # SASL_SSL (preferred) or SSL
KAFKA_SASL_MECHANISM=SCRAM-SHA-256
KAFKA_SASL_USERNAME=
KAFKA_SASL_PASSWORD=
KAFKA_CA_PATH=certs/ca.pem # certs/ca.pem
KAFKA_SERVICE_CERT_PATH= # only if using certificate auth
KAFKA_SERVICE_KEY_PATH= # only if using certificate auth
OPENSEARCH_URL=
OPENSEARCH_USER=
OPENSEARCH_PASSWORD=
JWT_SECRET=
OTP_HASH_SECRET=
GEMINI_API_KEY=
SEED_ADMIN_PASSWORD= # local default Admin@1234; set a NEW value for any public deploy
FEATURE_FLAGS=FEATURE_COUPONS,FEATURE_WISHLIST,FEATURE_ALERTS,FEATURE_ADDRESSES,FEATURE_SAVE_LATER,FEATURE_COMPARE,FEATURE_ASSISTANT,FEATURE_REVIEWS,FEATURE_SUPPORT,FEATURE_SIM_SCREENS
```
