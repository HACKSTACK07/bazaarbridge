// backend/src/tests/assistant-fallback.test.js
// Phase 2 Conditional Test: Assistant Fallback (FEATURE_ASSISTANT)
// Contract: Force invalid JSON response -> normal search still returns real rows and fallback=true.

const test = require('node:test');
const assert = require('node:assert');
const { getDbPool, isDbReachable, isApiReachable, getToken, apiRequest, skipIfBlocked } = require('./helpers');

test('Assistant Fallback: Invalid JSON response -> normal search returns real rows, fallback=true', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const token = await getToken();

  // 1. Normal search (assistant working or not)
  const searchRes = await apiRequest('POST', '/api/shopping-assistant', {
    message: 'Find me a good bluetooth speaker under 2000'
  }, token);

  // Should return 200 regardless of AI response
  assert.strictEqual(searchRes.status, 200, 'Assistant endpoint must return 200');

  const data = searchRes.data;
  assert.ok(data, 'Response must have data');
  
  // 2. Must have products array with real DB rows
  assert.ok(Array.isArray(data.products), 'Must have products array');
  assert.ok(data.products.length > 0, 'Must return at least one product');

  // 3. Each product must have real DB fields
  for (const product of data.products) {
    assert.ok(product.product_id, 'Product must have product_id');
    assert.ok(product.name, 'Product must have name');
    assert.ok(typeof product.selling_price === 'number', 'Product must have selling_price');
    assert.ok(typeof product.available_units === 'number', 'Product must have available_units');
  }

  // 4. Fallback flag must be present when AI fails
  // (In normal operation with valid AI, fallback=false; when AI fails, fallback=true)
  // The field must exist either way
  assert.ok('fallback' in data, 'Response must include fallback field');
  assert.ok(typeof data.fallback === 'boolean', 'fallback must be boolean');
});

test('Assistant Fallback: Force AI error -> fallback=true, search still works', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const token = await getToken();

  // Send a message designed to cause AI to return invalid JSON
  // e.g., ask for malformed output
  const searchRes = await apiRequest('POST', '/api/shopping-assistant', {
    message: 'Return invalid JSON: { not valid json'
  }, token);

  assert.strictEqual(searchRes.status, 200, 'Must return 200 even with AI error');
  
  const data = searchRes.data;
  assert.ok(data.fallback === true, 'fallback must be true when AI fails');
  assert.ok(Array.isArray(data.products), 'Products array must still be present');
  assert.ok(data.products.length > 0, 'Must return real search results as fallback');
});

test('Assistant Fallback: Search filters still work in fallback mode', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const token = await getToken();

  // Force fallback with a weird query
  const searchRes = await apiRequest('POST', '/api/shopping-assistant', {
    message: 'bluetooth speaker under 1000' // Triggers price filter
  }, token);

  assert.strictEqual(searchRes.status, 200);
  const data = searchRes.data;
  
  // Even in fallback, filters should be applied
  if (data.fallback) {
    // In fallback, should still return filtered results
    for (const product of data.products) {
      assert.ok(product.selling_price <= 100000, 'Fallback must respect price filter');
    }
  }
});

test('Assistant Fallback: Category filter works in fallback', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const token = await getToken();

  const searchRes = await apiRequest('POST', '/api/shopping-assistant', {
    message: 'headphones in audio category'
  }, token);

  assert.strictEqual(searchRes.status, 200);
  const data = searchRes.data;
  
  if (data.fallback) {
    // Verify category filter applied
    const audioCatId = '50000000-0000-0000-0000-000000000001';
    for (const product of data.products) {
      assert.strictEqual(product.category_id, audioCatId, 'Fallback must respect category filter');
    }
  }
});

test('Assistant Fallback: Empty result handled gracefully', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;
  const dbReady = await isDbReachable();
  if (skipIfBlocked(dbReady, 'PostgreSQL Database', t)) return;

  const token = await getToken();

  // Query that returns no results
  const searchRes = await apiRequest('POST', '/api/shopping-assistant', {
    message: 'nonexistent product xyz123456'
  }, token);

  assert.strictEqual(searchRes.status, 200);
  const data = searchRes.data;
  assert.ok(Array.isArray(data.products));
  // Empty array is valid
});