const express = require('express');
const { query, getClient } = require('../db');
const {
  authRateLimiter,
  login,
  requireAuth,
  requireAdmin
} = require('./auth');
const {
  allocate,
  calculateGroupFee,
  isWithinHubHours,
  validateInvariants
} = require('./fees');
const { computeEta } = require('./eta');
const { deriveOtp, hashOtpSubmission } = require('./otp');
const { hold_units, release_hold, restock_units } = require('../db/stock');

const router = express.Router();

// Try loading Agent C's searchService if available
let searchService = null;
try {
  searchService = require('../search');
} catch (e) {
  // Agent C develops in parallel; fallback provided below
}

// =====================================================================
// 1. AUTHENTICATION (POST /api/auth/login)
// =====================================================================
router.post('/auth/login', authRateLimiter, login);

// =====================================================================
// 2. PRODUCTS & OFFERS (GET /api/products, /:id, /:id/offers)
// =====================================================================
router.get('/products', async (req, res, next) => {
  try {
    const { category } = req.query;
    let sql = `
      SELECT p.*, c.category_name
      FROM products p
      JOIN categories c ON c.category_id = p.category_id
    `;
    const params = [];
    if (category) {
      sql += ' WHERE c.category_name = $1';
      params.push(category);
    }
    sql += ' ORDER BY p.name ASC;';
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/search/filters', async (req, res, next) => {
  try {
    const catRes = await query('SELECT category_id, category_name FROM categories ORDER BY category_name;');
    const citySql = `
      SELECT DISTINCT d.city
      FROM dealers d
      JOIN dealer_offers o ON o.dealer_id = d.dealer_id
      WHERE o.status = 'active'
      ORDER BY d.city;
    `;
    const cityRes = await query(citySql);
    res.json({
      categories: catRes.rows,
      cities: cityRes.rows.map(r => r.city)
    });
  } catch (err) {
    next(err);
  }
});

router.get('/products/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT p.*, c.category_name
       FROM products p
       JOIN categories c ON c.category_id = p.category_id
       WHERE p.product_id = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * Task 7: GET /api/products/:id/offers?category=budget|fastest|rated|value|available
 * One SQL per category; never reuse one sort for all five.
 * Verbatim reason string built ONLY from stored fields.
 */
router.get('/products/:id/offers', async (req, res, next) => {
  const { id } = req.params;
  const { category = 'budget' } = req.query;

  try {
    // Base query for eligible offers
    let orderByClause = '';
    if (category === 'budget') {
      // Best Budget: selling_price ASC, tie-break: effective_days ASC, rating DESC
      orderByClause = `ORDER BY o.selling_price ASC, effective_days ASC, d.dealer_rating DESC`;
    } else if (category === 'fastest') {
      // Fastest Delivery: effective_days ASC, tie-break: selling_price ASC
      orderByClause = `ORDER BY effective_days ASC, o.selling_price ASC`;
    } else if (category === 'rated') {
      // Best Rated Dealer: dealer_rating DESC, tie-break: total_reviews DESC, price ASC
      orderByClause = `ORDER BY d.dealer_rating DESC, d.total_reviews DESC, o.selling_price ASC`;
    } else if (category === 'available') {
      // Most Available: sellable free units DESC, tie-break: selling_price ASC
      orderByClause = `ORDER BY free_units DESC, o.selling_price ASC`;
    } else if (category === 'value') {
      // Best Value will calculate weighted score across eligible set
      orderByClause = `ORDER BY o.selling_price ASC`;
    } else {
      orderByClause = `ORDER BY o.selling_price ASC`;
    }

    const offersSql = `
      WITH eligible_offers AS (
        SELECT 
          o.offer_id, o.product_id, o.selling_price, o.status,
          o.bangalore_delivery_days, o.transfer_days_min, o.transfer_days_max,
          o.eligible_modes, o.warranty_months, o.warranty_note,
          d.dealer_id, d.shop_name, d.city as dealer_city, d.dealer_rating, d.total_reviews, d.verified,
          COALESCE(SUM(CASE WHEN l.is_sellable THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0)::int AS free_units,
          COALESCE(SUM(CASE WHEN l.is_sellable AND l.is_home THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0)::int AS home_units,
          CASE 
            WHEN COALESCE(SUM(CASE WHEN l.is_sellable AND l.is_home THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0) > 0 
            THEN o.bangalore_delivery_days 
            ELSE o.transfer_days_max 
          END as effective_days
        FROM dealer_offers o
        JOIN dealers d ON d.dealer_id = o.dealer_id
        LEFT JOIN inventory i ON i.offer_id = o.offer_id
        LEFT JOIN stock_locations l ON l.location_id = i.location_id
        WHERE o.product_id = $1 AND o.status = 'active'
        GROUP BY o.offer_id, d.dealer_id
        HAVING COALESCE(SUM(CASE WHEN l.is_sellable THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0) > 0
      )
      SELECT * FROM eligible_offers
      ${orderByClause};
    `;

    const result = await query(offersSql, [id]);
    const eligible = result.rows.map(o => ({
      ...o,
      selling_price: Number(o.selling_price),
      effective_days: Number(o.effective_days || 3),
      dealer_rating: Number(o.dealer_rating),
      total_reviews: Number(o.total_reviews),
      free_units: Number(o.free_units),
      home_units: Number(o.home_units)
    }));

    if (eligible.length === 0) {
      return res.json([]);
    }

    const totalEligibleCount = eligible.length;
    let finalSorted = eligible;

    // Handle Best Value normalized scoring: 0.45*price + 0.25*delivery + 0.20*rating + 0.10*stock
    if (category === 'value') {
      const prices = eligible.map(o => o.selling_price);
      const days = eligible.map(o => o.effective_days);
      const maxPrice = Math.max(...prices);
      const minPrice = Math.min(...prices);
      const maxDays = Math.max(...days);
      const minDays = Math.min(...days);

      finalSorted = eligible.map(o => {
        const scorePrice = maxPrice === minPrice ? 100 : (100 * (maxPrice - o.selling_price)) / (maxPrice - minPrice);
        const scoreDelivery = maxDays === minDays ? 100 : (100 * (maxDays - o.effective_days)) / (maxDays - minDays);
        const scoreRating = (100 * o.dealer_rating) / 5;
        const scoreStock = 100; // In-stock indicator
        const totalScore = 0.45 * scorePrice + 0.25 * scoreDelivery + 0.20 * scoreRating + 0.10 * scoreStock;
        return { ...o, value_score: totalScore };
      });

      finalSorted.sort((a, b) => {
        if (b.value_score !== a.value_score) return b.value_score - a.value_score;
        return a.selling_price - b.selling_price;
      });
    }

    // Build verbatim reason string from stored fields
    const enriched = finalSorted.map(o => {
      let reason = '';
      const priceRupees = Math.round(o.selling_price / 100);
      if (category === 'budget') {
        reason = `Lowest price Rs.${priceRupees} among ${totalEligibleCount} in-stock offers - ${o.effective_days}-day delivery`;
      } else if (category === 'fastest') {
        reason = `Fastest delivery in ${o.effective_days} days from ${o.shop_name} (Rs.${priceRupees})`;
      } else if (category === 'rated') {
        reason = `Top rated dealer (${o.dealer_rating}★ with ${o.total_reviews} reviews)`;
      } else if (category === 'value') {
        reason = `Best value balance: Rs.${priceRupees}, ${o.effective_days}-day delivery, ${o.dealer_rating}★ dealer`;
      } else if (category === 'available') {
        reason = `Highest stock with ${o.free_units} units available for instant dispatch`;
      }
      return { ...o, reason };
    });

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

router.get('/products/:id/price-history', async (req, res, next) => {
  const { id } = req.params;
  try {
    const sql = `
      SELECT 
        h.offer_id,
        MIN(h.selling_price) as reference_price,
        o.selling_price as current_price
      FROM offer_price_history h
      JOIN dealer_offers o ON o.offer_id = h.offer_id
      WHERE o.product_id = $1
        AND h.valid_from >= now() - interval '30 days'
        AND h.valid_to IS NOT NULL
      GROUP BY h.offer_id, o.selling_price;
    `;
    const result = await query(sql, [id]);
    const histories = result.rows.map(r => ({
      offer_id: r.offer_id,
      current_price_paise: Number(r.current_price),
      reference_price_paise: Number(r.reference_price),
      show_was_price: Number(r.reference_price) > Number(r.current_price)
    }));
    res.json(histories);
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// 3. SEARCH (Task 8: GET /api/search)
// =====================================================================
router.get('/search', async (req, res, next) => {
  const { q = '', category, max_price, city, quick } = req.query;

  try {
    let candidateOfferIds = null;

    // Call Agent C searchService if available
    if (searchService && typeof searchService.searchOffers === 'function') {
      try {
        const searchRes = await searchService.searchOffers({
          q,
          category,
          maxPricePaise: max_price ? Number(max_price) : undefined,
          city,
          limit: 100
        });
        if (searchRes && Array.isArray(searchRes.hits)) {
          candidateOfferIds = searchRes.hits.map(h => h.offer_id);
        }
      } catch (err) {
        console.warn('OpenSearch searchOffers error; falling back to PostgreSQL:', err.message);
      }
    }

    // PostgreSQL Recheck (OpenSearch is NEVER the truth)
    let recheckSql = `
      SELECT 
        o.offer_id, o.product_id, o.selling_price, o.status,
        o.bangalore_delivery_days, o.transfer_days_max, o.eligible_modes,
        p.name as product_name, p.brand, c.category_name,
        d.dealer_id, d.shop_name, d.city as dealer_city, d.dealer_rating,
        COALESCE(SUM(CASE WHEN l.is_sellable AND (h.hub_id IS NULL OR h.active) THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0)::int AS free_units,
        COALESCE(SUM(CASE WHEN l.is_sellable AND l.is_home THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0)::int AS home_units
      FROM dealer_offers o
      JOIN products p ON p.product_id = o.product_id
      JOIN categories c ON c.category_id = p.category_id
      JOIN dealers d ON d.dealer_id = o.dealer_id
      LEFT JOIN inventory i ON i.offer_id = o.offer_id
      LEFT JOIN stock_locations l ON l.location_id = i.location_id
      LEFT JOIN fulfilment_hubs h ON h.location_id = l.location_id
      WHERE o.status = 'active'
    `;
    const params = [];

    if (candidateOfferIds && candidateOfferIds.length > 0) {
      params.push(candidateOfferIds);
      recheckSql += ` AND o.offer_id = ANY($${params.length}::uuid[])`;
    } else if (q.trim()) {
      // Graceful fallback if OpenSearch candidates not present
      params.push(`%${q.trim()}%`);
      recheckSql += ` AND (p.name ILIKE $${params.length} OR p.brand ILIKE $${params.length})`;
    }

    recheckSql += `
      GROUP BY o.offer_id, p.product_id, c.category_name, d.dealer_id
      HAVING COALESCE(SUM(CASE WHEN l.is_sellable AND (h.hub_id IS NULL OR h.active) THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0) > 0;
    `;

    const result = await query(recheckSql, params);

    // RE-APPLY category, max_price, city filters after PostgreSQL recheck
    let filtered = result.rows.filter(row => {
      if (category && row.category_name.toLowerCase() !== category.toLowerCase()) return false;
      if (max_price && Number(row.selling_price) > Number(max_price)) return false;
      if (city && row.dealer_city.toLowerCase() !== city.toLowerCase()) return false;
      return true;
    });

    // Compute Quick delivery eligibility live (NEVER from index)
    filtered = filtered.map(row => {
      const isQuickEligible = (row.eligible_modes || []).includes('quick');
      return {
        ...row,
        selling_price: Number(row.selling_price),
        quick_available: isQuickEligible
      };
    });

    // Apply quick filter AFTER recheck
    if (quick === 'true') {
      filtered = filtered.filter(row => row.quick_available);
    }

    res.json(filtered);
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// 4. CART & RESERVATIONS (Tasks 2, 3, 4, 9)
// =====================================================================

/**
 * Task 9: POST /api/cart/items
 * Price snapshot stored on add
 */
router.post('/cart/items', requireAuth, async (req, res, next) => {
  const { cart_item_id, offer_id, quantity = 1 } = req.body;
  if (!offer_id || quantity <= 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'offer_id and quantity > 0 required' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Get or create cart for user
    let cartRes = await client.query('SELECT cart_id FROM carts WHERE user_id = $1;', [req.user.user_id]);
    let cartId;
    if (cartRes.rowCount === 0) {
      const insCart = await client.query('INSERT INTO carts (user_id) VALUES ($1) RETURNING cart_id;', [req.user.user_id]);
      cartId = insCart.rows[0].cart_id;
    } else {
      cartId = cartRes.rows[0].cart_id;
    }

    // Read current offer price for snapshot
    const priceRes = await client.query('SELECT selling_price FROM dealer_offers WHERE offer_id = $1;', [offer_id]);
    if (priceRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OFFER_NOT_FOUND', message: 'Offer not found' });
    }
    const priceSnapshot = priceRes.rows[0].selling_price;

    let itemRes;
    if (cart_item_id) {
      itemRes = await client.query(`
        UPDATE cart_items
        SET quantity = $1, price_snapshot = $2
        WHERE cart_item_id = $3 AND cart_id = $4
        RETURNING *;
      `, [quantity, priceSnapshot, cart_item_id, cartId]);
    } else {
      itemRes = await client.query(`
        INSERT INTO cart_items (cart_id, offer_id, quantity, price_snapshot)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
      `, [cartId, offer_id, quantity, priceSnapshot]);
    }

    await client.query('COMMIT');
    res.status(201).json(itemRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * Task 9: GET /api/cart
 * Revalidates price + stock on read
 */
router.get('/cart', requireAuth, async (req, res, next) => {
  try {
    const sql = `
      SELECT 
        ci.cart_item_id, ci.cart_id, ci.offer_id, ci.quantity, ci.price_snapshot,
        ci.reservation_id, ci.saved_for_later,
        o.selling_price as live_price_paise,
        o.status as offer_status,
        p.name as product_name,
        d.shop_name,
        r.status as reservation_status,
        r.expires_at as reservation_expires_at,
        COALESCE(SUM(CASE WHEN l.is_sellable THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0)::int as available_stock
      FROM carts c
      JOIN cart_items ci ON ci.cart_id = c.cart_id
      JOIN dealer_offers o ON o.offer_id = ci.offer_id
      JOIN products p ON p.product_id = o.product_id
      JOIN dealers d ON d.dealer_id = o.dealer_id
      LEFT JOIN reservations r ON r.reservation_id = ci.reservation_id
      LEFT JOIN inventory i ON i.offer_id = o.offer_id
      LEFT JOIN stock_locations l ON l.location_id = i.location_id
      WHERE c.user_id = $1
      GROUP BY ci.cart_item_id, o.offer_id, p.product_id, d.dealer_id, r.reservation_id;
    `;
    const result = await query(sql, [req.user.user_id]);

    const items = result.rows.map(item => ({
      ...item,
      price_snapshot: Number(item.price_snapshot),
      live_price_paise: Number(item.live_price_paise),
      price_changed: Number(item.price_snapshot) !== Number(item.live_price_paise),
      in_stock: item.available_stock >= item.quantity
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/**
 * Task 3: POST /api/cart/reserve
 * Bangalore-first: if requested location has no free units but is_home does,
 * reserve at is_home and return that location_id.
 * Invokes reserve_offer logic.
 */
router.post('/cart/reserve', requireAuth, async (req, res, next) => {
  const { cart_item_id, offer_id, location_id, quantity = 1, request_key } = req.body;
  if (!offer_id || !request_key) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'offer_id and request_key are required' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Bangalore-first location selection
    let targetLocationId = location_id;

    if (targetLocationId) {
      // Check if requested location has free units >= quantity
      const locStock = await client.query(`
        SELECT (quantity - reserved_quantity) as free_units
        FROM inventory
        WHERE offer_id = $1 AND location_id = $2;
      `, [offer_id, targetLocationId]);

      const free = locStock.rows[0]?.free_units || 0;
      if (free < quantity) {
        // Fallback check to is_home
        const homeRes = await client.query(`
          SELECT l.location_id
          FROM stock_locations l
          JOIN inventory i ON i.location_id = l.location_id
          WHERE i.offer_id = $1 AND l.is_home = true AND (i.quantity - i.reserved_quantity) >= $2;
        `, [offer_id, quantity]);
        if (homeRes.rowCount > 0) {
          targetLocationId = homeRes.rows[0].location_id;
        }
      }
    } else {
      // No location specified: default to is_home if available
      const homeRes = await client.query(`
        SELECT l.location_id
        FROM stock_locations l
        JOIN inventory i ON i.location_id = l.location_id
        WHERE i.offer_id = $1 AND l.is_home = true AND (i.quantity - i.reserved_quantity) >= $2;
      `, [offer_id, quantity]);
      if (homeRes.rowCount > 0) {
        targetLocationId = homeRes.rows[0].location_id;
      } else {
        // Any sellable location with stock
        const anyRes = await client.query(`
          SELECT l.location_id
          FROM stock_locations l
          JOIN inventory i ON i.location_id = l.location_id
          WHERE i.offer_id = $1 AND l.is_sellable = true AND (i.quantity - i.reserved_quantity) >= $2
          LIMIT 1;
        `, [offer_id, quantity]);
        targetLocationId = anyRes.rows[0]?.location_id;
      }
    }

    if (!targetLocationId) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'OUT_OF_STOCK', message: 'Offer is out of stock across sellable locations' });
    }

    // Call reserve_offer function
    const reserveSql = `
      SELECT * FROM reserve_offer($1, $2, $3, $4, $5, $6);
    `;
    const resRow = await client.query(reserveSql, [
      req.user.user_id,
      offer_id,
      targetLocationId,
      quantity,
      request_key,
      cart_item_id || null
    ]);

    await client.query('COMMIT');
    return res.status(201).json(resRow.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message === 'OUT_OF_STOCK' || err.code === 'OUT_OF_STOCK') {
      return res.status(409).json({ error: 'OUT_OF_STOCK', message: 'Selected offer is out of stock' });
    }
    if (err.message === 'INVALID_QUANTITY') {
      return res.status(400).json({ error: 'INVALID_QUANTITY', message: 'Quantity must be greater than 0' });
    }
    next(err);
  } finally {
    client.release();
  }
});

/**
 * Task 4: POST /api/cart/release {reservation_id} - ONE transaction
 */
async function executeReservationRelease(client, reservationId, userId) {
  const updateSql = `
    UPDATE reservations
    SET status = 'released'
    WHERE reservation_id = $1 AND user_id = $2 AND status = 'reserved'
    RETURNING offer_id, location_id, quantity;
  `;
  const result = await client.query(updateSql, [reservationId, userId]);

  if (result.rowCount === 1) {
    const { offer_id, location_id, quantity } = result.rows[0];
    await release_hold(client, offer_id, location_id, quantity);

    await client.query(`
      INSERT INTO outbox_events (event_type, aggregate_key, payload)
      VALUES ('inventory-updated', $1, $2);
    `, [offer_id, JSON.stringify({ offer_id, location_id })]);

    return { status: 200, data: { reservation_id: reservationId, status: 'released' } };
  }

  // 0 rows -> Check current status
  const checkSql = `SELECT status, user_id FROM reservations WHERE reservation_id = $1;`;
  const checkRes = await client.query(checkSql, [reservationId]);

  if (checkRes.rowCount === 0 || checkRes.rows[0].user_id !== userId) {
    return { status: 404, data: { error: 'NOT_FOUND', message: 'Reservation not found' } };
  }

  const { status } = checkRes.rows[0];
  if (status === 'released' || status === 'expired') {
    return { status: 200, data: { reservation_id: reservationId, status } };
  }

  if (status === 'confirmed') {
    return {
      status: 409,
      data: { error: 'CANNOT_RELEASE_CONFIRMED', message: 'Confirmed reservation cannot be released; use cancel.' }
    };
  }

  return { status: 200, data: { reservation_id: reservationId, status } };
}

router.post('/cart/release', requireAuth, async (req, res, next) => {
  const { reservation_id } = req.body;
  if (!reservation_id) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'reservation_id required' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const outcome = await executeReservationRelease(client, reservation_id, req.user.user_id);
    if (outcome.status >= 400 && outcome.status !== 409) {
      await client.query('ROLLBACK');
      return res.status(outcome.status).json(outcome.data);
    }
    await client.query('COMMIT');
    return res.status(outcome.status).json(outcome.data);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * Task 4 & 9: DELETE /api/cart/items/:id
 * Releases any attached hold in the same transaction as the delete
 */
router.delete('/cart/items/:id', requireAuth, async (req, res, next) => {
  const { id } = req.params;
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const itemRes = await client.query(`
      SELECT ci.reservation_id, c.user_id
      FROM cart_items ci
      JOIN carts c ON c.cart_id = ci.cart_id
      WHERE ci.cart_item_id = $1;
    `, [id]);

    if (itemRes.rowCount === 0 || itemRes.rows[0].user_id !== req.user.user_id) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'ITEM_NOT_FOUND', message: 'Cart item not found' });
    }

    const { reservation_id } = itemRes.rows[0];

    // Release attached reservation if present
    if (reservation_id) {
      await executeReservationRelease(client, reservation_id, req.user.user_id);
    }

    await client.query('DELETE FROM cart_items WHERE cart_item_id = $1;', [id]);

    await client.query('COMMIT');
    return res.status(200).json({ success: true, cart_item_id: id });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// =====================================================================
// 5. ORDERS (Task 6: POST /api/orders) - ONE transaction, exact order
// =====================================================================
router.post('/orders', requireAuth, async (req, res, next) => {
  const { reservation_ids, address, coupon_code } = req.body;
  if (!reservation_ids || !Array.isArray(reservation_ids) || reservation_ids.length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'reservation_ids array required' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // a. UPDATE reservations SET status='confirmed' WHERE reservation_id=ANY($ids)
    //    AND user_id=$jwt AND status='reserved' AND expires_at>now()
    //    RETURNING reservation_id, offer_id, location_id, quantity, price_paise.
    //    count != requested count -> rollback, 409 RESERVATION_EXPIRED.
    const confirmSql = `
      UPDATE reservations
      SET status = 'confirmed'
      WHERE reservation_id = ANY($1::uuid[])
        AND user_id = $2
        AND status = 'reserved'
        AND expires_at > now()
      RETURNING reservation_id, offer_id, location_id, quantity, price_paise;
    `;
    const confirmRes = await client.query(confirmSql, [reservation_ids, req.user.user_id]);
    if (confirmRes.rowCount !== reservation_ids.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'RESERVATION_EXPIRED',
        message: 'One or more reservations have expired or are invalid'
      });
    }

    const confirmedReservations = confirmRes.rows;

    // b. PRICE CHECK: re-read dealer_offers.selling_price and compare against
    //    THAT RESERVATION'S price_paise. Any mismatch -> rollback 409
    //    PRICE_CHANGED{reservations:[{reservation_id,offer_id,current_price_paise}]}.
    //    cart_items.price_snapshot is display-only and is NEVER used here.
    //    The rollback leaves the reservation 'reserved'; the client releases it.
    const mismatches = [];
    for (const r of confirmedReservations) {
      const priceCheck = await client.query(
        'SELECT selling_price FROM dealer_offers WHERE offer_id = $1;',
        [r.offer_id]
      );
      const currentPrice = priceCheck.rows[0]?.selling_price;
      if (BigInt(currentPrice) !== BigInt(r.price_paise)) {
        mismatches.push({
          reservation_id: r.reservation_id,
          offer_id: r.offer_id,
          current_price_paise: Number(currentPrice)
        });
      }
    }

    if (mismatches.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'PRICE_CHANGED',
        message: 'Offer prices have changed since reservation',
        reservations: mismatches
      });
    }

    // Calculate line prices & items total
    let itemsTotal = 0n;
    const lines = confirmedReservations.map(r => {
      const linePrice = BigInt(r.price_paise) * BigInt(r.quantity);
      itemsTotal += linePrice;
      return {
        ...r,
        line_price: linePrice
      };
    });

    // d. Global discount allocation (floor + leftover in order_item_id order).
    //    In Phase 1 there is no PIN/mode yet: delivery_fee_total = 0 and every delivery_fee_share = 0.
    const discountTotal = 0n; // Phase 1 discount = 0
    const deliveryFeeTotal = 0n; // Phase 1 delivery fee = 0
    const totalAmount = itemsTotal - discountTotal + deliveryFeeTotal;

    // c. Insert orders
    const pinCode = address?.pin_code || null;
    const orderIns = await client.query(`
      INSERT INTO orders (user_id, items_total, discount_total, delivery_fee_total, total_amount, coupon_code, delivery_pin_code, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'placed')
      RETURNING order_id;
    `, [
      req.user.user_id,
      itemsTotal.toString(),
      discountTotal.toString(),
      deliveryFeeTotal.toString(),
      totalAmount.toString(),
      coupon_code || null,
      pinCode
    ]);
    const orderId = orderIns.rows[0].order_id;

    // Insert ONE order_item PER reservation: reservation_id (UNIQUE), stock_location_id from reservation, line_price = price_paise*quantity
    for (const line of lines) {
      const dealerRes = await client.query('SELECT dealer_id FROM dealer_offers WHERE offer_id = $1;', [line.offer_id]);
      const dealerId = dealerRes.rows[0].dealer_id;

      await client.query(`
        INSERT INTO order_items (
          order_id, reservation_id, offer_id, dealer_id,
          quantity, line_price, discount_share, delivery_fee_share,
          stock_location_id, item_status
        ) VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, 'placed');
      `, [
        orderId,
        line.reservation_id,
        line.offer_id,
        dealerId,
        line.quantity,
        line.line_price.toString(),
        line.location_id
      ]);
    }

    // e. Outbox 'order-placed' (key order_id). Commit.
    await client.query(`
      INSERT INTO outbox_events (event_type, aggregate_key, payload)
      VALUES ('order-placed', $1, $2);
    `, [orderId, JSON.stringify({ order_id: orderId, user_id: req.user.user_id, total_amount: totalAmount.toString() })]);

    await client.query('COMMIT');
    return res.status(201).json({
      order_id: orderId,
      total_amount: Number(totalAmount),
      delivery_fee_total: 0,
      status: 'placed'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

router.get('/orders/:id', requireAuth, async (req, res, next) => {
  const { id } = req.params;
  try {
    const ordRes = await query('SELECT * FROM orders WHERE order_id = $1;', [id]);
    if (ordRes.rowCount === 0) {
      return res.status(404).json({ error: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }
    const order = ordRes.rows[0];
    const isOwner = req.user.user_id === order.user_id || req.user.role === 'admin';
    if (!isOwner) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied' });
    }

    const items = await query('SELECT * FROM order_items WHERE order_id = $1;', [id]);
    const groups = await query('SELECT * FROM fulfilment_groups WHERE order_id = $1;', [id]);

    res.json({
      ...order,
      items: items.rows,
      groups: groups.rows
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
