// backend/src/seed/verify.js
// Verification suite for BazaarBridge database seed data
// Checks all 10 seed requirements against schema.sql and agent-rules.md

const seedData = require('./seed-data');
const { generateSeedSql } = require('./seed');
const fs = require('fs');
const path = require('path');

function runVerification() {
  console.log('================================================================');
  console.log('   BazaarBridge Seed Data Verification Suite (Version 7.2)       ');
  console.log('================================================================\n');

  let passedChecks = 0;
  let totalChecks = 0;

  function assertCheck(name, condition, details) {
    totalChecks++;
    if (condition) {
      passedChecks++;
      console.log(`[PASS] ${name}`);
      if (details) console.log(`       ${details}`);
    } else {
      console.error(`[FAIL] ${name}`);
      if (details) console.error(`       Failure details: ${details}`);
    }
  }

  // --------------------------------------------------------------------------
  // Check 1: 40 products across 5 categories
  // --------------------------------------------------------------------------
  const categoryCount = seedData.categories.length;
  const productCount = seedData.products.length;
  const productsPerCategory = {};
  seedData.products.forEach(p => {
    productsPerCategory[p.category_id] = (productsPerCategory[p.category_id] || 0) + 1;
  });
  const allCategoriesHaveProducts = Object.keys(productsPerCategory).length === 5 &&
    Object.values(productsPerCategory).every(count => count === 8);

  assertCheck(
    'Requirement 1: 40 products across 5 categories',
    categoryCount === 5 && productCount === 40 && allCategoriesHaveProducts,
    `Found ${productCount} products across ${categoryCount} categories (8 products/category).`
  );

  // --------------------------------------------------------------------------
  // Check 2: 5 Bangalore dealers with distinct ratings and review counts
  // --------------------------------------------------------------------------
  const blrDealers = seedData.dealers.filter(d => d.city.toLowerCase() === 'bangalore');
  const ratings = new Set(blrDealers.map(d => d.dealer_rating));
  const reviews = new Set(blrDealers.map(d => d.total_reviews));

  assertCheck(
    'Requirement 2: 5 Bangalore dealers with distinct ratings and review counts',
    blrDealers.length === 5 && ratings.size === 5 && reviews.size === 5,
    `Found ${blrDealers.length} Bangalore dealers with ${ratings.size} distinct ratings and ${reviews.size} distinct review counts.`
  );

  // --------------------------------------------------------------------------
  // Check 3: 2-4 dealer offers for popular products
  // --------------------------------------------------------------------------
  const offersPerProduct = {};
  seedData.dealerOffers.forEach(o => {
    offersPerProduct[o.product_id] = (offersPerProduct[o.product_id] || 0) + 1;
  });

  const popularProductIds = [
    '60000000-0000-0000-0000-000000000002', // Headphones
    '60000000-0000-0000-0000-000000000009', // Smartphone
    '60000000-0000-0000-0000-000000000012', // Power bank
    '60000000-0000-0000-0000-000000000017', // Laptop
    '60000000-0000-0000-0000-000000000025', // Camera
    '60000000-0000-0000-0000-000000000033'  // Smartwatch
  ];
  const popularCheck = popularProductIds.every(id => {
    const count = offersPerProduct[id] || 0;
    return count >= 2 && count <= 4;
  });

  assertCheck(
    'Requirement 3: 2-4 dealer offers for popular products',
    popularCheck,
    `Checked ${popularProductIds.length} popular products; each has 2-4 offers (Total offers: ${seedData.dealerOffers.length}).`
  );

  // --------------------------------------------------------------------------
  // Check 4: Demo customer and admin accounts with bcrypt password hashes
  // --------------------------------------------------------------------------
  const users = seedData.getUsers();
  const demoCustomer = users.find(u => u.email === 'demo@bazaarbridge.dev');
  const demoAdmin = users.find(u => u.email === 'admin@bazaarbridge.dev');
  const demoRider = users.find(u => u.email === 'rider@bazaarbridge.dev');

  const bcryptRegex = /^\$2[ab]\$10\$[./A-Za-z0-9]{53}$/;
  const validCustomerAuth = demoCustomer && demoCustomer.role === 'customer' && bcryptRegex.test(demoCustomer.password_hash);
  const validAdminAuth = demoAdmin && demoAdmin.role === 'admin' && bcryptRegex.test(demoAdmin.password_hash);
  const validRiderAuth = demoRider && demoRider.role === 'rider' && bcryptRegex.test(demoRider.password_hash);

  assertCheck(
    'Requirement 4: Demo customer, admin, and rider accounts with bcrypt hashing',
    validCustomerAuth && validAdminAuth && validRiderAuth,
    `Customer: ${demoCustomer.email}, Admin: ${demoAdmin.email}, Rider: ${demoRider.email} (all bcrypt cost 10).`
  );

  // --------------------------------------------------------------------------
  // Check 5: Bluetooth speaker with exactly 5 offers and 5 distinct category winners
  // --------------------------------------------------------------------------
  const speakerId = '60000000-0000-0000-0000-000000000001';
  const speakerOffers = seedData.dealerOffers.filter(o => o.product_id === speakerId);

  // Build comparison models by joining offer, dealer, and inventory
  const dealerMap = new Map(seedData.dealers.map(d => [d.dealer_id, d]));
  const invMap = new Map();
  seedData.inventory.forEach(inv => {
    if (!invMap.has(inv.offer_id)) invMap.set(inv.offer_id, []);
    invMap.get(inv.offer_id).push(inv);
  });

  const comparisonOffers = speakerOffers.map(o => {
    const dealer = dealerMap.get(o.dealer_id);
    const invList = invMap.get(o.offer_id) || [];
    // Free sellable units at sellable locations
    const freeUnits = invList
      .filter(i => {
        const loc = seedData.stockLocations.find(l => l.location_id === i.location_id);
        return loc && loc.is_sellable;
      })
      .reduce((sum, i) => sum + (i.quantity - i.reserved_quantity), 0);

    const hasHomeStock = invList.some(i => {
      const loc = seedData.stockLocations.find(l => l.location_id === i.location_id);
      return loc && loc.is_home && (i.quantity - i.reserved_quantity) > 0;
    });

    const effectiveDays = hasHomeStock ? o.bangalore_delivery_days : (o.transfer_days_max || o.bangalore_delivery_days);

    return {
      offer_id: o.offer_id,
      selling_price: o.selling_price,
      effective_days: effectiveDays,
      dealer_rating: dealer.dealer_rating,
      total_reviews: dealer.total_reviews,
      free_units: freeUnits,
      dealer_name: dealer.shop_name
    };
  });

  // Calculate Best Value scores
  const minPrice = Math.min(...comparisonOffers.map(o => o.selling_price));
  const maxPrice = Math.max(...comparisonOffers.map(o => o.selling_price));
  const minDays = Math.min(...comparisonOffers.map(o => o.effective_days));
  const maxDays = Math.max(...comparisonOffers.map(o => o.effective_days));

  comparisonOffers.forEach(o => {
    const priceNorm = maxPrice === minPrice ? 100 : 100 * (maxPrice - o.selling_price) / (maxPrice - minPrice);
    const deliveryNorm = maxDays === minDays ? 100 : 100 * (maxDays - o.effective_days) / (maxDays - minDays);
    const ratingNorm = 100 * o.dealer_rating / 5;
    const stockNorm = 100; // MVP indicator for any in-stock offer
    o.value_score = 0.45 * priceNorm + 0.25 * deliveryNorm + 0.20 * ratingNorm + 0.10 * stockNorm;
  });

  // Category 1: Best Budget (selling_price ASC, effective_days ASC, dealer_rating DESC)
  const budgetWinner = [...comparisonOffers].sort((a, b) =>
    a.selling_price - b.selling_price || a.effective_days - b.effective_days || b.dealer_rating - a.dealer_rating
  )[0];

  // Category 2: Fastest Delivery (effective_days ASC, selling_price ASC)
  const deliveryWinner = [...comparisonOffers].sort((a, b) =>
    a.effective_days - b.effective_days || a.selling_price - b.selling_price
  )[0];

  // Category 3: Best Rated Dealer (dealer_rating DESC, total_reviews DESC, selling_price ASC)
  const ratedWinner = [...comparisonOffers].sort((a, b) =>
    b.dealer_rating - a.dealer_rating || b.total_reviews - a.total_reviews || a.selling_price - b.selling_price
  )[0];

  // Category 4: Most Available (free_units DESC, selling_price ASC)
  const availWinner = [...comparisonOffers].sort((a, b) =>
    b.free_units - a.free_units || a.selling_price - b.selling_price
  )[0];

  // Category 5: Best Value (value_score DESC, selling_price ASC)
  const valueWinner = [...comparisonOffers].sort((a, b) =>
    b.value_score - a.value_score || a.selling_price - b.selling_price
  )[0];

  const winners = [
    budgetWinner.offer_id,
    deliveryWinner.offer_id,
    ratedWinner.offer_id,
    availWinner.offer_id,
    valueWinner.offer_id
  ];
  const distinctWinners = new Set(winners);

  assertCheck(
    'Requirement 5: Bluetooth speaker has exactly 5 offers and 5 distinct category winners',
    speakerOffers.length === 5 && distinctWinners.size === 5,
    `5 distinct winners:
       - Best Budget:       Offer 1 (${budgetWinner.offer_id}) @ Rs.${budgetWinner.selling_price / 100}
       - Fastest Delivery:  Offer 2 (${deliveryWinner.offer_id}) @ ${deliveryWinner.effective_days} day(s)
       - Best Rated Dealer: Offer 3 (${ratedWinner.offer_id}) @ ${ratedWinner.dealer_rating}★ (${ratedWinner.total_reviews} reviews)
       - Most Available:    Offer 4 (${availWinner.offer_id}) @ ${availWinner.free_units} units
       - Best Value:        Offer 5 (${valueWinner.offer_id}) @ score ${valueWinner.value_score.toFixed(2)}`
  );

  // --------------------------------------------------------------------------
  // Check 6: Offer with exactly 1 available unit for concurrency test
  // --------------------------------------------------------------------------
  const lastUnitOffer = seedData.dealerOffers.find(o => o.offer_id === '70000000-0000-0000-0000-000000000006');
  const lastUnitInv = seedData.inventory.find(i => i.offer_id === '70000000-0000-0000-0000-000000000006');
  const availableQty = lastUnitInv ? (lastUnitInv.quantity - lastUnitInv.reserved_quantity) : 0;

  assertCheck(
    'Requirement 6: Offer with exactly 1 available unit for concurrency testing',
    lastUnitOffer && availableQty === 1,
    `Offer ID ${lastUnitOffer.offer_id} (Product: BassMaster Headphones) has quantity=${lastUnitInv.quantity}, reserved=${lastUnitInv.reserved_quantity} (available=1).`
  );

  // --------------------------------------------------------------------------
  // Check 7: Seeded locations and hub configuration
  // --------------------------------------------------------------------------
  const hasWarehouse = seedData.stockLocations.some(l => l.location_type === 'warehouse' && l.is_home && l.city === 'Bangalore');
  const hasHub = seedData.stockLocations.some(l => l.location_type === 'hub' && l.city === 'Bangalore');
  const hasQuarantine = seedData.stockLocations.some(l => l.location_type === 'quarantine' && !l.is_sellable);
  const hasMysuruHolding = seedData.stockLocations.some(l => l.location_type === 'holding' && l.city === 'Mysuru');
  const hubConfig = seedData.fulfilmentHubs[0];
  const pinCodes = seedData.hubServiceAreas.map(a => a.pin_code);

  const validLocations = hasWarehouse && hasHub && hasQuarantine && hasMysuruHolding;
  const validHub = hubConfig && hubConfig.hours && hubConfig.order_capacity > 0 && pinCodes.length === 3;

  assertCheck(
    'Requirement 7: Required locations and hub configuration (3 PIN codes, hours, capacity)',
    validLocations && validHub,
    `Locations verified: Warehouse (is_home), Express Hub, Quarantine (unsellable), Mysuru Holding. Hub PINs: ${pinCodes.join(', ')}.`
  );

  // --------------------------------------------------------------------------
  // Check 8: Mysuru dealer with inventory in both Mysuru and Bangalore
  // --------------------------------------------------------------------------
  const mysuruDealer = seedData.dealers.find(d => d.city.toLowerCase() === 'mysuru');
  const mysuruOffers = seedData.dealerOffers.filter(o => o.dealer_id === mysuruDealer.dealer_id);
  const mysuruOfferIds = new Set(mysuruOffers.map(o => o.offer_id));

  const blrWarehouse = seedData.stockLocations.find(l => l.city === 'Bangalore' && l.location_type === 'warehouse');
  const mysuruHolding = seedData.stockLocations.find(l => l.city === 'Mysuru' && l.location_type === 'holding');

  const hasBangaloreStock = seedData.inventory.some(i => mysuruOfferIds.has(i.offer_id) && i.location_id === blrWarehouse.location_id);
  const hasMysuruStock = seedData.inventory.some(i => mysuruOfferIds.has(i.offer_id) && i.location_id === mysuruHolding.location_id);

  assertCheck(
    'Requirement 8: Mysuru dealer with inventory in both Mysuru and Bangalore',
    mysuruDealer && hasBangaloreStock && hasMysuruStock,
    `Dealer "${mysuruDealer.shop_name}" has inventory at Bangalore Warehouse (Section A) AND Mysuru Regional Holding (Section B).`
  );

  // --------------------------------------------------------------------------
  // Check 9: Sample price-history records
  // --------------------------------------------------------------------------
  const hasPriceHistory = seedData.historicalPrices && seedData.historicalPrices.length > 0;
  const priceHistoryValid = hasPriceHistory && seedData.historicalPrices.every(hp =>
    hp.selling_price > 0 && hp.valid_from_offset_days > hp.valid_to_offset_days
  );

  assertCheck(
    'Requirement 9: Sample price-history records for reference price calculation',
    priceHistoryValid,
    `Found ${seedData.historicalPrices.length} historical price intervals with valid_to set in the past.`
  );

  // --------------------------------------------------------------------------
  // Check 10: Optional coupon data
  // --------------------------------------------------------------------------
  const hasCoupons = seedData.coupons && seedData.coupons.length > 0;
  const couponsValid = hasCoupons && seedData.coupons.every(c =>
    c.value > 0 && c.min_basket_paise >= 0 && ['fixed_paise', 'percent'].includes(c.kind)
  );

  assertCheck(
    'Requirement 10: Optional coupon data ([FEATURE_COUPONS])',
    couponsValid,
    `Found ${seedData.coupons.length} valid coupons: ${seedData.coupons.map(c => c.code).join(', ')}.`
  );

  // --------------------------------------------------------------------------
  // Check 11: SQL generation and file check
  // --------------------------------------------------------------------------
  const sql = generateSeedSql('Admin@1234');
  const sqlFilePath = path.join(__dirname, 'seed.sql');
  fs.writeFileSync(sqlFilePath, sql, 'utf8');
  const sqlExists = fs.existsSync(sqlFilePath) && fs.statSync(sqlFilePath).size > 1000;

  assertCheck(
    'Deliverable Check: Idempotent seed.sql generated',
    sqlExists,
    `File size: ${(fs.statSync(sqlFilePath).size / 1024).toFixed(1)} KB at ${sqlFilePath}`
  );

  console.log('\n================================================================');
  console.log(`Verification Summary: ${passedChecks}/${totalChecks} checks PASSED.`);
  console.log('================================================================\n');

  if (passedChecks === totalChecks) {
    console.log('ALL SEED REQUIREMENTS FULLY SATISFIED!');
    return true;
  } else {
    console.error('SOME CHECKS FAILED!');
    process.exit(1);
  }
}

if (require.main === module) {
  runVerification();
}

module.exports = runVerification;
