/**
 * BazaarBridge Shopping Assistant (FEATURE_ASSISTANT)
 * Translates ONE customer message into ONE validated filter object.
 * Grounded strictly in PostgreSQL truth. No hallucinated products, prices, or ratings.
 * Follows agent-rules.md Section 08 and Phase 2 Service Contracts.
 */

const { query } = require('../db');

// In-memory rate limiting map: userId -> { count, resetTime }
const assistantRateLimit = new Map();

// Optional Agent C search service
let searchService = null;
try {
  searchService = require('../search');
} catch (e) {
  // Agent C develops in parallel; fallback provided
}

const VALID_CATEGORIES = [
  'Electronics',
  'Audio & Wearables',
  'Smart Home & Appliances',
  'Computing & Accessories',
  'Gaming & Gear'
];

/**
 * Validates and sanitizes Gemini-extracted filters.
 * Rejects unknown fields, negative budgets, unreasonable delivery days and unsupported categories.
 */
function validateFilters(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object') return clean;

  // 1. category
  if (typeof raw.category === 'string') {
    const matched = VALID_CATEGORIES.find(c => c.toLowerCase() === raw.category.toLowerCase().trim());
    if (matched) clean.category = matched;
  }

  // 2. product_type (sanitized string, max 60 chars)
  if (typeof raw.product_type === 'string' && raw.product_type.trim().length <= 60) {
    clean.product_type = raw.product_type.trim();
  }

  // 3. connectivity ('wireless', 'bluetooth', 'wired', 'usb-c')
  if (typeof raw.connectivity === 'string') {
    const conn = raw.connectivity.toLowerCase().trim();
    if (['wireless', 'bluetooth', 'wired', 'usb-c'].includes(conn)) {
      clean.connectivity = conn;
    }
  }

  // 4. features array (string items, max 5)
  if (Array.isArray(raw.features)) {
    clean.features = raw.features
      .filter(f => typeof f === 'string' && f.trim().length <= 50)
      .slice(0, 5)
      .map(f => f.trim());
  }

  // 5. max_price (paise, must be positive, reasonable ceiling 100,000,000 paise = ₹1,000,000)
  if (raw.max_price !== undefined && raw.max_price !== null) {
    const p = Number(raw.max_price);
    if (!isNaN(p) && p > 0 && p <= 100000000) {
      clean.max_price = Math.floor(p);
    }
  }

  // 6. max_delivery_days (1 to 14 days)
  if (raw.max_delivery_days !== undefined && raw.max_delivery_days !== null) {
    const d = Number(raw.max_delivery_days);
    if (!isNaN(d) && d >= 1 && d <= 14) {
      clean.max_delivery_days = Math.floor(d);
    }
  }

  // 7. city (sanitized string, max 50 chars)
  if (typeof raw.city === 'string' && raw.city.trim().length <= 50) {
    clean.city = raw.city.trim();
  }

  // 8. delivery_mode ('quick' | 'standard')
  if (raw.delivery_mode === 'quick' || raw.delivery_mode === 'standard') {
    clean.delivery_mode = raw.delivery_mode;
  }

  // 9. sort_preference ('budget' | 'fastest' | 'rated' | 'value' | 'available')
  if (['budget', 'fastest', 'rated', 'value', 'available'].includes(raw.sort_preference)) {
    clean.sort_preference = raw.sort_preference;
  } else {
    clean.sort_preference = 'value';
  }

  return clean;
}

/**
 * Calls Gemini server-side with structured JSON schema
 */
async function callGemini(message) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: 'NO_API_KEY' };
  }

  const modelId = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const prompt = `You are a shopping assistant filter translator for an e-commerce platform called BazaarBridge.
Your ONLY role is to extract search filter constraints from the customer's message into structured JSON.
It is NOT a chatbot and NEVER invents products, prices, dealers, ratings, stock or delivery estimates.

Allowed filter keys ONLY:
- category: one of ["Electronics", "Audio & Wearables", "Smart Home & Appliances", "Computing & Accessories", "Gaming & Gear"]
- product_type: concise product noun (e.g. "laptop", "speaker", "headphones", "mouse")
- connectivity: one of ["wireless", "bluetooth", "wired", "usb-c"]
- features: array of strings (e.g. ["ANC", "RGB", "waterproof"])
- max_price: maximum price in PAISE (1 Rupee = 100 paise). If user says "under 2000", max_price is 200000. Do NOT assume a budget if none was mentioned.
- max_delivery_days: integer days (1-14)
- city: city name (e.g. "Bangalore", "Mysuru")
- delivery_mode: "quick" or "standard"
- sort_preference: one of ["budget", "fastest", "rated", "value", "available"]
- friendly_acknowledgement: concise 1-sentence acknowledgement grounded in user intent.

Customer message: "${message.replace(/"/g, '\\"')}"`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      response_mime_type: "application/json",
      response_schema: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING" },
          product_type: { type: "STRING" },
          connectivity: { type: "STRING" },
          features: { type: "ARRAY", items: { type: "STRING" } },
          max_price: { type: "INTEGER" },
          max_delivery_days: { type: "INTEGER" },
          city: { type: "STRING" },
          delivery_mode: { type: "STRING", enum: ["quick", "standard"] },
          sort_preference: { type: "STRING", enum: ["budget", "fastest", "rated", "value", "available"] },
          friendly_acknowledgement: { type: "STRING" }
        }
      }
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return { error: `GEMINI_HTTP_${res.status}` };
    }

    const data = await res.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      return { error: 'EMPTY_RESPONSE' };
    }

    const parsed = JSON.parse(candidateText);
    return { data: parsed };
  } catch (err) {
    clearTimeout(timeoutId);
    return { error: err.name === 'AbortError' ? 'TIMEOUT' : err.message };
  }
}

/**
 * Searches PostgreSQL for matching products & offers based on validated filters
 * Enforces the exact 5 ranking rules from agent-rules.md
 */
async function queryDatabaseForFilters(filters) {
  let candidateOfferIds = null;

  // Step 4: If Agent C searchService is available, fetch candidate IDs from OpenSearch
  if (searchService && typeof searchService.searchOffers === 'function') {
    try {
      const candidates = await searchService.searchOffers(filters);
      if (Array.isArray(candidates) && candidates.length > 0) {
        candidateOfferIds = candidates.map(c => c.offer_id).filter(Boolean);
      }
    } catch (e) {
      // Fallback directly to PostgreSQL truth
    }
  }

  // Step 5: Re-read products, offers, dealers, price and availability from PostgreSQL
  let sql = `
    SELECT 
      p.product_id, p.name as product_name, p.brand, c.category_name,
      o.offer_id, o.selling_price, o.eligible_modes, o.bangalore_delivery_days,
      d.dealer_id, d.shop_name, d.city as dealer_city, d.dealer_rating, d.total_reviews,
      COALESCE(SUM(CASE WHEN l.is_sellable THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0)::int as available_stock,
      CASE 
        WHEN COALESCE(SUM(CASE WHEN l.is_sellable AND l.is_home THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0) > 0 
        THEN o.bangalore_delivery_days 
        ELSE o.transfer_days_max 
      END as effective_days
    FROM products p
    JOIN categories c ON c.category_id = p.category_id
    JOIN dealer_offers o ON o.product_id = p.product_id AND o.status = 'active'
    JOIN dealers d ON d.dealer_id = o.dealer_id
    LEFT JOIN inventory i ON i.offer_id = o.offer_id
    LEFT JOIN stock_locations l ON l.location_id = i.location_id
    WHERE 1=1
  `;
  const params = [];

  if (candidateOfferIds && candidateOfferIds.length > 0) {
    params.push(candidateOfferIds);
    sql += ` AND o.offer_id = ANY($${params.length}::uuid[])`;
  }

  if (filters.category) {
    params.push(filters.category);
    sql += ` AND c.category_name = $${params.length}`;
  }

  if (filters.product_type) {
    params.push(`%${filters.product_type}%`);
    sql += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`;
  }

  if (filters.connectivity) {
    params.push(`%${filters.connectivity}%`);
    sql += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`;
  }

  if (filters.max_price) {
    params.push(filters.max_price);
    sql += ` AND o.selling_price <= $${params.length}`;
  }

  if (filters.city) {
    params.push(`%${filters.city}%`);
    sql += ` AND d.city ILIKE $${params.length}`;
  }

  if (filters.delivery_mode === 'quick') {
    sql += ` AND 'quick' = ANY(o.eligible_modes)`;
  }

  if (filters.max_delivery_days) {
    params.push(filters.max_delivery_days);
    sql += ` AND o.bangalore_delivery_days <= $${params.length}`;
  }

  sql += `
    GROUP BY p.product_id, c.category_name, o.offer_id, d.dealer_id
    HAVING COALESCE(SUM(CASE WHEN l.is_sellable THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0) > 0
  `;

  // Ranking rule from agent-rules.md
  if (filters.sort_preference === 'budget') {
    sql += ` ORDER BY o.selling_price ASC, effective_days ASC, d.dealer_rating DESC`;
  } else if (filters.sort_preference === 'fastest') {
    sql += ` ORDER BY effective_days ASC, o.selling_price ASC`;
  } else if (filters.sort_preference === 'rated') {
    sql += ` ORDER BY d.dealer_rating DESC, d.total_reviews DESC, o.selling_price ASC`;
  } else if (filters.sort_preference === 'available') {
    sql += ` ORDER BY available_stock DESC, o.selling_price ASC`;
  } else {
    // Default base sort for Value calculation
    sql += ` ORDER BY o.selling_price ASC`;
  }

  sql += ` LIMIT 10;`;

  const res = await query(sql, params);
  let rows = res.rows.map(r => ({
    ...r,
    selling_price: Number(r.selling_price),
    effective_days: Number(r.effective_days || 3),
    dealer_rating: Number(r.dealer_rating),
    total_reviews: Number(r.total_reviews),
    available_stock: Number(r.available_stock)
  }));

  // Step 6: Value Scoring if sort_preference === 'value'
  // 0.45*price + 0.25*delivery + 0.20*rating + 0.10*stock
  if (filters.sort_preference === 'value' && rows.length > 0) {
    const prices = rows.map(o => o.selling_price);
    const days = rows.map(o => o.effective_days);
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const maxDays = Math.max(...days);
    const minDays = Math.min(...days);

    rows = rows.map(o => {
      const scorePrice = maxPrice === minPrice ? 100 : (100 * (maxPrice - o.selling_price)) / (maxPrice - minPrice);
      const scoreDelivery = maxDays === minDays ? 100 : (100 * (maxDays - o.effective_days)) / (maxDays - minDays);
      const scoreRating = (100 * o.dealer_rating) / 5;
      const scoreStock = 100;
      const totalScore = 0.45 * scorePrice + 0.25 * scoreDelivery + 0.20 * scoreRating + 0.10 * scoreStock;
      return { ...o, value_score: totalScore };
    });

    rows.sort((a, b) => {
      if (b.value_score !== a.value_score) return b.value_score - a.value_score;
      return a.selling_price - b.selling_price;
    });
  }

  // Step 7: Grounded explanation string per row
  return rows.map(r => {
    const priceRupees = Math.round(r.selling_price / 100);
    let reason = '';
    if (filters.sort_preference === 'budget') {
      reason = `Lowest price ₹${priceRupees} with ${r.effective_days}-day delivery`;
    } else if (filters.sort_preference === 'fastest') {
      reason = `Fastest delivery in ${r.effective_days} days from ${r.shop_name} (₹${priceRupees})`;
    } else if (filters.sort_preference === 'rated') {
      reason = `Top rated dealer (${r.dealer_rating}★ with ${r.total_reviews} reviews)`;
    } else if (filters.sort_preference === 'available') {
      reason = `Highest stock with ${r.available_stock} units ready for dispatch`;
    } else {
      reason = `Best value balance: ₹${priceRupees}, ${r.effective_days}-day delivery, ${r.dealer_rating}★ dealer`;
    }
    return { ...r, reason };
  });
}

/**
 * POST /api/shopping-assistant handler
 */
async function handleShoppingAssistant(req, res) {
  const userId = req.user.user_id;
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'message string is required' });
  }

  if (message.length > 500) {
    return res.status(400).json({ error: 'MESSAGE_TOO_LONG', message: 'Message exceeds 500 characters' });
  }

  // Rate limiting: 20 requests per minute per user in memory
  const now = Date.now();
  const userRate = assistantRateLimit.get(userId);
  if (!userRate || now > userRate.resetTime) {
    assistantRateLimit.set(userId, { count: 1, resetTime: now + 60000 });
  } else {
    if (userRate.count >= 20) {
      return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Shopping assistant rate limit exceeded (20 req/min)' });
    }
    userRate.count++;
  }

  let validatedFilters = {};
  let isFallback = false;
  let assistantMessage = '';

  // Step 1: Call Gemini server-side
  let geminiOutcome = await callGemini(message);

  // If timeout or invalid JSON, retry ONCE as per specification
  if (geminiOutcome.error && geminiOutcome.error !== 'NO_API_KEY') {
    geminiOutcome = await callGemini(message);
  }

  if (geminiOutcome.data) {
    validatedFilters = validateFilters(geminiOutcome.data);
    assistantMessage = geminiOutcome.data.friendly_acknowledgement || 'Here are the matching products based on your criteria.';
  } else {
    // Labelled rule-based fallback beats a broken chatbot
    isFallback = true;
    for (const cat of VALID_CATEGORIES) {
      if (message.toLowerCase().includes(cat.toLowerCase())) {
        validatedFilters.category = cat;
        break;
      }
    }
    if (message.toLowerCase().includes('cheap') || message.toLowerCase().includes('budget')) {
      validatedFilters.sort_preference = 'budget';
    } else if (message.toLowerCase().includes('fast') || message.toLowerCase().includes('quick')) {
      validatedFilters.sort_preference = 'fastest';
      validatedFilters.delivery_mode = 'quick';
    } else if (message.toLowerCase().includes('rated') || message.toLowerCase().includes('best')) {
      validatedFilters.sort_preference = 'rated';
    }

    assistantMessage = "Showing verified catalog matches for your query.";
  }

  // Step 2: Query PostgreSQL database (Source of truth)
  const results = await queryDatabaseForFilters(validatedFilters);

  // Vague requests or no matches: suggest relaxing filters
  if (results.length === 0) {
    if (validatedFilters.max_price) {
      assistantMessage = "No in-stock items found within this price range. Try increasing your budget or exploring other categories.";
    } else if (validatedFilters.delivery_mode === 'quick') {
      assistantMessage = "No quick-delivery offers available for this item. Try standard delivery for wider selection.";
    } else {
      assistantMessage = "No items matched your exact criteria. Try broadening your keywords or removing filters.";
    }
  }

  return res.json({
    filters: validatedFilters,
    results,
    message: assistantMessage,
    fallback: isFallback
  });
}

module.exports = { handleShoppingAssistant };
