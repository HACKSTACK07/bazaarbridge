// backend/src/tests/search-filters-quick.test.js
// Phase 1 Test: Search Filters - Quick Delivery & Invalid Filters
// Contract: quick=true filter applied AFTER PostgreSQL recheck; invalid filters handled safely

const test = require('node:test');
const assert = require('node:assert');
const { apiRequest, isApiReachable, isDbReachable, getDbPool, skipIfBlocked } = require('./helpers');

test('Search Filters: quick=true narrows to hub-eligible results', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();

  // 1. Search without quick filter - should include all eligible offers
  const searchAll = await apiRequest('GET', '/api/search?q=bluetooth');
  assert.strictEqual(searchAll.status, 200);
  const allCount = searchAll.data.hits.length;
  assert.ok(allCount > 0, 'Bluetooth search should return hits');

  // 2. Search with quick=true - should only include hub-eligible offers
  const searchQuick = await apiRequest('GET', '/api/search?q=bluetooth&quick=true');
  assert.strictEqual(searchQuick.status, 200);
  assert.ok(searchQuick.data.hits.length <= allCount, 'quick=true should narrow results');

  // 3. Verify each quick result has quick_available = true (computed in PG recheck)
  for (const hit of searchQuick.data.hits) {
    assert.strictEqual(hit.quick_available, true, 'All quick results must have quick_available=true');
  }

  // 4. Test with PIN code that has hub coverage
  const searchQuickPin = await apiRequest('GET', '/api/search?q=bluetooth&quick=true&city=Bangalore');
  assert.strictEqual(searchQuickPin.status, 200);

  // 5. Test quick=false (explicit) should behave like no quick filter
  const searchNoQuick = await apiRequest('GET', '/api/search?q=bluetooth&quick=false');
  assert.strictEqual(searchNoQuick.status, 200);
});

test('Search Filters: Invalid/missing filters handled safely', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  // 1. Invalid category UUID - should return 200 with empty or filtered results
  const invalidCat = await apiRequest('GET', '/api/search?q=bluetooth&category=invalid-uuid');
  assert.strictEqual(invalidCat.status, 200, 'Invalid category should not crash');

  // 2. Invalid max_price (non-numeric) - should return 400 or handle gracefully
  const invalidPrice = await apiRequest('GET', '/api/search?q=bluetooth&max_price=not-a-number');
  // Should either return 400 or treat as no filter
  assert.ok([200, 400].includes(invalidPrice.status), 'Invalid max_price should be handled safely');

  // 3. Negative max_price - should return 400 or treat as no filter
  const negativePrice = await apiRequest('GET', '/api/search?q=bluetooth&max_price=-100');
  assert.ok([200, 400].includes(negativePrice.status), 'Negative max_price should be handled safely');

  // 4. Non-existent city - should return 200 with empty results
  const noCity = await apiRequest('GET', '/api/search?q=bluetooth&city=NonExistentCity123');
  assert.strictEqual(noCity.status, 200, 'Non-existent city should not crash');
  assert.strictEqual(noCity.data.hits.length, 0, 'Non-existent city should return empty results');

  // 5. Empty query string - should return 200 with broad results
  const emptyQuery = await apiRequest('GET', '/api/search?q=');
  assert.strictEqual(emptyQuery.status, 200, 'Empty query should not crash');

  // 6. Multiple invalid filters combined
  const multiInvalid = await apiRequest('GET', '/api/search?q=bluetooth&category=invalid&max_price=abc&city=XYZ');
  assert.strictEqual(multiInvalid.status, 200, 'Multiple invalid filters should not crash');
});

test('Search Filters: Category filter narrows correctly via PostgreSQL recheck', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const audioCatId = '50000000-0000-0000-0000-000000000001';

  // 1. Search with category filter
  const searchCat = await apiRequest('GET', `/api/search?q=bluetooth&category=${audioCatId}`);
  assert.strictEqual(searchCat.status, 200);

  // 2. All hits should belong to Audio & Headphones category
  for (const hit of searchCat.data.hits) {
    assert.strictEqual(hit.category_id, audioCatId, 'All results must match category filter');
  }

  // 3. Search without category should include more (or equal) results
  const searchAll = await apiRequest('GET', '/api/search?q=bluetooth');
  assert.ok(searchAll.data.hits.length >= searchCat.data.hits.length, 'Unfiltered search should have >= results');
});

test('Search Filters: max_price filter excludes above-ceiling via PostgreSQL recheck', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const pool = getDbPool();
  const TEST_OFFER_ID = '70000000-0000-0000-0000-000000000001';

  // 1. Set a test offer price above ceiling
  await pool.query(
    `UPDATE dealer_offers SET selling_price = 150000 WHERE offer_id = $1`,
    [TEST_OFFER_ID]
  );

  // 2. Search with max_price below that offer's price
  const search = await apiRequest('GET', '/api/search?q=bluetooth&max_price=100000');
  assert.strictEqual(search.status, 200);

  // 3. The expensive offer must NOT appear (PG recheck filters it)
  const leaked = search.data.hits.find(h => h.offer_id === TEST_OFFER_ID);
  assert.strictEqual(leaked, undefined, 'Offer above max_price must be filtered by PostgreSQL recheck');

  // 4. Restore price
  await pool.query(
    `UPDATE dealer_offers SET selling_price = 69900 WHERE offer_id = $1`,
    [TEST_OFFER_ID]
  );
});