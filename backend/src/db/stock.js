/**
 * Stock Movement Helpers
 * Specifications from agent-rules.md & schema.sql
 * All changes must check rowCount or use the locked upsert.
 */

/**
 * hold_units: Conditional UPDATE on an existing row
 * rowCount must be 1, else raises OUT_OF_STOCK.
 */
async function hold_units(client, offer_id, location_id, qty) {
  if (qty <= 0) {
    throw new Error('INVALID_QUANTITY');
  }

  const sql = `
    UPDATE inventory
    SET reserved_quantity = reserved_quantity + $3
    WHERE offer_id = $1 AND location_id = $2
      AND (quantity - reserved_quantity) >= $3
    RETURNING reserved_quantity, quantity;
  `;
  const res = await client.query(sql, [offer_id, location_id, qty]);
  if (res.rowCount !== 1) {
    const err = new Error('OUT_OF_STOCK');
    err.code = 'OUT_OF_STOCK';
    throw err;
  }
  return res.rows[0];
}

/**
 * release_hold: Conditional UPDATE on an existing row
 * rowCount must be 1, else raises STOCK_RELEASE_FAILED.
 */
async function release_hold(client, offer_id, location_id, qty) {
  if (qty <= 0) {
    throw new Error('INVALID_QUANTITY');
  }

  const sql = `
    UPDATE inventory
    SET reserved_quantity = reserved_quantity - $3
    WHERE offer_id = $1 AND location_id = $2
      AND reserved_quantity >= $3
    RETURNING reserved_quantity, quantity;
  `;
  const res = await client.query(sql, [offer_id, location_id, qty]);
  if (res.rowCount !== 1) {
    const err = new Error('STOCK_RELEASE_FAILED');
    err.code = 'STOCK_RELEASE_FAILED';
    throw err;
  }
  return res.rows[0];
}

/**
 * deduct_units: Conditional UPDATE
 * rowCount must be 1 else raises INVENTORY_DEDUCTION_FAILED.
 */
async function deduct_units(client, offer_id, location_id, qty) {
  if (qty <= 0) {
    throw new Error('INVALID_QUANTITY');
  }

  const sql = `
    UPDATE inventory
    SET quantity = quantity - $3,
        reserved_quantity = reserved_quantity - $3
    WHERE offer_id = $1 AND location_id = $2
      AND quantity >= $3
      AND reserved_quantity >= $3
    RETURNING quantity, reserved_quantity;
  `;
  const res = await client.query(sql, [offer_id, location_id, qty]);
  if (res.rowCount !== 1) {
    const err = new Error('INVENTORY_DEDUCTION_FAILED');
    err.code = 'INVENTORY_DEDUCTION_FAILED';
    throw err;
  }
  return res.rows[0];
}

/**
 * restock_units: ONE UPSERT
 * Used when the destination row may not exist yet (e.g. Bangalore warehouse for Section B offer).
 * MUST be called only after a conditional transition matched exactly one row in the same transaction.
 */
async function restock_units(client, offer_id, location_id, qty) {
  if (qty <= 0) {
    throw new Error('INVALID_QUANTITY');
  }

  const sql = `
    INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
    VALUES ($1, $2, $3, 0)
    ON CONFLICT (offer_id, location_id)
    DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity
    RETURNING quantity;
  `;
  const res = await client.query(sql, [offer_id, location_id, qty]);
  return res.rows[0].quantity;
}

module.exports = {
  hold_units,
  release_hold,
  deduct_units,
  restock_units
};
