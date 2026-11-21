// backend/src/tests/comparison-winners.test.js
// Phase 1 v7.2 Test: Five Comparison Category Winners on Seed Data
// Contract: On seed data, the 5 comparison tabs for the Bluetooth speaker
// return 5 different offers in order:
// - Best Budget: Rs.699
// - Fastest Delivery: Rs.779
// - Best Rated Dealer: Rs.749
// - Best Value: Rs.725
// - Most Available: Rs.769

const test = require('node:test');
const assert = require('node:assert');
const seedData = require('../seed/seed-data');

test('Comparison Winners Calculation on Seed Data (v7.2)', () => {
  const speakerId = '60000000-0000-0000-0000-000000000001';
  const offers = seedData.dealerOffers.filter(o => o.product_id === speakerId);
  assert.strictEqual(offers.length, 5, 'Must have exactly 5 offers for Bluetooth speaker');

  const dealerMap = new Map(seedData.dealers.map(d => [d.dealer_id, d]));
  const invMap = new Map();
  seedData.inventory.forEach(inv => {
    if (!invMap.has(inv.offer_id)) invMap.set(inv.offer_id, []);
    invMap.get(inv.offer_id).push(inv);
  });

  const parsedOffers = offers.map(o => {
    const dealer = dealerMap.get(o.dealer_id);
    const invList = invMap.get(o.offer_id) || [];
    const freeUnits = invList.reduce((sum, i) => sum + (i.quantity - i.reserved_quantity), 0);
    return {
      offer_id: o.offer_id,
      selling_price: o.selling_price,
      delivery_days: o.bangalore_delivery_days,
      rating: dealer.dealer_rating,
      reviews: dealer.total_reviews,
      stock: freeUnits
    };
  });

  // Calculate Best Value normalized scores
  const minPrice = Math.min(...parsedOffers.map(o => o.selling_price));
  const maxPrice = Math.max(...parsedOffers.map(o => o.selling_price));
  const minDays = Math.min(...parsedOffers.map(o => o.delivery_days));
  const maxDays = Math.max(...parsedOffers.map(o => o.delivery_days));

  parsedOffers.forEach(o => {
    const priceNorm = 100 * (maxPrice - o.selling_price) / (maxPrice - minPrice);
    const deliveryNorm = 100 * (maxDays - o.delivery_days) / (maxDays - minDays);
    const ratingNorm = 100 * o.rating / 5;
    const stockNorm = 100;
    o.value_score = 0.45 * priceNorm + 0.25 * deliveryNorm + 0.20 * ratingNorm + 0.10 * stockNorm;
  });

  // 1. Best Budget: selling_price ASC, delivery_days ASC, rating DESC
  const budgetWinner = [...parsedOffers].sort((a,b) =>
    a.selling_price - b.selling_price || a.delivery_days - b.delivery_days || b.rating - a.rating
  )[0];

  // 2. Fastest Delivery: delivery_days ASC, selling_price ASC
  const deliveryWinner = [...parsedOffers].sort((a,b) =>
    a.delivery_days - b.delivery_days || a.selling_price - b.selling_price
  )[0];

  // 3. Best Rated Dealer: rating DESC, reviews DESC, selling_price ASC
  const ratedWinner = [...parsedOffers].sort((a,b) =>
    b.rating - a.rating || b.reviews - a.reviews || a.selling_price - b.selling_price
  )[0];

  // 4. Best Value: value_score DESC, selling_price ASC
  const valueWinner = [...parsedOffers].sort((a,b) =>
    b.value_score - a.value_score || a.selling_price - b.selling_price
  )[0];

  // 5. Most Available: stock DESC, selling_price ASC
  const availWinner = [...parsedOffers].sort((a,b) =>
    b.stock - a.stock || a.selling_price - b.selling_price
  )[0];

  // Assert exact expected prices in rupees
  assert.strictEqual(budgetWinner.selling_price, 69900, 'Budget winner must be Rs.699');
  assert.strictEqual(deliveryWinner.selling_price, 77900, 'Fastest delivery winner must be Rs.779');
  assert.strictEqual(ratedWinner.selling_price, 74900, 'Best rated dealer winner must be Rs.749');
  assert.strictEqual(valueWinner.selling_price, 72500, 'Best value winner must be Rs.725');
  assert.strictEqual(availWinner.selling_price, 76900, 'Most available winner must be Rs.769');

  // Assert all 5 winners are distinct offers
  const uniqueWinners = new Set([
    budgetWinner.offer_id,
    deliveryWinner.offer_id,
    ratedWinner.offer_id,
    valueWinner.offer_id,
    availWinner.offer_id
  ]);
  assert.strictEqual(uniqueWinners.size, 5, 'All five category winners must be distinct offers');
});
