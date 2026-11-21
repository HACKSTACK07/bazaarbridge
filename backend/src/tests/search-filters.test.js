// backend/src/tests/search-filters.test.js
// Phase 1 v7.2 Test: Search Filters & PostgreSQL Recheck Integrity
// Contract: bluetoth + category, + max_price, + city=Mysuru each narrow the results;
// combined filters work; a price changed after indexing never leaks a result above
// max_price (the PG recheck re-applies it).

const test = require('node:test');
const assert = require('node:assert');
const { apiRequest, isApiReachable, isDbReachable, getDbPool, skipIfBlocked } = require('./helpers');

test('Search Filters and PostgreSQL Price Recheck Test', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // 1. Search for typo query "bluetoth"
  const search1 = await apiRequest('GET', '/api/search?q=bluetoth');
  assert.strictEqual(search1.status, 200);
  assert(search1.data.hits && search1.data.hits.length > 0, 'bluetoth search should return hits');
  const countAll = search1.data.hits.length;

  // 2. Filter by category
  const audioCatId = '50000000-0000-0000-0000-000000000001';
  const searchCat = await apiRequest('GET', `/api/search?q=bluetoth&category=${audioCatId}`);
  assert.strictEqual(searchCat.status, 200);
  assert(searchCat.data.hits.length <= countAll, 'Category filter should narrow results');

  // 3. Filter by city=Mysuru -> must be non-empty because Mysuru dealer sells Bluetooth earphones
  const searchMysuru = await apiRequest('GET', '/api/search?q=bluetoth&city=Mysuru');
  assert.strictEqual(searchMysuru.status, 200);
  assert(searchMysuru.data.hits.length > 0, 'city=Mysuru search for bluetoth must be non-empty');

  // 4. Filter by max_price (e.g. 100000 paise / Rs. 1,000)
  const searchPrice = await apiRequest('GET', '/api/search?q=bluetoth&max_price=100000');
  assert.strictEqual(searchPrice.status, 200);
  searchPrice.data.hits.forEach(hit => {
    assert(hit.selling_price <= 100000, 'No hit should exceed max_price');
  });

  // 5. Test PostgreSQL recheck:
  // If an offer is changed in PostgreSQL to Rs.1500 after indexing,
  // it must NOT appear in search with max_price=1000
  const TEST_OFFER_ID = '70000000-0000-0000-0000-000000000001';
  await pool.query(
    `UPDATE dealer_offers SET selling_price = 150000 WHERE offer_id = $1`,
    [TEST_OFFER_ID]
  );

  const recheckSearch = await apiRequest('GET', '/api/search?q=bluetoth&max_price=100000');
  const leaked = recheckSearch.data.hits.find(h => h.offer_id === TEST_OFFER_ID);
  assert.strictEqual(leaked, undefined, 'Stale index hit above max_price must be filtered by PostgreSQL recheck');

  // Restore price
  await pool.query(
    `UPDATE dealer_offers SET selling_price = 69900 WHERE offer_id = $1`,
    [TEST_OFFER_ID]
  );
});
