/**
 * BazaarBridge Shopping Assistant (FEATURE_ASSISTANT)
 * Translates ONE customer message into ONE validated filter object.
 * Grounded strictly in PostgreSQL truth. No hallucinated products, prices, or ratings.
 */

const { query } = require('../db');

// In-memory rate limiting map: userId -> { count, resetTime }
const assistantRateLimit = new Map();

const VALID_CATEGORIES = [
  'Electronics',
  'Audio & Wearables',
  'Smart Home & Appliances',
  'Computing & Accessories',
  'Gaming & Gear'
];

/**
 * Validates and sanitizes Gemini-extracted filters.
 */
function validateFilters(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object') return clean;

  // Category
  if (typeof raw.category === 'string') {
    const matched = VALID_CATEGORIES.find(c => c.toLowerCase() === raw.category.toLowerCase().trim());
    if (matched) clean.category = matched;
  }

  // Product type (sanitized string)
  if (typeof raw.product_type === 'string' && raw.product_type.length <= 60) {
    clean.product_type = raw.product_type.trim();
  }

  // Connectivity
  if (typeof raw.connectivity === 'string' && ['wireless', 'bluetooth', 'wired', 'usb-c'].includes(raw.connectivity.toLowerCase())) {
    clean.connectivity = raw.connectivity.toLowerCase();
  }

  // Features array
  if (Array.isArray(raw.features)) {
    clean.features = raw.features
      .filter(f => typeof f === 'string' && f.length <= 50)
      .slice(0, 5);
  }

  // max_price in paise (must be > 0 and <= 100,000,000 paise = ₹1,000,000)
  if (raw.max_price !== undefined && raw.max_price !== null) {
    const p = Number(raw.max_price);
    if (!isNaN(p) && p > 0 && p <= 100000000) {
      clean.max_price = Math.floor(p);
    }
  }

  // max_delivery_days (1 to 14 days)
  if (raw.max_delivery_days !== undefined && raw.max_delivery_days !== null) {
    const d = Number(raw.max_delivery_days);
    if (!isNaN(d) && d >= 1 && d <= 14) {
      clean.max_delivery_days = Math.floor(d);
    }
  }

  // City
  if (typeof raw.city === 'string' && raw.city.trim().length <= 50) {
    clean.city = raw.city.trim();
  }

  // Delivery mode
  if (raw.delivery_mode === 'quick' || raw.delivery_mode === 'standard') {
    clean.delivery_mode = raw.delivery_mode;
  }

  // Sort preference
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

  const prompt = `You are a shopping assistant filter translator for an e-commerce platform called BazaarBridge.
Your ONLY role is to extract search filter constraints from the user's message.
Valid categories are: "Electronics", "Audio & Wearables", "Smart Home & Appliances", "Computing & Accessories", "Gaming & Gear".
Do NOT guess or hallucinate specific product IDs, prices, or inventory counts.
If budget is mentioned in rupees, convert it to paise (1 Rupee = 100 paise).
Do NOT invent a budget if none was mentioned.
Sort preference must be one of: "budget", "fastest", "rated", "value", "available".

User message: "${message.replace(/"/g, '\\"')}"`;

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
          max_price: { type: "INTEGER", description: "Maximum price in paise" },
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
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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
 */
async function queryDatabaseForFilters(filters) {
  let sql = `
    SELECT 
      p.product_id, p.name as product_name, p.brand, c.category_name,
      o.offer_id, o.selling_price, o.eligible_modes, o.bangalore_delivery_days,
      d.dealer_id, d.shop_name, d.city as dealer_city, d.dealer_rating, d.total_reviews,
      COALESCE(SUM(CASE WHEN l.is_sellable THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0)::int as available_stock
    FROM products p
    JOIN categories c ON c.category_id = p.category_id
    JOIN dealer_offers o ON o.product_id = p.product_id AND o.status = 'active'
    JOIN dealers d ON d.dealer_id = o.dealer_id
    LEFT JOIN inventory i ON i.offer_id = o.offer_id
    LEFT JOIN stock_locations l ON l.location_id = i.location_id
    WHERE 1=1
  `;
  const params = [];

  if (filters.category) {
    params.push(filters.category);
    sql += ` AND c.category_name = $${params.length}`;
  }

  if (filters.product_type) {
    params.push(`%${filters.product_type}%`);
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

  sql += `
    GROUP BY p.product_id, c.category_name, o.offer_id, d.dealer_id
    HAVING COALESCE(SUM(CASE WHEN l.is_sellable THEN (i.quantity - i.reserved_quantity) ELSE 0 END), 0) > 0
  `;

  // Sort preference
  if (filters.sort_preference === 'budget') {
    sql += ` ORDER BY o.selling_price ASC`;
  } else if (filters.sort_preference === 'fastest') {
    sql += ` ORDER BY o.bangalore_delivery_days ASC, o.selling_price ASC`;
  } else if (filters.sort_preference === 'rated') {
    sql += ` ORDER BY d.dealer_rating DESC, d.total_reviews DESC, o.selling_price ASC`;
  } else if (filters.sort_preference === 'available') {
    sql += ` ORDER BY available_stock DESC, o.selling_price ASC`;
  } else {
    // Value: default
    sql += ` ORDER BY o.selling_price ASC`;
  }

  sql += ` LIMIT 10;`;

  const res = await query(sql, params);
  return res.rows.map(r => ({
    ...r,
    selling_price: Number(r.selling_price),
    dealer_rating: Number(r.dealer_rating),
    available_stock: Number(r.available_stock)
  }));
}

/**
 * POST /api/shopping-assistant handler
 */
async function handleShoppingAssistant(req, res) {
  const userId = req.user.user_id;
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'Message is required' });
  }

  if (message.length > 500) {
    return res.status(400).json({ error: 'MESSAGE_TOO_LONG', message: 'Message exceeds 500 characters' });
  }

  // Rate limiting: 20 per minute per user in memory
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

  // Step 1: Call Gemini
  let geminiOutcome = await callGemini(message);

  // If first call timed out or failed, retry ONCE as per specification
  if (geminiOutcome.error && geminiOutcome.error !== 'NO_API_KEY') {
    geminiOutcome = await callGemini(message);
  }

  if (geminiOutcome.data) {
    validatedFilters = validateFilters(geminiOutcome.data);
    assistantMessage = geminiOutcome.data.friendly_acknowledgement || 'Here are the matching products based on your criteria.';
  } else {
    // Fallback: rule-based keyword extraction
    isFallback = true;
    for (const cat of VALID_CATEGORIES) {
      if (message.toLowerCase().includes(cat.toLowerCase())) {
        validatedFilters.category = cat;
        break;
      }
    }
    if (message.toLowerCase().includes('cheap') || message.toLowerCase().includes('budget')) {
      validatedFilters.sort_preference = 'budget';
    } else if (message.toLowerCase().includes('quick') || message.toLowerCase().includes('fast')) {
      validatedFilters.sort_preference = 'fastest';
      validatedFilters.delivery_mode = 'quick';
    }
    assistantMessage = isFallback
      ? "Showing verified in-stock catalog results for your request."
      : "Here are the best matching items.";
  }

  // Step 2: Query PostgreSQL database (Source of truth)
  const results = await queryDatabaseForFilters(validatedFilters);

  if (results.length === 0) {
    assistantMessage = "No exact in-stock items matched all filters. Try broadening your budget or delivery preferences.";
  }

  return res.json({
    filters: validatedFilters,
    results,
    message: assistantMessage,
    fallback: isFallback
  });
}

module.exports = { handleShoppingAssistant };
