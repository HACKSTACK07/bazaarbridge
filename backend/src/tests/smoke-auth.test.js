// backend/src/tests/smoke-auth.test.js
// Phase 1 Smoke Test: Demo Login & Protected Endpoint Authentication
// Contract: POST /api/auth/login returns 200 + JWT; protected endpoints return 401 without token

const test = require('node:test');
const assert = require('node:assert');
const { apiRequest, isApiReachable, skipIfBlocked } = require('./helpers');

test('Smoke: Demo login returns JWT token', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  // Valid credentials
  const res = await apiRequest('POST', '/api/auth/login', {
    email: 'demo@bazaarbridge.dev',
    password: 'Demo@1234'
  });

  assert.strictEqual(res.status, 200, 'Login should return 200');
  assert.ok(res.data && res.data.token, 'Response must contain token');
  assert.ok(res.data.user && res.data.user.user_id, 'Response must contain user');
  assert.strictEqual(res.data.user.role, 'customer', 'Demo user role must be customer');
  assert.ok(res.data.token.length > 100, 'JWT token should be substantial length');
});

test('Smoke: Admin login returns JWT with admin role', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const res = await apiRequest('POST', '/api/auth/login', {
    email: 'admin@bazaarbridge.dev',
    password: 'Admin@1234'
  });

  assert.strictEqual(res.status, 200, 'Admin login should return 200');
  assert.ok(res.data && res.data.token, 'Response must contain token');
  assert.strictEqual(res.data.user.role, 'admin', 'Admin user role must be admin');
});

test('Smoke: Invalid credentials returns 401', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  const res = await apiRequest('POST', '/api/auth/login', {
    email: 'demo@bazaarbridge.dev',
    password: 'WrongPassword'
  });

  assert.strictEqual(res.status, 401, 'Invalid password should return 401');
  assert.strictEqual(res.data.error, 'INVALID_CREDENTIALS');
});

test('Smoke: Protected endpoint requires authentication', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  // Call protected endpoint without token
  const res = await apiRequest('GET', '/api/cart');

  assert.strictEqual(res.status, 401, 'Protected endpoint without token must return 401');
  assert.strictEqual(res.data.error, 'UNAUTHORIZED');
});

test('Smoke: Protected endpoint works with valid token', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  // Get token first
  const loginRes = await apiRequest('POST', '/api/auth/login', {
    email: 'demo@bazaarbridge.dev',
    password: 'Demo@1234'
  });
  const token = loginRes.data.token;

  // Call protected endpoint with token
  const res = await apiRequest('GET', '/api/cart', null, token);

  assert.strictEqual(res.status, 200, 'Protected endpoint with valid token must return 200');
  assert.ok(Array.isArray(res.data.items), 'Cart response must have items array');
});

test('Smoke: Rate limiting on login (10 req/min per IP)', async (t) => {
  const apiReady = await isApiReachable();
  if (skipIfBlocked(apiReady, 'Express API Server (/api)', t)) return;

  // Make 11 rapid login attempts
  const promises = Array.from({ length: 11 }, () =>
    apiRequest('POST', '/api/auth/login', {
      email: 'demo@bazaarbridge.dev',
      password: 'Demo@1234'
    })
  );

  const results = await Promise.all(promises);
  const rateLimited = results.filter(r => r.status === 429);

  // At least one should be rate limited (11th request)
  assert.ok(rateLimited.length > 0, 'Rate limiting should trigger after 10 requests');
  assert.strictEqual(rateLimited[0].data.error, 'RATE_LIMITED');
});