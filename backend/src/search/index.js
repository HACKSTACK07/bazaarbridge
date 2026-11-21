/**
 * BazaarBridge Search Service (Authoritative Contract v7.2)
 *
 * Implements:
 * - searchOffers({ q, category, maxPricePaise, city, limit })
 * - upsertOffer(offerId, options)
 * - ensureIndex(client)
 * - deriveOtp(groupId)
 * - hashOtpSubmission(code)
 * - verifyOtpProof(groupId, proof)
 *
 * Exported so Agent B can import directly into Express API routes at the hour-4 merge.
 */

const { OpenSearchClient } = require('./client');
const { deriveOtp, hashOtpSubmission, verifyOtpProof } = require('./otp');

const DEFAULT_INDEX = 'offers';

// Singleton client instance for application use
let defaultClient = null;

function getClient(customClient) {
  if (customClient) return customClient;
  if (!defaultClient) {
    defaultClient = new OpenSearchClient();
  }
  return defaultClient;
}

/**
 * Creates the OpenSearch 'offers' index with the typo-tolerant analyzer
 * and locked schema mappings if it does not already exist.
 *
 * Rules:
 * - quick_available and hub_units are NOT fields.
 * - OTP material, passwords, customer info, reference price history are NEVER indexed.
 */
async function ensureIndex(customClient = null) {
  const client = getClient(customClient);
  const exists = await client.indexExists(DEFAULT_INDEX);
  if (exists) {
    return { created: false, message: `Index [${DEFAULT_INDEX}] already exists` };
  }

  const indexDefinition = {
    settings: {
      analysis: {
        normalizer: {
          lowercase_normalizer: {
            type: 'custom',
            filter: ['lowercase', 'trim']
          }
        },
        analyzer: {
          typo_tolerant_analyzer: {
            type: 'custom',
            tokenizer: 'standard',
            filter: ['lowercase', 'asciifolding']
          }
        }
      }
    },
    mappings: {
      properties: {
        offer_id: { type: 'keyword' },
        product_id: { type: 'keyword' },
        product_name: {
          type: 'text',
          analyzer: 'typo_tolerant_analyzer',
          fields: {
            keyword: { type: 'keyword' }
          }
        },
        brand: {
          type: 'text',
          analyzer: 'typo_tolerant_analyzer',
          fields: {
            keyword: { type: 'keyword' }
          }
        },
        category_name: {
          type: 'keyword',
          normalizer: 'lowercase_normalizer'
        },
        specs: { type: 'object', enabled: false },
        dealer_id: { type: 'keyword' },
        shop_name: { type: 'text' },
        dealer_city: {
          type: 'keyword',
          normalizer: 'lowercase_normalizer'
        },
        dealer_state: {
          type: 'keyword',
          normalizer: 'lowercase_normalizer'
        },
        origin_city: { type: 'keyword' },
        origin_state: { type: 'keyword' },
        is_outside_bangalore: { type: 'boolean' },
        fulfilment_route: { type: 'keyword' },
        selling_price: { type: 'long' },
        available_units: { type: 'integer' },
        home_units: { type: 'integer' },
        eligible_modes: { type: 'keyword' },
        bangalore_delivery_days: { type: 'integer' },
        transfer_days_max: { type: 'integer' },
        effective_days: { type: 'integer' },
        dealer_rating: { type: 'float' },
        total_reviews: { type: 'integer' },
        verified: { type: 'boolean' },
        warranty_months: { type: 'integer' },
        revision: { type: 'long' }
      }
    }
  };

  await client.createIndex(DEFAULT_INDEX, indexDefinition);
  return { created: true, message: `Index [${DEFAULT_INDEX}] created with typo-tolerant mapping` };
}

/**
 * Typo-tolerant discovery and candidate retrieval via OpenSearch.
 *
 * Contract rule:
 * NEVER return price, stock, or quick delivery eligibility from OpenSearch.
 * Those fields are rechecked strictly against PostgreSQL by Agent B.
 *
 * @param {object} params
 * @param {string} params.q - Search query text
 * @param {string} [params.category] - Category filter
 * @param {number|bigint} [params.maxPricePaise] - Price ceiling
 * @param {string} [params.city] - Dealer city filter
 * @param {number} [params.limit=20] - Max candidate hits
 * @param {OpenSearchClient} [customClient] - Optional client override
 * @returns {Promise<{ hits: Array<{ offer_id: string, product_id: string }> }>}
 */
async function searchOffers(params = {}, customClient = null) {
  const client = getClient(customClient);
  const { q, category, maxPricePaise, city, limit = 20 } = params;

  const mustClauses = [];
  const filterClauses = [];

  if (q && String(q).trim()) {
    mustClauses.push({
      multi_match: {
        query: String(q).trim(),
        fields: ['product_name^2', 'brand'],
        fuzziness: 'AUTO',
        operator: 'or'
      }
    });
  } else {
    mustClauses.push({ match_all: {} });
  }

  if (category) {
    filterClauses.push({
      term: { category_name: String(category).toLowerCase() }
    });
  }

  if (city) {
    filterClauses.push({
      term: { dealer_city: String(city).toLowerCase() }
    });
  }

  if (maxPricePaise !== undefined && maxPricePaise !== null) {
    filterClauses.push({
      range: { selling_price: { lte: Number(maxPricePaise) } }
    });
  }

  const searchBody = {
    size: limit,
    query: {
      bool: {
        must: mustClauses,
        filter: filterClauses
      }
    },
    _source: ['offer_id', 'product_id']
  };

  const response = await client.search(DEFAULT_INDEX, searchBody);
  const rawHits = response.hits?.hits || [];

  // Strictly enforce contract: Only return offer_id and product_id
  const hits = rawHits.map(h => ({
    offer_id: h._source?.offer_id || h._id,
    product_id: h._source?.product_id
  }));

  return { hits };
}

/**
 * Indexes or updates an offer in OpenSearch with external versioning.
 *
 * Behavior:
 * 1. Reads truth AND revision in ONE atomic PostgreSQL statement (Truth Statement).
 * 2. Assembles locked document structure (no prohibited fields).
 * 3. Upserts document id = offer_id with version_type=external_gte&version=rev.
 * 4. If OpenSearch returns 409 Version Conflict, treats it as 'stale' (newer revision already indexed = success).
 *
 * @param {string} offerId - UUID of offer
 * @param {object} [options]
 * @param {object} [options.dbClient] - PostgreSQL client/pool
 * @param {object} [options.offerDoc] - Explicit pre-built document for testing
 * @param {number} [options.revision] - Explicit revision override for testing
 * @param {OpenSearchClient} [options.client] - Optional client override
 * @returns {Promise<{ revision: number, outcome: 'written' | 'stale' }>}
 */
async function upsertOffer(offerId, options = {}) {
  const client = getClient(options.client);
  let doc = null;
  let rev = null;

  if (options.offerDoc) {
    doc = { ...options.offerDoc };
    rev = options.revision !== undefined ? Number(options.revision) : Number(doc.revision || 1);
  } else if (options.dbClient) {
    // Atomic Truth Statement per Section 8 of agent-rules.md
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
    const res = await options.dbClient.query(truthQuery, [offerId]);
    if (!res.rows || res.rows.length === 0) {
      throw new Error(`Offer [${offerId}] not found in database`);
    }

    const row = res.rows[0];
    rev = Number(row.revision);

    const homeUnits = Number(row.home_units || 0);
    const effectiveDays = homeUnits > 0
      ? (row.bangalore_delivery_days || 1)
      : (row.transfer_days_max || 3);

    doc = {
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
      revision: rev
    };
  } else {
    throw new Error('upsertOffer requires options.dbClient or options.offerDoc');
  }

  // Sanitize document: strictly remove prohibited fields if accidentally present
  delete doc.quick_available;
  delete doc.hub_units;
  delete doc.otp;
  delete doc.otp_hash;
  delete doc.otp_proof;
  delete doc.price_history;

  doc.revision = rev;

  try {
    await client.indexDocument(
      DEFAULT_INDEX,
      offerId,
      doc,
      rev,
      'external_gte'
    );
    return { revision: rev, outcome: 'written' };
  } catch (err) {
    if (err.statusCode === 409 || err.body?.status === 409) {
      // 409 Version Conflict means a newer revision is already indexed = success
      return { revision: rev, outcome: 'stale' };
    }
    throw err;
  }
}

module.exports = {
  searchOffers,
  upsertOffer,
  ensureIndex,
  deriveOtp,
  hashOtpSubmission,
  verifyOtpProof,
  OpenSearchClient
};
