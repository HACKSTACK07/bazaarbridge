# BazaarBridge Database Seed Subsystem

**Authoritative Documentation for Database Seed Data (Version 7.2)**  
Owned and maintained by **Agent D (Seed Data Engineer)** in accordance with `agent-rules.md`, `schema.sql`, `api-contract.md`, and `service-contracts.md`.

---

## 1. Overview

The BazaarBridge seed subsystem populates an Aiven PostgreSQL database with realistic, synthetic sample data. All records are strictly labelled as **SAMPLE** data.

All database mutations in the seed script are **100% idempotent**: running the script once or repeatedly against an existing database maintains data consistency without duplicate keys or foreign-key violations.

---

## 2. Seed Records Summary

| Entity | Count | Key Attributes & Details |
| :--- | :--- | :--- |
| **Categories** | 5 | Audio & Headphones, Mobiles & Accessories, Computers & Peripherals, Cameras & Photography, Wearables & Smart Home |
| **Products** | 40 | 8 products per category with realistic JSONB specs. Product 1 is the comparison Bluetooth speaker. |
| **Dealers** | 6 | 5 Bangalore dealers with distinct ratings (4.9, 4.7, 4.4, 4.1, 3.8) and reviews (340, 215, 128, 74, 42) + 1 Mysuru dealer |
| **Stock Locations** | 4 | Bangalore Central Warehouse (`is_home=true`), Bangalore Express Hub (`hub`), Bangalore Quarantine (`is_sellable=false`), Mysuru Regional Holding (`holding`) |
| **Fulfilment Hubs** | 1 | Bangalore Express Hub with JSONB hours (`08:00-22:00`), `order_capacity=50`, `delivery_radius_km=12.5` |
| **Hub Service Areas** | 3 | PIN codes: `560001` (Bangalore GPO / MG Road), `560038` (Indiranagar), `560025` (Richmond Town) |
| **Dealer Offers** | 75 | Across 40 products. Exactly 5 offers for Bluetooth speaker; 2–4 offers for popular products; 1-unit test offer; Mysuru dealer offers |
| **Inventory Records** | 77 | Stock assigned across warehouse, hub, holding, and quarantine |
| **Users** | 3 | Demo Customer (`demo@bazaarbridge.dev`), System Admin (`admin@bazaarbridge.dev`), Express Rider (`rider@bazaarbridge.dev`) |
| **User Carts** | 3 | Initialized shopping carts for each demo user |
| **Price History** | 5 | Sample closed historical intervals (`valid_to IS NOT NULL`) for 30-day reference price query |
| **Coupons** | 4 | `SAVE10` (10% off), `WELCOME50` (Rs.50 off), `FESTIVE15` (15% off), `BAZAAR100` (Rs.100 off) |

---

## 3. Five Comparison Categories Calibration (Requirement 5)

Product 1 (`EchoPulse Boom 360 Portable Bluetooth Speaker`, ID `60000000-0000-0000-0000-000000000001`) has **exactly 5 offers**, mathematically calibrated against the comparison scoring and tie-breaking algorithms from `agent-rules.md` (Section 15) and `service-contracts.md` (Section 4):

| Offer ID | Dealer | Selling Price | Delivery Days | Rating | Stock | Best Value Score | Selected Winner Category |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `7000...0001` | Jayanagar Value Bazaar | **₹1,999** (199900 paise) | 4 | 3.8 | 15 | 70.20 | **Best Budget** (Lowest price) |
| `7000...0002` | Indiranagar Digital Mart | ₹2,499 (249900 paise) | **1** | 4.4 | 20 | 65.46 | **Fastest Delivery** (Lowest delivery days) |
| `7000...0003` | Apex Electronics | ₹2,699 (269900 paise) | 2 | **4.9** (340 rev) | 10 | 46.27 | **Best Rated Dealer** (Highest dealer rating) |
| `7000...0004` | Whitefield Prime Gadgets | ₹2,599 (259900 paise) | 3 | 4.1 | **120** | 41.16 | **Most Available** (Highest sellable free units) |
| `7000...0005` | Brigade Tech & Sound | ₹2,099 (209900 paise) | 2 | 4.7 (215 rev) | 35 | **84.04** | **Best Value** (Highest composite weighted score) |

### Best Value Formula
$$\text{Score} = 0.45 \times \text{PriceNorm} + 0.25 \times \text{DeliveryNorm} + 0.20 \times \text{RatingNorm} + 0.10 \times \text{StockNorm}$$
- Offer 5 scores **84.04**, outperforming all other offers while remaining distinct in price, delivery, rating, and stock.

---

## 4. Concurrency Test Offer (Requirement 6)

- **Product**: BassMaster Wireless Noise-Cancelling Headphones (ID `60000000-0000-0000-0000-000000000002`)
- **Offer ID**: `70000000-0000-0000-0000-000000000006`
- **Location**: Bangalore Central Warehouse (ID `10000000-0000-0000-0000-000000000001`)
- **Quantity**: 1 (`quantity = 1, reserved_quantity = 0`)
- **Free Units**: Exactly 1 available unit. Target for Phase 1 simultaneous reservation/order race tests.

---

## 5. Regional Fulfillment (Requirement 8)

- **Dealer**: Chamundi Retail & Audio (ID `40000000-0000-0000-0000-000000000006`, Mysuru, Karnataka)
- **Offer**: SonicAir True Wireless Earbuds (ID `70000000-0000-0000-0000-000000000009`)
- **Inventory dual-allocation**:
  - **Bangalore Central Warehouse**: 15 units (supports Section A: outside Bangalore dealer with local stock)
  - **Mysuru Regional Holding**: 25 units (supports Section B: outside Bangalore dealer requiring 2-3 day inter-location transfer)

---

## 6. How to Run the Seed

### Option A: Run directly with Node.js
```bash
# Set your PostgreSQL connection string (process.env.PG_URI)
export PG_URI="<your-aiven-postgres-connection-uri>"

# Run seed
node backend/src/seed/seed.js
```

### Option B: Run with psql CLI
```bash
psql $PG_URI -f backend/src/seed/seed.sql
```

### Option C: Run the Verification Test Suite
```bash
node backend/src/seed/verify.js
# or
node backend/src/seed/seed.js --verify
```

---

## 7. Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PG_URI` | *(optional)* | PostgreSQL connection URI for direct database execution |
| `SEED_ADMIN_PASSWORD` | `Admin@1234` | Password for the demo admin account (`admin@bazaarbridge.dev`) |
