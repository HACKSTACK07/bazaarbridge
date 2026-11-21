# BazaarBridge API Contract (api-contract.md)

Authoritative REST API and Event specification for BazaarBridge (Version 7.2).
All routes are owned and implemented by **Agent B** in `backend/src/api/`.

---

## 1. Protocol & Error Standards

- **Base URL**: `/api`
- **Error Format**: All errors return JSON in the structure:
  ```json
  {
    "error": "ERROR_CODE",
    "message": "Human readable error description"
  }
  ```
- **Monetary Values**: All money is represented in **integer paise** (e.g., `4900` = ₹49.00). No floating point numbers.
- **Authentication**: All endpoints require a valid JWT bearer token in the `Authorization` header (`Bearer <token>`), EXCEPT `POST /api/auth/login`. Identity is strictly extracted from the verified JWT.
- **Admin Endpoints**: Routes marked `(admin)` strictly enforce `role === 'admin'`.

---

## 2. REST Endpoints

### Authentication
- `POST /api/auth/login`
  - **Body**: `{ "email": "...", "password": "..." }`
  - **Success (200)**: `{ "token": "...", "user": { "user_id": "...", "name": "...", "role": "customer" | "admin" | "rider" } }`
  - **Notes**: Issues a 12h JWT containing `user_id` and `role`. Rate-limited to 10 requests per minute per IP.

### Products & Search
- `GET /api/products?category=`
  - Returns list of products filtered optionally by category.

- `GET /api/search?q=&category=&max_price=&city=&quick=`
  - **Parameters**: `q` (search term), `category`, `max_price` (in paise), `city` (matches `dealer_city`, case-insensitive), `quick` (boolean).
  - **Behavior**: Calls OpenSearch for candidate offer hits. Then performs a **PostgreSQL recheck** for price, availability, and quick delivery eligibility. `category`, `max_price`, and `city` are re-applied after the PostgreSQL recheck so stale index records never leak. The `quick` filter is applied AFTER the recheck. Quick eligibility is NEVER indexed.

- `GET /api/search/filters`
  - **Success (200)**: `{ "categories": [{ "category_id": "...", "category_name": "..." }], "cities": ["..."] }`
  - **Behavior**: PostgreSQL-only. Returns active categories and distinct cities of dealers who have active offers.

- `GET /api/products/:id`
  - Returns product details, brand, category, specs.

- `GET /api/products/:id/offers?category=`
  - **Parameters**: `category` in `budget | fastest | rated | value | available`.
  - **Success (200)**: Returns ranked offer cards for the product with price, delivery, rating, available units, and API-computed `reason` string verbatim.

- `GET /api/products/:id/price-history`
  - **Behavior**: PostgreSQL-only. Returns 30-day reference price (lowest `selling_price` in the 30 days BEFORE the current period, excluding the current row). Was-price is shown only when reference price > current price. Never indexed in OpenSearch.

- `GET /api/products/:id/related`
  - Returns related products in the same category.

- `GET /api/products/compare?ids=a,b,c` `[FEATURE_COMPARE]`
  - Compares up to 3 products side-by-side using structured specs.

- `GET /api/outside-bangalore`
  - **Success (200)**: `{ "section_a": [...], "section_b": [...] }`
  - **Section A**: Outside Bangalore dealers with stock in Bangalore warehouse (faster).
  - **Section B**: Outside Bangalore dealers with stock at regional holding locations requiring inter-location transfer (~2-3 days).

### Cart & Reservations
- `POST /api/cart/items`
  - **Body**: `{ "cart_item_id"?: "...", "offer_id": "...", "quantity": 1 }`
  - Attaches item to user's cart and stores `price_snapshot` for display.

- `GET /api/cart`
  - Returns cart items with live revalidated price and inventory stock status.

- `DELETE /api/cart/items/:cartItemId`
  - Removes item from cart and atomically releases any attached reservation hold.

- `POST /api/cart/items/:id/save-for-later` | `POST /api/cart/items/:id/restore` `[FEATURE_SAVE_LATER]`
  - Moves item between active cart and saved-for-later list, revalidating on restore.

- `POST /api/cart/reserve`
  - **Body**: `{ "cart_item_id"?: "...", "offer_id": "...", "location_id": "...", "quantity": 1, "request_key": "..." }`
  - **Success (201)**: `{ "reservation_id": "...", "expires_at": "...", "price_paise": 12345, "location_id": "..." }`
  - **Errors**: `409 OUT_OF_STOCK`
  - **Behavior**: Atomic hold. Bangalore-first: if the requested location has no free units but `is_home` does, reserve at `is_home` and return that `location_id`. Associates with `cart_item_id` if provided.

- `POST /api/cart/release`
  - **Body**: `{ "reservation_id": "..." }`
  - **Success (200)**: `{ "reservation_id": "...", "status": "released" }` (idempotent: already released/expired returns 200).
  - **Errors**: `409 CANNOT_RELEASE_CONFIRMED` (confirmed reservations must use the cancellation route).

### Orders & Checkout
- `POST /api/orders`
  - **Body**:
    ```json
    {
      "reservation_ids": ["..."],
      "address": { "pin_code": "560001" },
      "mode_preferences": { "<reservation_id>": "quick" | "standard" },
      "coupon_code": "SAVE10"
    }
    ```
  - **Success (201)**:
    ```json
    {
      "order_id": "...",
      "total_amount": 12345,
      "delivery_fee_total": 4900,
      "groups": [
        {
          "group_id": "...",
          "mode": "quick",
          "location_id": "...",
          "fee_total": 4900,
          "eta_window_start": "...",
          "eta_window_end": "..."
        }
      ]
    }
    ```
  - **Errors**:
    - `409 RESERVATION_EXPIRED`
    - `409 PRICE_CHANGED` -> `{ "reservations": [{ "reservation_id": "...", "offer_id": "...", "current_price_paise": 12345 }] }`
    - `409 QUICK_NOT_AVAILABLE`
    - `409 LOCATION_NOT_SELLABLE`
    - `409 COUPON_LIMIT_REACHED`
    - `409 PER_CUSTOMER_LIMIT_REACHED`

- `GET /api/orders/:id`
  - **Success (200)**: Full order details with items, fulfilment groups, shipment timeline, transfer status, and `delivery_otp` (for owning customer only, while group is undelivered, labelled "SAMPLE DEMO OTP").

- `POST /api/check-pin`
  - **Body**: `{ "pin_code": "560001" }`
  - **Success (200)**: `{ "quick_available": true, "standard_available": true, "hub_id": "..." }`

- `GET` / `POST` / `DELETE` `/api/addresses` `[FEATURE_ADDRESSES]`
  - Customer address management.

### After-Sales & Cancellations
- `POST /api/orders/:id/items/:orderItemId/cancel`
  - **Body**: `{ "request_key": "..." }`
  - **Success (200)**: `{ "case_id": "...", "refund": { "refund_id": "...", "status": "requested", "amount": 12345 } }` (replaying returns the original record).
  - **Errors**: `409 ALREADY_CANCELLED_OR_TOO_LATE`
  - **Behavior**: Atomic conditional cancellation of the `order_items` row. Enqueues outbox event `order-item-cancelled`.

### Simulator & Admin Endpoints (Admin role required)
- `POST /api/simulator/fire-event` (admin)
  - **Body**: `{ "group_id": "...", "event_type": "...", "otp"?: "123456" }`
  - **Success (202)**: `{ "event_id": "..." }`
  - **Notes**: For `otp_verified`, `otp` is strictly required in request body (else `400 OTP_REQUIRED`). Route computes `otp_proof = HMAC_SHA256(OTP_HASH_SECRET, "hash:" + otp)` and writes ONLY `{ group_id, event_type, otp_proof }` into outbox payload. Raw OTP is never logged, indexed, or stored.

- `GET /api/admin/groups/:id/demo-otp` (admin)
  - Returns the derived demo OTP code for the admin simulator console to autofill the "Deliver - Correct OTP" action.

- `POST /api/admin/refunds/:id/credit` (admin)
  - **Body**: `{ "gateway_ref"?: "..." }`
  - **Success (202)**: `{ "event_id": "..." }`
  - **Notes**: Immediately writes `refund-credit-requested` outbox event. Never touches money directly.

- `POST /api/admin/hubs/:id/status` (admin)
  - **Body**: `{ "active": boolean }`
  - **Success (200)**: Updates hub status (which fires the DB trigger to bump offer revisions) and emits `inventory-updated` and `eta-updated` events.

- `GET /api/admin/live-proof` (admin)
  - Returns recent outbox rows, processed events, OpenSearch index doc, and current revision. Displays `otp_proof` hashes; never raw codes.

### Notifications & Customer Engagement
- `GET /api/notifications?unread=true`
  - Returns in-app notifications for the authenticated user.

- `POST /api/wishlist/toggle` - `GET /api/wishlist` `[FEATURE_WISHLIST]`
- `GET /api/recently-viewed`
- `POST /api/coupons/validate` `{ "code": "...", "basket_total_paise": 12345 }` `[FEATURE_COUPONS]`
- `POST /api/alerts/subscribe` `[FEATURE_ALERTS]`
- `POST /api/shopping-assistant` `{ "message": "..." }` `[FEATURE_ASSISTANT]`

---

## 3. Kafka Event Catalog

### Topic: `bazaar.core.events` (2 partitions)
- `order-placed`: key = `order_id`
- `inventory-updated`: key = `offer_id`
- `order-item-cancelled`: key = `offer_id`
- `offer-price-updated`: key = `offer_id`
- `refund-credit-requested`: key = `order_item_id`
- `notification-created`: key = `user_id`

### Topic: `bazaar.fulfilment.events` (2 partitions)
- `fulfilment-status-updated`: key = `group_id` (`otp_verified` carries `otp_proof` ONLY)
- `stock-transfer-status-updated`: key = `group_id`
- `eta-updated`: key = `group_id`

---

## 4. Simulator Event Types

### `fulfilment-status-updated`
- `picked`
- `packed`
- `rider_assigned`
- `picked_up`
- `out_for_delivery`
- `otp_verified` (carries `otp_proof` hash)
- `otp_failed`
- `exception`

### `stock-transfer-status-updated`
- `transfer_requested` (emitted by inventory-finalizer)
- `in_transit`
- `received_checked`
- `allocated`
