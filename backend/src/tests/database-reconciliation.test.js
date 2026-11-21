const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');

const PG_URI = process.env.PG_URI;

function getPool() {
  if (!PG_URI) {
    throw new Error('PG_URI environment variable not set. Cannot run integration tests against Aiven PostgreSQL.');
  }
  return new Pool({ connectionString: PG_URI });
}

test('Database reconciliation: inventory.quantity >= reserved_quantity for all rows', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const res = await pool.query(
      `SELECT offer_id, location_id, quantity, reserved_quantity
       FROM inventory
       WHERE reserved_quantity > quantity`
    );
    assert.strictEqual(res.rowCount, 0, 'No inventory row should have reserved_quantity > quantity');
  } finally {
    await pool.end();
  }
});

test('Database reconciliation: reservations reference existing offers, locations, and users', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const res = await pool.query(
      `SELECT r.reservation_id
       FROM reservations r
       LEFT JOIN dealer_offers o ON r.offer_id = o.offer_id
       LEFT JOIN stock_locations l ON r.location_id = l.location_id
       LEFT JOIN users u ON r.user_id = u.user_id
       WHERE o.offer_id IS NULL OR l.location_id IS NULL OR u.user_id IS NULL`
    );
    assert.strictEqual(res.rowCount, 0, 'All reservations must reference valid offers, locations, and users');
  } finally {
    await pool.end();
  }
});

test('Database reconciliation: order_items reference valid reservations and offers', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const res = await pool.query(
      `SELECT oi.order_item_id
       FROM order_items oi
       LEFT JOIN reservations r ON oi.reservation_id = r.reservation_id
       LEFT JOIN dealer_offers o ON oi.offer_id = o.offer_id
       LEFT JOIN dealers d ON oi.dealer_id = d.dealer_id
       LEFT JOIN stock_locations l ON oi.stock_location_id = l.location_id
       WHERE r.reservation_id IS NULL OR o.offer_id IS NULL OR d.dealer_id IS NULL OR l.location_id IS NULL`
    );
    assert.strictEqual(res.rowCount, 0, 'All order_items must reference valid reservations, offers, dealers, and locations');
  } finally {
    await pool.end();
  }
});

test('Database reconciliation: stock_transfers reference valid order_items, offers, and locations', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const res = await pool.query(
      `SELECT st.transfer_id
       FROM stock_transfers st
       LEFT JOIN order_items oi ON st.order_item_id = oi.order_item_id
       LEFT JOIN dealer_offers o ON st.offer_id = o.offer_id
       LEFT JOIN stock_locations fl ON st.from_location_id = fl.location_id
       LEFT JOIN stock_locations tl ON st.to_location_id = tl.location_id
       LEFT JOIN fulfilment_groups fg ON st.group_id = fg.group_id
       WHERE oi.order_item_id IS NULL OR o.offer_id IS NULL OR fl.location_id IS NULL OR tl.location_id IS NULL`
    );
    assert.strictEqual(res.rowCount, 0, 'All stock_transfers must reference valid order_items, offers, and locations');
  } finally {
    await pool.end();
  }
});

test('Database reconciliation: fulfilment_groups reference valid orders and locations', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const res = await pool.query(
      `SELECT fg.group_id
       FROM fulfilment_groups fg
       LEFT JOIN orders o ON fg.order_id = o.order_id
       LEFT JOIN stock_locations l ON fg.location_id = l.location_id
       WHERE o.order_id IS NULL OR (fg.location_id IS NOT NULL AND l.location_id IS NULL)`
    );
    assert.strictEqual(res.rowCount, 0, 'All fulfilment_groups must reference valid orders and locations');
  } finally {
    await pool.end();
  }
});

test('Database reconciliation: refunds reference valid order_items', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const res = await pool.query(
      `SELECT r.refund_id
       FROM refunds r
       LEFT JOIN order_items oi ON r.order_item_id = oi.order_item_id
       WHERE oi.order_item_id IS NULL`
    );
    assert.strictEqual(res.rowCount, 0, 'All refunds must reference valid order_items');
  } finally {
    await pool.end();
  }
});

test('Database reconciliation: offer_price_history valid_to > valid_from', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const res = await pool.query(
      `SELECT history_id FROM offer_price_history WHERE valid_to IS NOT NULL AND valid_to <= valid_from`
    );
    assert.strictEqual(res.rowCount, 0, 'All price history intervals must have valid_to > valid_from');
  } finally {
    await pool.end();
  }
});

test('Database reconciliation: offer_state_versions revision >= 1', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const res = await pool.query(`SELECT offer_id FROM offer_state_versions WHERE revision < 1`);
    assert.strictEqual(res.rowCount, 0, 'All offer revisions must be >= 1');
  } finally {
    await pool.end();
  }
});

test('Database reconciliation: stock_transfers status transitions follow state machine', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const res = await pool.query(
      `SELECT transfer_id, status FROM stock_transfers
       WHERE status NOT IN ('requested','in_transit','received_checked','allocated','cancelled_at_origin','restocked_bangalore')`
    );
    assert.strictEqual(res.rowCount, 0, 'All stock_transfers must have valid status values');
  } finally {
    await pool.end();
  }
});

test('Database reconciliation: reservations status follows state machine', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const res = await pool.query(
      `SELECT reservation_id, status FROM reservations
       WHERE status NOT IN ('reserved','confirmed','expired','released')`
    );
    assert.strictEqual(res.rowCount, 0, 'All reservations must have valid status values');
  } finally {
    await pool.end();
  }
});

test('Database reconciliation: order_items item_status follows state machine', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const res = await pool.query(
      `SELECT order_item_id, item_status FROM order_items
       WHERE item_status NOT IN ('placed','confirmed','cancelled','delivered')`
    );
    assert.strictEqual(res.rowCount, 0, 'All order_items must have valid item_status values');
  } finally {
    await pool.end();
  }
});

test('Database reconciliation: fulfilment_groups status follows state machine per mode', { skip: !PG_URI }, async () => {
  const pool = getPool();

  try {
    const res = await pool.query(
      `SELECT group_id, mode, status FROM fulfilment_groups
       WHERE mode = 'quick' AND status NOT IN ('order_accepted','picked','packed','rider_assigned','picked_up','out_for_delivery','delivered','cancelled')
          OR mode = 'standard' AND status NOT IN ('order_accepted','processing','packed','rider_assigned','picked_up','in_transit','out_for_delivery','delivered','cancelled')
          OR mode = 'transfer' AND status NOT IN ('reserved_at_origin','transfer_requested','in_transit_to_bangalore','received_checked','allocated','packed','rider_assigned','picked_up','out_for_delivery','delivered','cancelled')`
    );
    assert.strictEqual(res.rowCount, 0, 'All fulfilment_groups must have valid status values for their mode');
  } finally {
    await pool.end();
  }
});