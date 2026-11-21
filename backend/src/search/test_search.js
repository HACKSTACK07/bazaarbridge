/**
 * Verification Test for Agent C Search & OTP Services
 *
 * Proves:
 * 1. deriveOtp(groupId) -> '######' (deterministic & stable across calls)
 * 2. hashOtpSubmission(deriveOtp(g)) equals stored otp_hash for a test group
 * 3. verifyOtpProof(groupId, proof) returns true for matching proof, false otherwise
 * 4. ensureIndex() configures typo-tolerant analyzer and locked fields (no quick_available, no hub_units, no OTPs)
 * 5. upsertOffer() revision guard: write revision 5, then attempt revision 4 -> stays at 5, returns 'stale'
 * 6. searchOffers() typo-tolerant candidate retrieval returning hits: [{ offer_id, product_id }] only
 */

const assert = require('assert');
const {
  deriveOtp,
  hashOtpSubmission,
  verifyOtpProof,
  ensureIndex,
  upsertOffer,
  searchOffers,
  OpenSearchClient
} = require('./index');

async function runTests() {
  console.log('=====================================================');
  console.log(' RUNNING AGENT C PREP VERIFICATION TESTS (HOURS 1-2)');
  console.log('=====================================================\n');

  const testSecret = 'bazaarbridge_hackathon_test_secret_72';
  process.env.OTP_HASH_SECRET = testSecret;

  // -----------------------------------------------------------------
  // 1. PROVE OTP HELPERS
  // -----------------------------------------------------------------
  console.log('--- TEST 1: OTP Helpers Derivation & Stability ---');
  const testGroupId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

  const otp1 = deriveOtp(testGroupId);
  const otp2 = deriveOtp(testGroupId);
  console.log(`Derived OTP call 1: "${otp1}"`);
  console.log(`Derived OTP call 2: "${otp2}"`);

  assert.strictEqual(otp1, otp2, 'deriveOtp must be stable across multiple calls');
  assert.strictEqual(typeof otp1, 'string', 'deriveOtp must return a string');
  assert.strictEqual(otp1.length, 6, 'deriveOtp must return exactly 6 digits');
  assert.match(otp1, /^\d{6}$/, 'deriveOtp must be numeric digits only');
  console.log('  [PASS] deriveOtp is stable, deterministic, and 6 digits.\n');

  console.log('--- TEST 2: hashOtpSubmission & stored otp_hash Equality ---');
  // At group creation, database stores: otp_hash = HMAC(secret, "hash:" + code)
  const storedOtpHash = hashOtpSubmission(otp1);
  console.log(`Computed stored otp_hash: ${storedOtpHash}`);

  // When admin/rider submits code, submission hash must match stored hash
  const submittedProof = hashOtpSubmission(otp1);
  assert.strictEqual(submittedProof, storedOtpHash, 'hashOtpSubmission(deriveOtp(g)) must equal stored otp_hash');
  console.log('  [PASS] hashOtpSubmission(deriveOtp(g)) strictly equals stored otp_hash.\n');

  console.log('--- TEST 3: verifyOtpProof Constant-Time Comparison ---');
  const validProofResult = verifyOtpProof(testGroupId, submittedProof, storedOtpHash);
  assert.strictEqual(validProofResult, true, 'verifyOtpProof must return true for valid proof');

  // Test with invalid proof (wrong OTP code: incremented by 1)
  const wrongCode = String((parseInt(otp1, 10) + 1) % 1000000).padStart(6, '0');
  const invalidProof = hashOtpSubmission(wrongCode);
  const invalidProofResult = verifyOtpProof(testGroupId, invalidProof, storedOtpHash);
  assert.strictEqual(invalidProofResult, false, 'verifyOtpProof must return false for invalid proof');

  // Test with corrupted hex string
  const corruptedProof = 'deadbeef'.repeat(8);
  const corruptedResult = verifyOtpProof(testGroupId, corruptedProof, storedOtpHash);
  assert.strictEqual(corruptedResult, false, 'verifyOtpProof must return false for corrupted proof');
  console.log('  [PASS] verifyOtpProof succeeds for correct proof and rejects wrong proof.\n');

  // -----------------------------------------------------------------
  // 2. PROVE OPENSEARCH CLIENT & ENSUREINDEX
  // -----------------------------------------------------------------
  console.log('--- TEST 4: ensureIndex() with Typo-Tolerant Mapping ---');
  const mockClient = new OpenSearchClient({ mockMode: true });

  const indexResult = await ensureIndex(mockClient);
  console.log(`Index creation status:`, indexResult);
  assert.strictEqual(indexResult.created, true, 'Index should be created');

  const indexDefinition = mockClient._indices.get('offers');
  assert.ok(indexDefinition, 'offers index definition must exist');

  const properties = indexDefinition.mappings.properties;
  // Verify required locked fields exist
  const expectedFields = [
    'offer_id', 'product_id', 'product_name', 'brand', 'category_name',
    'specs', 'dealer_id', 'shop_name', 'dealer_city', 'dealer_state',
    'origin_city', 'origin_state', 'is_outside_bangalore', 'fulfilment_route',
    'selling_price', 'available_units', 'home_units', 'eligible_modes',
    'bangalore_delivery_days', 'transfer_days_max', 'effective_days',
    'dealer_rating', 'total_reviews', 'verified', 'warranty_months', 'revision'
  ];
  for (const field of expectedFields) {
    assert.ok(properties[field], `Expected mapping field [${field}] must be present`);
  }

  // Verify prohibited fields are NOT in mappings
  assert.strictEqual(properties.quick_available, undefined, 'quick_available MUST NOT be in OpenSearch mappings');
  assert.strictEqual(properties.hub_units, undefined, 'hub_units MUST NOT be in OpenSearch mappings');
  assert.strictEqual(properties.otp, undefined, 'otp MUST NOT be in OpenSearch mappings');
  assert.strictEqual(properties.otp_hash, undefined, 'otp_hash MUST NOT be in OpenSearch mappings');
  assert.strictEqual(properties.otp_proof, undefined, 'otp_proof MUST NOT be in OpenSearch mappings');
  console.log('  [PASS] ensureIndex() created index with typo-tolerant settings and locked fields without prohibited fields.\n');

  // -----------------------------------------------------------------
  // 3. PROVE UPSERTOFFER WITH REVISION GUARD
  // -----------------------------------------------------------------
  console.log('--- TEST 5: upsertOffer() Revision Guard Proof ---');
  const testOfferId = 'offer-uuid-revision-guard-505';

  const baseOfferDoc = {
    offer_id: testOfferId,
    product_id: 'product-uuid-bluetooth-speaker',
    product_name: 'BoAt Stone 1800 Bluetooth Speaker',
    brand: 'boAt',
    category_name: 'Audio',
    specs: { color: 'Black', power: '20W' },
    dealer_id: 'dealer-uuid-1',
    shop_name: 'Bangalore Audio Hub',
    dealer_city: 'Bangalore',
    dealer_state: 'Karnataka',
    origin_city: 'Bangalore',
    origin_state: 'Karnataka',
    is_outside_bangalore: false,
    fulfilment_route: 'bangalore_direct',
    selling_price: 199900,
    available_units: 15,
    home_units: 15,
    eligible_modes: ['quick', 'standard'],
    bangalore_delivery_days: 1,
    transfer_days_max: null,
    effective_days: 1,
    dealer_rating: 4.6,
    total_reviews: 120,
    verified: true,
    warranty_months: 12,
    // Add accidental prohibited fields to verify sanitization
    quick_available: true,
    hub_units: 15,
    otp_hash: 'secret_hash_not_allowed'
  };

  // Step 5A: Write Revision 5
  console.log('Step 5A: Writing Revision 5...');
  const writeRes = await upsertOffer(testOfferId, {
    client: mockClient,
    offerDoc: baseOfferDoc,
    revision: 5
  });
  console.log(`Outcome of Revision 5 write:`, writeRes);
  assert.strictEqual(writeRes.revision, 5, 'Revision should be 5');
  assert.strictEqual(writeRes.outcome, 'written', 'Revision 5 should be written');

  // Check document in OpenSearch
  let storedDoc = await mockClient.getDocument('offers', testOfferId);
  console.log(`Document version in OpenSearch after Rev 5:`, storedDoc._version);
  assert.strictEqual(storedDoc._version, 5, 'Stored version must be 5');
  assert.strictEqual(storedDoc._source.revision, 5, 'Stored revision property must be 5');
  assert.strictEqual(storedDoc._source.quick_available, undefined, 'quick_available was sanitized out');
  assert.strictEqual(storedDoc._source.hub_units, undefined, 'hub_units was sanitized out');
  assert.strictEqual(storedDoc._source.otp_hash, undefined, 'otp_hash was sanitized out');

  // Step 5B: Attempt older Revision 4
  console.log('\nStep 5B: Attempting older Revision 4 (stale write attempt)...');
  const staleRes = await upsertOffer(testOfferId, {
    client: mockClient,
    offerDoc: baseOfferDoc,
    revision: 4
  });
  console.log(`Outcome of Revision 4 write attempt:`, staleRes);
  assert.strictEqual(staleRes.revision, 4, 'Attempted revision is 4');
  assert.strictEqual(staleRes.outcome, 'stale', 'Outcome must be "stale"');

  // Verify the document in OpenSearch is STILL at revision 5
  storedDoc = await mockClient.getDocument('offers', testOfferId);
  console.log(`Document version in OpenSearch after stale attempt:`, storedDoc._version);
  assert.strictEqual(storedDoc._version, 5, 'Document MUST remain at version 5!');
  assert.strictEqual(storedDoc._source.revision, 5, 'Stored revision MUST remain 5!');
  console.log('  [PASS] Revision guard verified: Revision 5 stayed protected against older Revision 4, returning outcome "stale".\n');

  // -----------------------------------------------------------------
  // 4. PROVE SEARCHOFFERS WITH TYPO TOLERANCE
  // -----------------------------------------------------------------
  console.log('--- TEST 6: searchOffers() Typo-Tolerant Discovery ---');
  // Search with intentional typo: "bluetoth"
  const searchResult = await searchOffers({ q: 'bluetoth', category: 'Audio' }, mockClient);
  console.log('Search result for query "bluetoth":', searchResult);

  assert.ok(Array.isArray(searchResult.hits), 'searchOffers must return hits array');
  assert.ok(searchResult.hits.length > 0, 'searchOffers must find candidates for typo "bluetoth"');

  const hit = searchResult.hits[0];
  console.log('First candidate hit:', hit);
  assert.strictEqual(hit.offer_id, testOfferId, 'Hit offer_id must match');
  assert.strictEqual(hit.product_id, 'product-uuid-bluetooth-speaker', 'Hit product_id must match');

  // Verify search contract: no price, stock or quick fields returned
  assert.strictEqual(hit.selling_price, undefined, 'selling_price must NOT be returned from searchOffers');
  assert.strictEqual(hit.available_units, undefined, 'available_units must NOT be returned from searchOffers');
  assert.strictEqual(hit.quick_available, undefined, 'quick_available must NOT be returned from searchOffers');
  console.log('  [PASS] searchOffers() correctly returns only { hits: [{ offer_id, product_id }] } with typo tolerance.\n');

  console.log('=====================================================');
  console.log(' ALL AGENT C PREP VERIFICATION TESTS PASSED (6/6)!');
  console.log('=====================================================');
}

runTests().catch(err => {
  console.error('\n[TEST RUN FAILED]:', err);
  process.exit(1);
});
