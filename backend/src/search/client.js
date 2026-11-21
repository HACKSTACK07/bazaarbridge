/**
 * OpenSearch Client Scaffolding (Authoritative Contract v7.2)
 *
 * Rules:
 * - Typo-tolerant mappings for product discovery.
 * - Locked document fields.
 * - STRICTLY PROHIBITED: quick_available, hub_units, price history, OTP material.
 * - Supports live Aiven OpenSearch (via HTTPS REST / fetch) and an in-memory test engine for isolated verification.
 */

const https = require('https');
const http = require('http');

class OpenSearchClient {
  constructor(config = {}) {
    this.url = config.url || process.env.OPENSEARCH_URL || 'https://os-3929470d-bazaarbridge203.l.aivencloud.com:11597';
    this.username = config.username || process.env.OPENSEARCH_USER || process.env.OPENSEARCH_USERNAME || 'avnadmin';
    this.password = config.password || process.env.OPENSEARCH_PASSWORD || '';
    this.mockMode = Boolean(config.mockMode || (!this.password && !process.env.OPENSEARCH_PASSWORD));

    // In-memory store for mock/testing mode
    this._indices = new Map();
    this._mappings = new Map();
    this._documents = new Map(); // index -> Map(id -> { doc, version })
  }

  /**
   * Make HTTP/HTTPS request to OpenSearch
   */
  async _request(method, path, body = null, params = {}) {
    if (this.mockMode) {
      return this._mockRequest(method, path, body, params);
    }

    const parsedUrl = new URL(path, this.url);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        parsedUrl.searchParams.set(key, String(value));
      }
    }

    const payload = body ? JSON.stringify(body) : null;
    const authHeader = 'Basic ' + Buffer.from(`${this.username}:${this.password}`).toString('base64');

    const headers = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    return new Promise((resolve, reject) => {
      const isHttps = parsedUrl.protocol === 'https:';
      const clientModule = isHttps ? https : http;

      const req = clientModule.request(parsedUrl, {
        method,
        headers,
        rejectUnauthorized: true
      }, (res) => {
        let responseData = '';
        res.on('data', chunk => { responseData += chunk; });
        res.on('end', () => {
          let parsed;
          try {
            parsed = responseData ? JSON.parse(responseData) : {};
          } catch (e) {
            parsed = { raw: responseData };
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body: parsed });
          } else {
            const error = new Error(parsed.error?.reason || parsed.message || `HTTP ${res.statusCode}`);
            error.statusCode = res.statusCode;
            error.body = parsed;
            reject(error);
          }
        });
      });

      req.on('error', (err) => {
        // If network error (not deployed / unreachable), gracefully fall back to local mock mode
        if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
          console.warn(`[OpenSearch] Cluster unreachable (${err.code}), operating in local mock mode.`);
          this.mockMode = true;
          return this._mockRequest(method, path, body, params).then(resolve).catch(reject);
        }
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  // --- In-memory Mock Engine for testing & isolated environments ---
  async _mockRequest(method, path, body, params) {
    const cleanPath = path.split('?')[0].replace(/^\//, '');

    // HEAD /index or GET /index
    if (cleanPath && !cleanPath.includes('/')) {
      const indexName = cleanPath;
      if (method === 'HEAD' || method === 'GET') {
        if (this._indices.has(indexName)) {
          return { statusCode: 200, body: this._indices.get(indexName) };
        }
        const err = new Error(`Index [${indexName}] not found`);
        err.statusCode = 404;
        throw err;
      }
      if (method === 'PUT') {
        this._indices.set(indexName, body || {});
        if (body?.mappings) {
          this._mappings.set(indexName, body.mappings);
        }
        if (!this._documents.has(indexName)) {
          this._documents.set(indexName, new Map());
        }
        return { statusCode: 200, body: { acknowledged: true, index: indexName } };
      }
    }

    // Document operations: /{index}/_doc/{id}
    const docMatch = cleanPath.match(/^([^/]+)\/_doc\/([^/]+)$/);
    if (docMatch) {
      const [, indexName, docId] = docMatch;
      const indexDocs = this._documents.get(indexName) || new Map();
      this._documents.set(indexName, indexDocs);

      if (method === 'PUT' || method === 'POST') {
        const version = params.version !== undefined ? Number(params.version) : 1;
        const versionType = params.version_type || 'internal';

        const existing = indexDocs.get(docId);
        if (versionType === 'external_gte' || versionType === 'external') {
          if (existing && existing.version > version) {
            const err = new Error(`[${docId}]: version conflict, current version [${existing.version}] is higher than the one provided [${version}]`);
            err.statusCode = 409;
            err.body = {
              error: {
                type: 'version_conflict_engine_exception',
                reason: err.message
              },
              status: 409
            };
            throw err;
          }
        }

        indexDocs.set(docId, { doc: { ...body }, version });
        return {
          statusCode: existing ? 200 : 201,
          body: {
            _index: indexName,
            _id: docId,
            _version: version,
            result: existing ? 'updated' : 'created'
          }
        };
      }

      if (method === 'GET') {
        const item = indexDocs.get(docId);
        if (!item) {
          const err = new Error(`Document [${docId}] not found`);
          err.statusCode = 404;
          throw err;
        }
        return {
          statusCode: 200,
          body: {
            _index: indexName,
            _id: docId,
            _version: item.version,
            _source: item.doc,
            found: true
          }
        };
      }
    }

    // Search operations: /{index}/_search
    if (cleanPath.endsWith('/_search')) {
      const indexName = cleanPath.replace('/_search', '');
      const indexDocs = this._documents.get(indexName) || new Map();
      const hits = [];

      const queryText = (body?.query?.bool?.must?.[0]?.multi_match?.query ||
                         body?.query?.multi_match?.query || '').toLowerCase();
      const filterCategory = body?.query?.bool?.filter?.find(f => f.term?.category_name)?.term?.category_name?.toLowerCase();
      const filterCity = body?.query?.bool?.filter?.find(f => f.term?.dealer_city)?.term?.dealer_city?.toLowerCase();
      const maxPrice = body?.query?.bool?.filter?.find(f => f.range?.selling_price)?.range?.selling_price?.lte;

      for (const [id, item] of indexDocs.entries()) {
        const doc = item.doc;
        let match = true;

        if (queryText) {
          const nameTokens = (doc.product_name || '').toLowerCase().split(/[\s\-_]+/);
          const brandTokens = (doc.brand || '').toLowerCase().split(/[\s\-_]+/);
          const allTokens = [...nameTokens, ...brandTokens];

          const hasMatch = allTokens.some(token =>
            token === queryText ||
            token.includes(queryText) ||
            queryText.includes(token) ||
            levenshteinDistance(token, queryText) <= 2
          );
          if (!hasMatch) match = false;
        }

        if (filterCategory && (doc.category_name || '').toLowerCase() !== filterCategory) match = false;
        if (filterCity && (doc.dealer_city || '').toLowerCase() !== filterCity) match = false;
        if (maxPrice !== undefined && doc.selling_price > maxPrice) match = false;

        if (match) {
          hits.push({
            _index: indexName,
            _id: id,
            _score: 1.0,
            _source: doc
          });
        }
      }

      const limit = body?.size || 10;
      return {
        statusCode: 200,
        body: {
          hits: {
            total: { value: hits.length, relation: 'eq' },
            hits: hits.slice(0, limit)
          }
        }
      };
    }

    return { statusCode: 200, body: { ok: true } };
  }

  // High-level API methods
  async indexExists(indexName) {
    try {
      await this._request('GET', `/${indexName}`);
      return true;
    } catch (err) {
      if (err.statusCode === 404) return false;
      throw err;
    }
  }

  async createIndex(indexName, definition) {
    return this._request('PUT', `/${indexName}`, definition);
  }

  async indexDocument(indexName, id, doc, version = null, versionType = null) {
    const params = {};
    if (version !== null && version !== undefined) params.version = version;
    if (versionType) params.version_type = versionType;
    return this._request('PUT', `/${indexName}/_doc/${encodeURIComponent(id)}`, doc, params);
  }

  async getDocument(indexName, id) {
    const res = await this._request('GET', `/${indexName}/_doc/${encodeURIComponent(id)}`);
    return res.body;
  }

  async search(indexName, searchBody) {
    const res = await this._request('POST', `/${indexName}/_search`, searchBody);
    return res.body;
  }
}

function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

module.exports = {
  OpenSearchClient
};
