/**
 * Consumer "search-sync" (Authoritative Contract v7.2)
 *
 * Topic: bazaar.core.events
 * Events: inventory-updated, offer-price-updated (Keyed by offer_id)
 * Execution Pattern: PATTERN B (OpenSearch writes outside PostgreSQL transaction)
 *
 * Rules:
 * 1. Marker check: Check processed_events; if marked -> ack, skip.
 * 2. Read truth AND revision in ONE atomic statement (paused hubs excluded).
 * 3. upsertOffer() with version_type=external_gte&version=rev.
 *    - 409 Version Conflict = a newer revision is indexed = SUCCESS, never retry.
 * 4. ONLY after OpenSearch write succeeds (or is stale):
 *    Execute ONE PostgreSQL transaction with the marker (ON CONFLICT DO NOTHING); commit.
 * 5. Ack message.
 * 6. NEVER put the OpenSearch call inside a PostgreSQL transaction!
 */

const { upsertOffer } = require('../search/index');

const CONSUMER_NAME = 'search-sync';

/**
 * Handles 'inventory-updated' or 'offer-price-updated' events using Pattern B.
 *
 * @param {object} params
 * @param {string} params.eventId - Unique UUID of outbox event
 * @param {object} params.payload - Event payload containing offer_id
 * @param {string} params.aggregateKey - Kafka message key (offer_id)
 * @param {object} db - Database pool or client
 * @param {object} [searchClient] - Optional OpenSearch client override
 * @returns {Promise<{ status: string, offerId?: string, outcome?: string }>}
 */
async function processSearchSync({ eventId, payload, aggregateKey }, db, searchClient = null) {
  const offerId = payload?.offer_id || aggregateKey;
  if (!offerId) {
    throw new Error('offer_id is required for search-sync');
  }

  // 1. Marker check: Check if already processed
  const markerCheckQuery = `
    SELECT 1 FROM processed_events
    WHERE event_id = $1 AND consumer_name = $2;
  `;
  const markerCheckRes = await db.query(markerCheckQuery, [eventId, CONSUMER_NAME]);

  if (markerCheckRes.rowCount > 0) {
    return { status: 'SKIPPED', reason: 'ALREADY_PROCESSED' };
  }

  // 2. Read truth AND revision in ONE statement (paused hubs excluded)
  // Truth Statement from Section 8 of agent-rules.md
  const truthQuery = `
    SELECT o.offer_id, o.product_id, o.selling_price, o.status, v.revision,
    coalesce(sum(case when l.is_sellable and (h.hub_id is null or h.active)
      then i.quantity - i.reserved_quantity else 0 end), 0) as free_units,
    coalesce(sum(case when l.is_sellable and l.is_home
      then i.quantity - i.reserved_quantity else 0 end), 0) as home_units,
    p.name as product_name, p.brand, p.specs,
    c.category_name,
    d.dealer_id, d.shop_name, d.city as dealer_city, d.state as dealer_state,
    d.dealer_rating, d.total_reviews, d.verified,
    o.bangalore_delivery_days, o.transfer_days_max, o.eligible_modes, o.warranty_months
    FROM dealer_offers o
    JOIN offer_state_versions v on v.offer_id = o.offer_id
    JOIN products p on p.product_id = o.product_id
    JOIN categories c on c.category_id = p.category_id
    JOIN dealers d on d.dealer_id = o.dealer_id
    LEFT JOIN inventory i on i.offer_id = o.offer_id
    LEFT JOIN stock_locations l on l.location_id = i.location_id
    LEFT JOIN fulfilment_hubs h on h.location_id = l.location_id
    WHERE o.offer_id = $1
    GROUP BY o.offer_id, o.product_id, o.selling_price, o.status, v.revision,
             p.name, p.brand, p.specs, c.category_name,
             d.dealer_id, d.shop_name, d.city, d.state, d.dealer_rating, d.total_reviews, d.verified,
             o.bangalore_delivery_days, o.transfer_days_max, o.eligible_modes, o.warranty_months;
  `;

  const truthRes = await db.query(truthQuery, [offerId]);
  if (!truthRes.rows || truthRes.rows.length === 0) {
    // If offer was deleted or does not exist, commit marker and ack
    await db.query(`
      INSERT INTO processed_events (event_id, consumer_name)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING;
    `, [eventId, CONSUMER_NAME]);
    return { status: 'OFFER_NOT_FOUND', offerId };
  }

  const row = truthRes.rows[0];
  const revision = Number(row.revision);

  const homeUnits = Number(row.home_units || 0);
  const effectiveDays = homeUnits > 0
    ? (row.bangalore_delivery_days || 1)
    : (row.transfer_days_max || 3);

  // Assemble locked document structure
  const offerDoc = {
    offer_id: row.offer_id,
    product_id: row.product_id,
    product_name: row.product_name,
    brand: row.brand,
    category_name: row.category_name,
    specs: row.specs || {},
    dealer_id: row.dealer_id,
    shop_name: row.shop_name,
    dealer_city: row.dealer_city,
    dealer_state: row.dealer_state,
    origin_city: row.dealer_city,
    origin_state: row.dealer_state,
    is_outside_bangalore: (row.dealer_city || '').toLowerCase() !== 'bangalore',
    fulfilment_route: homeUnits > 0 ? 'bangalore_direct' : 'inter_location_transfer',
    selling_price: Number(row.selling_price),
    available_units: Number(row.free_units),
    home_units: homeUnits,
    eligible_modes: row.eligible_modes || ['standard'],
    bangalore_delivery_days: row.bangalore_delivery_days,
    transfer_days_max: row.transfer_days_max,
    effective_days: effectiveDays,
    dealer_rating: Number(row.dealer_rating || 0),
    total_reviews: Number(row.total_reviews || 0),
    verified: Boolean(row.verified),
    warranty_months: Number(row.warranty_months || 0),
    revision
  };

  // 3. Upsert into OpenSearch with external versioning (OUTSIDE any PG transaction)
  // 409 Version Conflict is treated as outcome 'stale' (SUCCESS)
  const upsertRes = await upsertOffer(offerId, {
    offerDoc,
    revision,
    client: searchClient
  });

  // 4. ONLY after OpenSearch write succeeds (or is stale): execute one PG transaction with marker
  const recordMarkerQuery = `
    INSERT INTO processed_events (event_id, consumer_name)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING;
  `;
  await db.query(recordMarkerQuery, [eventId, CONSUMER_NAME]);

  return {
    status: 'SYNCED',
    offerId,
    revision,
    outcome: upsertRes.outcome
  };
}

module.exports = {
  CONSUMER_NAME,
  processSearchSync
};
