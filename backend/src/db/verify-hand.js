/**
 * Hand Verification Script for Hour 1-2 Prep Tasks
 * 
 * Verifications required by Agent B Prep Prompt:
 * 1. update an inventory row twice -> revision +2
 * 2. toggle a hub's active flag -> revision +1 for every offer stocked there
 * 3. run restock_units for an offer with NO Bangalore row -> the row is created with quantity q
 * 4. v7.2 price-history trigger: change a selling_price twice in ONE transaction
 *    -> no error and exactly one open history row (valid_to null).
 */

const { pool, getClient } = require('./index');
const { restock_units } = require('./stock');

async function runHandVerifications() {
  const client = await getClient();
  console.log('Starting Hour 1-2 hand verification suite...');

  try {
    await client.query('BEGIN');

    // 0. Setup dummy category, product, dealer, locations, offer
    const catRes = await client.query(`
      INSERT INTO categories (category_name)
      VALUES ('test-electronics-' || gen_random_uuid())
      RETURNING category_id;
    `);
    const catId = catRes.rows[0].category_id;

    const prodRes = await client.query(`
      INSERT INTO products (name, brand, category_id)
      VALUES ('Test Gadget', 'TestBrand', $1)
      RETURNING product_id;
    `, [catId]);
    const prodId = prodRes.rows[0].product_id;

    const dealerRes = await client.query(`
      INSERT INTO dealers (shop_name, city, state, contact)
      VALUES ('Test Dealer', 'Bangalore', 'Karnataka', '9999999999')
      RETURNING dealer_id;
    `);
    const dealerId = dealerRes.rows[0].dealer_id;

    const offerRes = await client.query(`
      INSERT INTO dealer_offers (product_id, dealer_id, purchase_price, selling_price)
      VALUES ($1, $2, 50000, 70000)
      RETURNING offer_id;
    `, [prodId, dealerId]);
    const offerId = offerRes.rows[0].offer_id;

    // Hub location & warehouse location
    const hubLocRes = await client.query(`
      INSERT INTO stock_locations (name, city, state, location_type, is_home, is_sellable)
      VALUES ('Test Hub Loc', 'Bangalore', 'Karnataka', 'hub', false, true)
      RETURNING location_id;
    `);
    const hubLocId = hubLocRes.rows[0].location_id;

    const hubRes = await client.query(`
      INSERT INTO fulfilment_hubs (location_id, active, order_capacity)
      VALUES ($1, true, 20)
      RETURNING hub_id;
    `, [hubLocId]);
    const hubId = hubRes.rows[0].hub_id;

    const whLocRes = await client.query(`
      INSERT INTO stock_locations (name, city, state, location_type, is_home, is_sellable)
      VALUES ('Bangalore Central Warehouse', 'Bangalore', 'Karnataka', 'warehouse', true, true)
      RETURNING location_id;
    `);
    const whLocId = whLocRes.rows[0].location_id;

    // Add initial inventory row at hub location
    await client.query(`
      INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
      VALUES ($1, $2, 10, 0);
    `, [offerId, hubLocId]);

    // Check baseline revision
    const rev1Res = await client.query('SELECT revision FROM offer_state_versions WHERE offer_id = $1;', [offerId]);
    const baselineRev = BigInt(rev1Res.rows[0]?.revision || 1);
    console.log(`Baseline revision for offer: ${baselineRev}`);

    // ===============================================================
    // TEST 1: Update an inventory row twice -> revision +2
    // ===============================================================
    await client.query('UPDATE inventory SET quantity = 11 WHERE offer_id = $1 AND location_id = $2;', [offerId, hubLocId]);
    await client.query('UPDATE inventory SET quantity = 12 WHERE offer_id = $1 AND location_id = $2;', [offerId, hubLocId]);

    const rev2Res = await client.query('SELECT revision FROM offer_state_versions WHERE offer_id = $1;', [offerId]);
    const updatedRev = BigInt(rev2Res.rows[0].revision);
    if (updatedRev !== baselineRev + 2n) {
      throw new Error(`TEST 1 FAILED: Expected revision ${baselineRev + 2n}, got ${updatedRev}`);
    }
    console.log(`✔ TEST 1 PASSED: Inventory updated twice -> revision +2 (new rev: ${updatedRev})`);

    // ===============================================================
    // TEST 2: Toggle a hub's active flag -> revision +1 for every offer stocked there
    // ===============================================================
    const revBeforeToggle = updatedRev;
    await client.query('UPDATE fulfilment_hubs SET active = false WHERE hub_id = $1;', [hubId]);

    const rev3Res = await client.query('SELECT revision FROM offer_state_versions WHERE offer_id = $1;', [offerId]);
    const revAfterToggle = BigInt(rev3Res.rows[0].revision);
    if (revAfterToggle !== revBeforeToggle + 1n) {
      throw new Error(`TEST 2 FAILED: Expected revision ${revBeforeToggle + 1n}, got ${revAfterToggle}`);
    }
    console.log(`✔ TEST 2 PASSED: Hub active toggled -> revision +1 for stocked offer (new rev: ${revAfterToggle})`);

    // ===============================================================
    // TEST 3: Run restock_units for an offer with NO Bangalore row -> row is created with quantity q
    // ===============================================================
    const checkBglrRow = await client.query('SELECT * FROM inventory WHERE offer_id = $1 AND location_id = $2;', [offerId, whLocId]);
    if (checkBglrRow.rowCount !== 0) {
      throw new Error('Precondition error: Bangalore inventory row already exists!');
    }

    const restockedQty = await restock_units(client, offerId, whLocId, 25);
    if (restockedQty !== 25) {
      throw new Error(`TEST 3 FAILED: Expected restocked quantity 25, got ${restockedQty}`);
    }

    const verifyBglrRow = await client.query('SELECT quantity, reserved_quantity FROM inventory WHERE offer_id = $1 AND location_id = $2;', [offerId, whLocId]);
    if (verifyBglrRow.rowCount !== 1 || verifyBglrRow.rows[0].quantity !== 25) {
      throw new Error('TEST 3 FAILED: Bangalore inventory row was not created properly by restock_units upsert');
    }
    console.log(`✔ TEST 3 PASSED: restock_units with NO previous row created new Bangalore row with qty ${restockedQty}`);

    // ===============================================================
    // TEST 4 (v7.2): Price-history trigger: change selling_price twice in ONE transaction
    //               -> no error and exactly one open history row (valid_to is null)
    // ===============================================================
    await client.query('UPDATE dealer_offers SET selling_price = 72000 WHERE offer_id = $1;', [offerId]);
    await client.query('UPDATE dealer_offers SET selling_price = 75000 WHERE offer_id = $1;', [offerId]);

    const historyRes = await client.query(`
      SELECT history_id, selling_price, valid_from, valid_to
      FROM offer_price_history
      WHERE offer_id = $1
      ORDER BY history_id ASC;
    `, [offerId]);

    const openRows = historyRes.rows.filter(r => r.valid_to === null);
    if (openRows.length !== 1) {
      throw new Error(`TEST 4 FAILED: Expected exactly 1 open price history row, got ${openRows.length}`);
    }
    if (BigInt(openRows[0].selling_price) !== 75000n) {
      throw new Error(`TEST 4 FAILED: Open row price mismatch: expected 75000, got ${openRows[0].selling_price}`);
    }
    console.log(`✔ TEST 4 PASSED: Changed price twice in ONE transaction -> no error and exactly 1 open row with current price ${openRows[0].selling_price}`);

    // Rollback test changes to leave database clean
    await client.query('ROLLBACK');
    console.log('All 4 hand verifications PASSED successfully (test transaction rolled back).');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Hand verification error:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runHandVerifications()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runHandVerifications };
