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
  validateInvariants,
  FEE_QUICK_PAISE,
  FEE_STANDARD_PAISE,
  FEE_TRANSFER_PAISE
} = require('./fees');
const { computeEta } = require('./eta');
const { deriveOtp, hashOtpSubmission } = require('./otp');
const { hold_units, release_hold, restock_units } = require('../db/stock');
const { cancelOrderItem } = require('./cancel');
const { handleShoppingAssistant } = require('./assistant');

const router = express.Router();

// Try loading Agent C's searchService if available
let searchService = null;
try {
  searchService = require('../search');
} catch (e) {
  // Agent C develops in parallel; fallback provided below
}

// =====================================================================
// 1. AUTHENTICATION (POST /api/auth/login, GET /api/auth/me)
// =====================================================================
router.post('/auth/login', authRateLimiter, login);

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({
    user: {
      user_id: req.user.user_id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role
    }
  });
});

// =====================================================================
// 2. PRODUCTS & SEARCH
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

router.get('/products/compare', async (req, res, next) => {
  try {
    const { ids } = req.query;
    if (!ids) {
      return res.status(400).json({ error: 'INVALID_INPUT', message: 'ids parameter required' });
    }
    const idList = ids.split(',').map(s => s.trim()).filter(Boolean);
    if (idList.length === 0) {
      return res.json([]);
    }

    const sql = `
      SELECT p.*, c.category_name
      FROM products p
      JOIN categories c ON c.category_id = p.category_id
      WHERE p.product_id = ANY($1::uuid[]);
    `;
    const result = await query(sql, [idList]);
    res.json(result.rows);
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

router.get('/products/:id/related', async (req, res, next) => {
  try {
    const { id } = req.params;
    const prodRes = await query('SELECT category_id FROM products WHERE product_id = $1;', [id]);
    if (prodRes.rowCount === 0) {
      return res.status(404).json({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    }
    const catId = prodRes.rows[0].category_id;

    const sql = `
      SELECT p.*, c.category_name
      FROM products p
      JOIN categories c ON c.category_id = p.category_id
      WHERE p.category_id = $1 AND p.product_id != $2
      LIMIT 8;
    `;
    const related = await query(sql, [catId, id]);
    res.json(related.rows);
  } catch (err) {
    next(err);
  }
});

/**
 * 5-Tab Comparison: GET /api/products/:id/offers?category=budget|fastest|rated|value|available
 */
router.get('/products/:id/offers', async (req, res, next) => {
  const { id } = req.params;
  const { category = 'budget' } = req.query;

  try {
    let orderByClause = '';
    if (category === 'budget') {
      orderByClause = `ORDER BY selling_price ASC, effective_days ASC, dealer_rating DESC`;
    } else if (category === 'fastest') {
      orderByClause = `ORDER BY effective_days ASC, selling_price ASC`;
    } else if (category === 'rated') {
      orderByClause = `ORDER BY dealer_rating DESC, total_reviews DESC, selling_price ASC`;
    } else if (category === 'available') {
      orderByClause = `ORDER BY free_units DESC, selling_price ASC`;
    } else if (category === 'value') {
      orderByClause = `ORDER BY selling_price ASC`;
    } else {
      orderByClause = `ORDER BY selling_price ASC`;
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
        const scoreStock = 100;
        const totalScore = 0.45 * scorePrice + 0.25 * scoreDelivery + 0.20 * scoreRating + 0.10 * scoreStock;
        return { ...o, value_score: totalScore };
      });

      finalSorted.sort((a, b) => {
        if (b.value_score !== a.value_score) return b.value_score - a.value_score;
        return a.selling_price - b.selling_price;
      });
    }

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

/**
 * 30-Day Reference Price: GET /api/products/:id/price-history
 * Lowest selling_price in 30 days BEFORE current period, excluding current open row.
 */
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
        AND h.valid_to IS NOT NULL
        AND h.valid_from >= (now() - interval '30 days')
      GROUP BY h.offer_id, o.selling_price;
    `;
    const result = await query(sql, [id]);

    const mapped = result.rows.map(r => {
      const ref = BigInt(r.reference_price);
      const cur = BigInt(r.current_price);
      const showWas = ref > cur;
      return {
        offer_id: r.offer_id,
        current_price: Number(cur),
        reference_price: Number(ref),
        was_price: showWas ? Number(ref) : null,
        show_was_price: showWas
      };
    });

    res.json({
      product_id: id,
      offers: mapped
    });
  } catch (err) {
    next(err);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const { q, category, max_price, city, quick } = req.query;

    let sql = `
      SELECT 
        p.product_id, p.name as product_name, p.brand, c.category_name,
        o.offer_id, o.selling_price, o.eligible_modes, o.bangalore_delivery_days,
        d.dealer_id, d.shop_name, d.city as dealer_city, d.dealer_rating, d.total_reviews,
        COALESCE(SUM(CASE WHEN l.is_sellable THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0)::int as available_stock
      FROM products p
      JOIN categories c ON c.category_id = p.category_id
      JOIN dealer_offers o ON o.product_id = p.product_id AND o.status = 'active'
      JOIN dealers d ON d.dealer_id = o.dealer_id
      LEFT JOIN inventory i ON i.offer_id = o.offer_id
      LEFT JOIN stock_locations l ON l.location_id = i.location_id
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`;
    }

    if (category) {
      params.push(category);
      sql += ` AND c.category_name = $${params.length}`;
    }

    if (max_price) {
      params.push(BigInt(max_price).toString());
      sql += ` AND o.selling_price <= $${params.length}`;
    }

    if (city) {
      params.push(city);
      sql += ` AND d.city ILIKE $${params.length}`;
    }

    if (quick === 'true') {
      sql += ` AND 'quick' = ANY(o.eligible_modes)`;
    }

    sql += `
      GROUP BY p.product_id, c.category_name, o.offer_id, d.dealer_id
      HAVING COALESCE(SUM(CASE WHEN l.is_sellable THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0) > 0
      ORDER BY o.selling_price ASC;
    `;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// 3. FULFILMENT & PIN CHECK
// =====================================================================
router.post('/check-pin', async (req, res, next) => {
  const { pin_code } = req.body;
  if (!pin_code) {
    return res.status(400).json({ error: 'INVALID_PIN', message: 'pin_code required' });
  }

  try {
    const hubSql = `
      SELECT h.hub_id, h.location_id, h.active, h.hours, h.order_capacity, h.delivery_radius_km
      FROM hub_service_areas a
      JOIN fulfilment_hubs h ON h.hub_id = a.hub_id
      WHERE a.pin_code = $1;
    `;
    const hubRes = await query(hubSql, [pin_code.trim()]);

    if (hubRes.rowCount === 0) {
      return res.json({
        quick_available: false,
        standard_available: true,
        hub_id: null,
        message: 'Standard delivery only for this PIN'
      });
    }

    const hub = hubRes.rows[0];

    // Check active
    if (!hub.active) {
      return res.json({
        quick_available: false,
        standard_available: true,
        hub_id: hub.hub_id,
        reason: 'Hub currently paused'
      });
    }

    // Check hours
    const bypassHours = req.headers['x-bypass-hours'] === 'true' || process.env.IGNORE_HUB_HOURS === 'true';
    const inHours = isWithinHubHours(hub.hours, bypassHours);
    if (!inHours) {
      return res.json({
        quick_available: false,
        standard_available: true,
        hub_id: hub.hub_id,
        reason: 'Outside hub operating hours'
      });
    }

    // Check capacity
    const capSql = `
      SELECT count(*)::int as active_groups
      FROM fulfilment_groups
      WHERE location_id = $1
        AND status IN ('order_accepted', 'picked', 'packed')
        AND created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata');
    `;
    const capRes = await query(capSql, [hub.location_id]);
    const currentQueue = capRes.rows[0]?.active_groups || 0;

    if (currentQueue >= hub.order_capacity) {
      return res.json({
        quick_available: false,
        standard_available: true,
        hub_id: hub.hub_id,
        reason: 'Hub is currently at peak capacity'
      });
    }

    return res.json({
      quick_available: true,
      standard_available: true,
      hub_id: hub.hub_id
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// 4. CART & RESERVATIONS
// =====================================================================
router.post('/cart/items', requireAuth, async (req, res, next) => {
  const { offer_id, quantity = 1 } = req.body;
  if (!offer_id) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'offer_id required' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    let cartRes = await client.query('SELECT cart_id FROM carts WHERE user_id = $1;', [req.user.user_id]);
    let cartId;
    if (cartRes.rowCount === 0) {
      const newCart = await client.query(
        'INSERT INTO carts (user_id) VALUES ($1) RETURNING cart_id;',
        [req.user.user_id]
      );
      cartId = newCart.rows[0].cart_id;
    } else {
      cartId = cartRes.rows[0].cart_id;
    }

    const offerRes = await client.query(
      'SELECT selling_price, status FROM dealer_offers WHERE offer_id = $1;',
      [offer_id]
    );
    if (offerRes.rowCount === 0 || offerRes.rows[0].status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OFFER_NOT_AVAILABLE', message: 'Offer not found or inactive' });
    }
    const priceSnapshot = offerRes.rows[0].selling_price;

    const itemSql = `
      INSERT INTO cart_items (cart_id, offer_id, quantity, price_snapshot)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (cart_id, offer_id) DO UPDATE 
        SET quantity = cart_items.quantity + EXCLUDED.quantity,
            price_snapshot = EXCLUDED.price_snapshot
      RETURNING cart_item_id, cart_id, offer_id, quantity, price_snapshot;
    `;
    const itemRes = await client.query(itemSql, [cartId, offer_id, quantity, priceSnapshot]);

    await client.query('COMMIT');
    res.status(201).json(itemRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

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

router.patch('/cart/items/:id', requireAuth, async (req, res, next) => {
  const { id } = req.params;
  const { quantity, saved_for_later } = req.body;

  try {
    const updates = [];
    const params = [id, req.user.user_id];

    if (quantity !== undefined) {
      if (quantity <= 0) {
        return res.status(400).json({ error: 'INVALID_QUANTITY', message: 'Quantity must be > 0' });
      }
      params.push(quantity);
      updates.push(`quantity = $${params.length}`);
    }

    if (saved_for_later !== undefined) {
      params.push(Boolean(saved_for_later));
      updates.push(`saved_for_later = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'NO_UPDATES', message: 'No valid update fields' });
    }

    const sql = `
      UPDATE cart_items ci
      SET ${updates.join(', ')}
      FROM carts c
      WHERE ci.cart_item_id = $1 AND c.cart_id = ci.cart_id AND c.user_id = $2
      RETURNING ci.*;
    `;
    const result = await query(sql, params);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ITEM_NOT_FOUND', message: 'Cart item not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/cart/reserve', requireAuth, async (req, res, next) => {
  const { cart_item_id, offer_id, location_id, quantity = 1, request_key } = req.body;
  if (!offer_id || !request_key) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'offer_id and request_key are required' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    let targetLocationId = location_id;
    if (targetLocationId) {
      const locCheck = await client.query(`
        SELECT (quantity - reserved_quantity) as free_units
        FROM inventory i
        JOIN stock_locations l ON l.location_id = i.location_id
        WHERE i.offer_id = $1 AND i.location_id = $2 AND l.is_sellable = true;
      `, [offer_id, targetLocationId]);

      if (locCheck.rowCount === 0 || locCheck.rows[0].free_units < quantity) {
        targetLocationId = null;
      }
    }

    if (!targetLocationId) {
      const bglrRes = await client.query(`
        SELECT i.location_id, (i.quantity - i.reserved_quantity) as free_units
        FROM inventory i
        JOIN stock_locations l ON l.location_id = i.location_id
        WHERE i.offer_id = $1 AND l.is_home = true AND l.is_sellable = true
        ORDER BY (i.quantity - i.reserved_quantity) DESC
        LIMIT 1;
      `, [offer_id]);

      if (bglrRes.rowCount > 0 && bglrRes.rows[0].free_units >= quantity) {
        targetLocationId = bglrRes.rows[0].location_id;
      }
    }

    if (!targetLocationId) {
      const anySellable = await client.query(`
        SELECT i.location_id, (i.quantity - i.reserved_quantity) as free_units
        FROM inventory i
        JOIN stock_locations l ON l.location_id = i.location_id
        WHERE i.offer_id = $1 AND l.is_sellable = true
        ORDER BY (i.quantity - i.reserved_quantity) DESC
        LIMIT 1;
      `, [offer_id]);

      if (anySellable.rowCount > 0 && anySellable.rows[0].free_units >= quantity) {
        targetLocationId = anySellable.rows[0].location_id;
      }
    }

    if (!targetLocationId) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'OUT_OF_STOCK', message: 'Offer is out of stock across sellable locations' });
    }

    const reserveSql = `SELECT * FROM reserve_offer($1, $2, $3, $4, $5, $6);`;
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
// 5. COUPONS (FEATURE_COUPONS)
// =====================================================================
router.post('/coupons/validate', requireAuth, async (req, res, next) => {
  const { code, basket_total_paise } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'code required' });
  }

  try {
    const coupRes = await query(`
      SELECT * FROM coupons 
      WHERE code = $1 AND active = true AND (expires_at IS NULL OR expires_at > now());
    `, [code.toUpperCase().trim()]);

    if (coupRes.rowCount === 0) {
      return res.status(404).json({ error: 'COUPON_NOT_FOUND', message: 'Invalid or expired coupon' });
    }

    const coupon = coupRes.rows[0];
    const basketTotal = BigInt(basket_total_paise || 0);

    if (coupon.min_order_paise && basketTotal < BigInt(coupon.min_order_paise)) {
      return res.status(400).json({
        error: 'MIN_ORDER_NOT_MET',
        message: `Minimum order amount of Rs.${Math.round(coupon.min_order_paise / 100)} required`
      });
    }

    const usageRes = await query(`
      SELECT count FROM coupon_customer_usage WHERE coupon_id = $1 AND user_id = $2;
    `, [coupon.coupon_id, req.user.user_id]);

    const usedCount = usageRes.rows[0]?.count || 0;
    if (usedCount >= coupon.max_uses_per_customer) {
      return res.status(409).json({ error: 'PER_CUSTOMER_LIMIT_REACHED', message: 'Coupon usage limit reached for this account' });
    }

    res.json({
      valid: true,
      coupon_id: coupon.coupon_id,
      code: coupon.code,
      discount_percent: coupon.discount_percent,
      discount_paise: coupon.discount_paise ? Number(coupon.discount_paise) : null
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// 6. ORDERS & CHECKOUT (Phase 2 Full: Grouping, Modes, Fees, ETA, OTP)
// =====================================================================
router.post('/orders', requireAuth, async (req, res, next) => {
  const { reservation_ids, address, mode_preferences = {}, coupon_code } = req.body;
  if (!reservation_ids || !Array.isArray(reservation_ids) || reservation_ids.length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'reservation_ids array required' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. UPDATE reservations to 'confirmed'
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

    // 2. Price Check
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

    // 3. Serviceability & PIN Check
    const pinCode = (address?.pin_code || '560001').trim();
    const hubSql = `
      SELECT h.hub_id, h.location_id, h.active, h.hours, h.order_capacity
      FROM hub_service_areas a
      JOIN fulfilment_hubs h ON h.hub_id = a.hub_id
      WHERE a.pin_code = $1;
    `;
    const hubRes = await client.query(hubSql, [pinCode]);
    const hubInfo = hubRes.rows[0] || null;

    // Check quick eligibility for PIN
    let pinQuickAvailable = false;
    const bypassHours = req.headers['x-bypass-hours'] === 'true' || process.env.IGNORE_HUB_HOURS === 'true';
    if (hubInfo && hubInfo.active && isWithinHubHours(hubInfo.hours, bypassHours)) {
      const capSql = `
        SELECT count(*)::int as active_groups
        FROM fulfilment_groups
        WHERE location_id = $1 AND status IN ('order_accepted', 'picked', 'packed')
          AND created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata');
      `;
      const capRes = await client.query(capSql, [hubInfo.location_id]);
      if ((capRes.rows[0]?.active_groups || 0) < hubInfo.order_capacity) {
        pinQuickAvailable = true;
      }
    }

    // 4. Derive mode for each reservation & prepare grouping
    // Grouping key = (location_id, mode)
    const lineItems = [];
    let itemsTotal = 0n;

    for (const r of confirmedReservations) {
      const linePrice = BigInt(r.price_paise) * BigInt(r.quantity);
      itemsTotal += linePrice;

      const metaRes = await client.query(`
        SELECT l.location_id, l.is_home, l.is_sellable, o.eligible_modes, o.dealer_id, o.transfer_days_max
        FROM stock_locations l
        JOIN dealer_offers o ON o.offer_id = $1
        WHERE l.location_id = $2;
      `, [r.offer_id, r.location_id]);

      const meta = metaRes.rows[0];
      const preferredMode = mode_preferences[r.reservation_id];

      let mode = 'standard';
      if (preferredMode === 'quick') {
        if (!pinQuickAvailable || !meta.eligible_modes.includes('quick')) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'QUICK_NOT_AVAILABLE',
            message: `Quick delivery is not available for reservation ${r.reservation_id}`
          });
        }
        mode = 'quick';
      } else if (!meta.is_home) {
        mode = 'transfer';
      } else {
        mode = 'standard';
      }

      lineItems.push({
        ...r,
        dealer_id: meta.dealer_id,
        line_price: linePrice,
        mode,
        is_home: meta.is_home,
        transfer_days_max: meta.transfer_days_max || 3,
        groupKey: `${r.location_id}::${mode}`
      });
    }

    // 5. Coupon Handling (Atomic limits)
    let discountTotal = 0n;
    let validCouponId = null;

    if (coupon_code) {
      const coupRes = await client.query(`
        SELECT * FROM coupons 
        WHERE code = $1 AND active = true AND (expires_at IS NULL OR expires_at > now());
      `, [coupon_code.toUpperCase().trim()]);

      if (coupRes.rowCount > 0) {
        const coupon = coupRes.rows[0];
        if (!coupon.min_order_paise || itemsTotal >= BigInt(coupon.min_order_paise)) {
          // Check per customer usage
          const usageRes = await client.query(
            'SELECT count FROM coupon_customer_usage WHERE coupon_id = $1 AND user_id = $2;',
            [coupon.coupon_id, req.user.user_id]
          );
          const used = usageRes.rows[0]?.count || 0;
          if (used >= coupon.max_uses_per_customer) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'PER_CUSTOMER_LIMIT_REACHED', message: 'Coupon limit reached' });
          }

          // Conditional global update
          const updCoupon = await client.query(`
            UPDATE coupons
            SET redeemed_count = redeemed_count + 1
            WHERE coupon_id = $1 AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
            RETURNING 1;
          `, [coupon.coupon_id]);

          if (updCoupon.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'COUPON_LIMIT_REACHED', message: 'Coupon redemption limit reached' });
          }

          // Upsert customer usage
          await client.query(`
            INSERT INTO coupon_customer_usage (coupon_id, user_id, count)
            VALUES ($1, $2, 1)
            ON CONFLICT (coupon_id, user_id) DO UPDATE SET count = coupon_customer_usage.count + 1;
          `, [coupon.coupon_id, req.user.user_id]);

          // Compute discount
          if (coupon.discount_percent) {
            discountTotal = (itemsTotal * BigInt(coupon.discount_percent)) / 100n;
          } else if (coupon.discount_paise) {
            discountTotal = BigInt(coupon.discount_paise);
          }
          if (discountTotal > itemsTotal) discountTotal = itemsTotal;
          validCouponId = coupon.coupon_id;
        }
      }
    }

    // Global discount allocation across items
    const discountMap = allocate(discountTotal, lineItems.map(it => ({ id: it.reservation_id, amount: it.line_price })));
    lineItems.forEach(it => {
      it.discount_share = discountMap.get(it.reservation_id) || 0n;
    });

    // 6. Grouping and Delivery Fee Allocation
    const groupBuckets = new Map();
    for (const item of lineItems) {
      if (!groupBuckets.has(item.groupKey)) {
        groupBuckets.set(item.groupKey, {
          location_id: item.location_id,
          mode: item.mode,
          transfer_days_max: item.transfer_days_max,
          items: []
        });
      }
      groupBuckets.get(item.groupKey).items.push(item);
    }

    let deliveryFeeTotal = 0n;
    const groupsSummary = [];

    // Calculate group fees and item fee shares
    for (const [key, grp] of groupBuckets.entries()) {
      const groupBasketTotal = grp.items.reduce((acc, it) => acc + it.line_price, 0n);
      const fee = calculateGroupFee(grp.mode, groupBasketTotal);
      grp.fee_total = fee;
      deliveryFeeTotal += fee;

      const feeMap = allocate(fee, grp.items.map(it => ({ id: it.reservation_id, amount: it.line_price })));
      grp.items.forEach(it => {
        it.delivery_fee_share = feeMap.get(it.reservation_id) || 0n;
      });
    }

    const totalAmount = itemsTotal - discountTotal + deliveryFeeTotal;

    // 7. Insert orders row
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

    // 8. Insert fulfilment_groups and order_items
    for (const [key, grp] of groupBuckets.entries()) {
      const eta = await computeEta(client, {
        mode: grp.mode,
        locationId: grp.location_id,
        transferDaysMax: grp.transfer_days_max
      });

      const initialStatus = grp.mode === 'transfer' ? 'reserved_at_origin' : 'order_accepted';

      // Insert group first with placeholder otp_hash
      const grpIns = await client.query(`
        INSERT INTO fulfilment_groups (
          order_id, location_id, mode, status, fee_total,
          eta_window_start, eta_window_end, eta_basis, otp_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'placeholder')
        RETURNING group_id;
      `, [
        orderId,
        grp.location_id,
        grp.mode,
        initialStatus,
        grp.fee_total.toString(),
        eta.windowStart,
        eta.windowEnd,
        JSON.stringify(eta.basis)
      ]);
      const groupId = grpIns.rows[0].group_id;

      // Derive deterministic OTP & hash
      const { code: otpCode, otp_hash } = deriveOtp(groupId);
      await client.query('UPDATE fulfilment_groups SET otp_hash = $1 WHERE group_id = $2;', [otp_hash, groupId]);

      // Insert order items for this group
      for (const it of grp.items) {
        const itemIns = await client.query(`
          INSERT INTO order_items (
            order_id, group_id, reservation_id, offer_id, dealer_id,
            quantity, line_price, discount_share, delivery_fee_share,
            stock_location_id, promised_delivery_start, promised_delivery_end, item_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'placed')
          RETURNING order_item_id;
        `, [
          orderId,
          groupId,
          it.reservation_id,
          it.offer_id,
          it.dealer_id,
          it.quantity,
          it.line_price.toString(),
          it.discount_share.toString(),
          it.delivery_fee_share.toString(),
          it.location_id,
          eta.windowStart,
          eta.windowEnd
        ]);
        const orderItemId = itemIns.rows[0].order_item_id;

        // If transfer mode, create stock_transfers record
        if (grp.mode === 'transfer') {
          // Destination is Bangalore Central Warehouse
          const whRes = await client.query('SELECT location_id FROM stock_locations WHERE is_home = true LIMIT 1;');
          const toLocId = whRes.rows[0]?.location_id || grp.location_id;

          await client.query(`
            INSERT INTO stock_transfers (order_item_id, group_id, offer_id, from_location_id, to_location_id, quantity, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'requested');
          `, [orderItemId, groupId, it.offer_id, it.location_id, toLocId, it.quantity]);
        }
      }

      groupsSummary.push({
        group_id: groupId,
        mode: grp.mode,
        location_id: grp.location_id,
        fee_total: Number(grp.fee_total),
        eta_window_start: eta.windowStart,
        eta_window_end: eta.windowEnd
      });
    }

    // 9. Insert coupon redemption record if applied
    if (validCouponId && discountTotal > 0n) {
      await client.query(`
        INSERT INTO coupon_redemptions (coupon_id, order_id, user_id, discount_paise)
        VALUES ($1, $2, $3, $4);
      `, [validCouponId, orderId, req.user.user_id, discountTotal.toString()]);
    }

    // 10. Simulated Payment
    await client.query(`
      INSERT INTO payments (order_id, amount, method, status, gateway_ref)
      VALUES ($1, $2, 'sandbox_upi', 'successful', 'sim_pay_' || gen_random_uuid());
    `, [orderId, totalAmount.toString()]);

    // 11. Outbox Event: 'order-placed' (key = order_id)
    await client.query(`
      INSERT INTO outbox_events (event_type, aggregate_key, payload)
      VALUES ('order-placed', $1, $2);
    `, [orderId, JSON.stringify({ order_id: orderId, user_id: req.user.user_id, total_amount: totalAmount.toString() })]);

    await client.query('COMMIT');

    return res.status(201).json({
      order_id: orderId,
      total_amount: Number(totalAmount),
      delivery_fee_total: Number(deliveryFeeTotal),
      groups: groupsSummary,
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
    const isOwner = req.user.user_id === order.user_id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied' });
    }

    const items = await query('SELECT * FROM order_items WHERE order_id = $1;', [id]);
    const groups = await query('SELECT * FROM fulfilment_groups WHERE order_id = $1;', [id]);

    const enrichedGroups = groups.rows.map(g => {
      // Include delivery_otp for owning customer while group is undelivered
      let deliveryOtp = null;
      let otpLabel = null;
      if (isOwner && !['delivered', 'cancelled'].includes(g.status)) {
        deliveryOtp = deriveOtp(g.group_id).code;
        otpLabel = 'SAMPLE DEMO OTP';
      }
      return {
        ...g,
        fee_total: Number(g.fee_total),
        delivery_otp: deliveryOtp,
        delivery_otp_label: otpLabel
      };
    });

    res.json({
      ...order,
      items_total: Number(order.items_total),
      discount_total: Number(order.discount_total),
      delivery_fee_total: Number(order.delivery_fee_total),
      total_amount: Number(order.total_amount),
      items: items.rows.map(it => ({
        ...it,
        line_price: Number(it.line_price),
        discount_share: Number(it.discount_share),
        delivery_fee_share: Number(it.delivery_fee_share),
        item_paid_amount: Number(it.item_paid_amount),
        paid_amount: Number(it.paid_amount)
      })),
      groups: enrichedGroups
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// 7. AFTER-SALES & REAL CANCELLATION (Phase 2 Task 1)
// =====================================================================
router.post('/orders/:id/items/:orderItemId/cancel', requireAuth, async (req, res, next) => {
  const { id: orderId, orderItemId } = req.params;
  const { request_key } = req.body;

  try {
    const outcome = await cancelOrderItem(orderId, orderItemId, req.user.user_id, request_key);
    res.status(outcome.status).json(outcome.data);
  } catch (err) {
    if (err.code === 'ALREADY_CANCELLED_OR_TOO_LATE' || err.status === 409) {
      return res.status(409).json({ error: 'ALREADY_CANCELLED_OR_TOO_LATE', message: err.message });
    }
    if (err.status) {
      return res.status(err.status).json({ error: err.code || 'ERROR', message: err.message });
    }
    next(err);
  }
});

// =====================================================================
// 8. ADMIN & SIMULATOR ENDPOINTS (Admin role required)
// =====================================================================
router.post('/admin/refunds/:id/credit', requireAdmin, async (req, res, next) => {
  const { id } = req.params;
  const { gateway_ref } = req.body;

  try {
    const refRes = await query('SELECT order_item_id FROM refunds WHERE refund_id = $1;', [id]);
    if (refRes.rowCount === 0) {
      return res.status(404).json({ error: 'REFUND_NOT_FOUND', message: 'Refund not found' });
    }
    const { order_item_id } = refRes.rows[0];

    const outRes = await query(`
      INSERT INTO outbox_events (event_type, aggregate_key, payload)
      VALUES ('refund-credit-requested', $1, $2)
      RETURNING event_id;
    `, [
      order_item_id,
      JSON.stringify({
        refund_id: id,
        order_item_id,
        gateway_ref: gateway_ref || 'sim_gw_credit'
      })
    ]);

    res.status(202).json({ event_id: outRes.rows[0].event_id, status: 'accepted' });
  } catch (err) {
    next(err);
  }
});

router.get('/admin/groups/:id/demo-otp', requireAdmin, async (req, res, next) => {
  const { id } = req.params;
  try {
    const grpRes = await query('SELECT group_id FROM fulfilment_groups WHERE group_id = $1;', [id]);
    if (grpRes.rowCount === 0) {
      return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'Fulfilment group not found' });
    }

    const { code } = deriveOtp(id);
    res.json({
      group_id: id,
      demo_otp: code,
      sample: true,
      label: 'SAMPLE DEMO OTP'
    });
  } catch (err) {
    next(err);
  }
});

const ALLOWED_SIM_EVENTS = [
  'order_accepted', 'picked', 'packed', 'allocated',
  'in_transit', 'received_checked', 'picked_up',
  'out_for_delivery', 'otp_verified', 'delivered', 'cancelled'
];

router.post('/simulator/fire-event', requireAdmin, async (req, res, next) => {
  const { group_id, event_type, otp } = req.body;
  if (!group_id || !event_type || !ALLOWED_SIM_EVENTS.includes(event_type)) {
    return res.status(400).json({ error: 'INVALID_EVENT', message: 'Valid group_id and allowed event_type required' });
  }

  try {
    if (event_type === 'otp_verified') {
      if (!otp) {
        return res.status(400).json({ error: 'OTP_REQUIRED', message: 'otp required for otp_verified event' });
      }
      const otp_proof = hashOtpSubmission(otp);

      const outRes = await query(`
        INSERT INTO outbox_events (event_type, aggregate_key, payload)
        VALUES ('fulfilment-status-updated', $1, $2)
        RETURNING event_id;
      `, [group_id, JSON.stringify({ group_id, event_type, otp_proof })]);

      return res.status(202).json({ event_id: outRes.rows[0].event_id, status: 'accepted' });
    }

    const outRes = await query(`
      INSERT INTO outbox_events (event_type, aggregate_key, payload)
      VALUES ('fulfilment-status-updated', $1, $2)
      RETURNING event_id;
    `, [group_id, JSON.stringify({ group_id, event_type })]);

    await query('UPDATE fulfilment_groups SET status = $1 WHERE group_id = $2;', [event_type, group_id]);
    if (event_type === 'delivered') {
      await query("UPDATE order_items SET item_status = 'delivered', delivered_at = now() WHERE group_id = $1;", [group_id]);
    }

    res.status(202).json({ event_id: outRes.rows[0].event_id, status: 'accepted' });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/hubs/:id/status', requireAdmin, async (req, res, next) => {
  const { id } = req.params;
  const { active } = req.body;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const hubUpd = await client.query(
      'UPDATE fulfilment_hubs SET active = $1 WHERE hub_id = $2 RETURNING location_id;',
      [Boolean(active), id]
    );

    if (hubUpd.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'HUB_NOT_FOUND', message: 'Hub not found' });
    }
    const locId = hubUpd.rows[0].location_id;

    // Trigger bumped revisions; emit inventory-updated for each stocked offer
    const stockedOffers = await client.query(
      'SELECT DISTINCT offer_id FROM inventory WHERE location_id = $1;',
      [locId]
    );

    for (const o of stockedOffers.rows) {
      await client.query(`
        INSERT INTO outbox_events (event_type, aggregate_key, payload)
        VALUES ('inventory-updated', $1, $2);
      `, [o.offer_id, JSON.stringify({ offer_id: o.offer_id, location_id: locId })]);
    }

    // Emit eta-updated for active groups
    const activeGroups = await client.query(
      "SELECT group_id FROM fulfilment_groups WHERE location_id = $1 AND status NOT IN ('delivered','cancelled');",
      [locId]
    );

    for (const g of activeGroups.rows) {
      await client.query(`
        INSERT INTO outbox_events (event_type, aggregate_key, payload)
        VALUES ('eta-updated', $1, $2);
      `, [g.group_id, JSON.stringify({ group_id: g.group_id, hub_id: id, active })]);
    }

    await client.query('COMMIT');
    res.json({
      hub_id: id,
      active: Boolean(active),
      affected_offers: stockedOffers.rowCount,
      affected_groups: activeGroups.rowCount
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

router.get('/admin/live-proof', requireAdmin, async (req, res, next) => {
  try {
    const outbox = await query('SELECT * FROM outbox_events ORDER BY created_at DESC LIMIT 10;');
    const processed = await query('SELECT * FROM processed_events ORDER BY processed_at DESC LIMIT 10;');
    const revisions = await query('SELECT * FROM offer_state_versions ORDER BY updated_at DESC LIMIT 10;');
    res.json({
      outbox_events: outbox.rows,
      processed_events: processed.rows,
      offer_revisions: revisions.rows
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// 9. USER ENGAGEMENT & OPTIONAL FEATURES
// =====================================================================
// Wishlist
router.get('/wishlist', requireAuth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT w.wishlist_id, w.created_at, p.*, c.category_name
      FROM user_wishlist w
      JOIN products p ON p.product_id = w.product_id
      JOIN categories c ON c.category_id = p.category_id
      WHERE w.user_id = $1;
    `, [req.user.user_id]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/wishlist/toggle', requireAuth, async (req, res, next) => {
  const { product_id } = req.body;
  if (!product_id) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'product_id required' });
  }

  try {
    const exist = await query(
      'SELECT wishlist_id FROM user_wishlist WHERE user_id = $1 AND product_id = $2;',
      [req.user.user_id, product_id]
    );

    if (exist.rowCount > 0) {
      await query('DELETE FROM user_wishlist WHERE wishlist_id = $1;', [exist.rows[0].wishlist_id]);
      return res.json({ wishlisted: false, product_id });
    } else {
      await query(
        'INSERT INTO user_wishlist (user_id, product_id) VALUES ($1, $2);',
        [req.user.user_id, product_id]
      );
      return res.json({ wishlisted: true, product_id });
    }
  } catch (err) {
    next(err);
  }
});

// Recently Viewed (Capped at 8)
router.get('/recently-viewed', requireAuth, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT rv.viewed_at, p.*, c.category_name
      FROM recently_viewed rv
      JOIN products p ON p.product_id = rv.product_id
      JOIN categories c ON c.category_id = p.category_id
      WHERE rv.user_id = $1
      ORDER BY rv.viewed_at DESC
      LIMIT 8;
    `, [req.user.user_id]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/recently-viewed', requireAuth, async (req, res, next) => {
  const { product_id } = req.body;
  if (!product_id) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'product_id required' });
  }

  try {
    await query(`
      INSERT INTO recently_viewed (user_id, product_id, viewed_at)
      VALUES ($1, $2, now())
      ON CONFLICT (user_id, product_id) DO UPDATE SET viewed_at = now();
    `, [req.user.user_id, product_id]);
    res.json({ success: true, product_id });
  } catch (err) {
    next(err);
  }
});

// Addresses CRUD
router.get('/addresses', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM customer_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC;',
      [req.user.user_id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/addresses', requireAuth, async (req, res, next) => {
  const { label, recipient_name, phone, address_line1, address_line2, pin_code, city, state, is_default } = req.body;
  if (!pin_code || !address_line1 || !recipient_name) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'recipient_name, address_line1, and pin_code required' });
  }

  try {
    const sql = `
      INSERT INTO customer_addresses (
        user_id, label, recipient_name, phone, address_line1, address_line2,
        pin_code, city, state, is_default
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;
    const result = await query(sql, [
      req.user.user_id,
      label || 'Home',
      recipient_name,
      phone || null,
      address_line1,
      address_line2 || null,
      pin_code,
      city || 'Bangalore',
      state || 'Karnataka',
      Boolean(is_default)
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/addresses/:id', requireAuth, async (req, res, next) => {
  const { id } = req.params;
  try {
    const result = await query(
      'DELETE FROM customer_addresses WHERE address_id = $1 AND user_id = $2 RETURNING address_id;',
      [id, req.user.user_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ADDRESS_NOT_FOUND', message: 'Address not found' });
    }
    res.json({ success: true, address_id: id });
  } catch (err) {
    next(err);
  }
});

// Notifications
router.get('/notifications', requireAuth, async (req, res, next) => {
  try {
    const { unread } = req.query;
    let sql = 'SELECT * FROM notifications WHERE user_id = $1';
    const params = [req.user.user_id];
    if (unread === 'true') {
      sql += ' AND read_at IS NULL';
    }
    sql += ' ORDER BY created_at DESC LIMIT 20;';
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// 10. SHOPPING ASSISTANT (FEATURE_ASSISTANT)
// =====================================================================
router.post('/shopping-assistant', requireAuth, handleShoppingAssistant);

module.exports = router;
