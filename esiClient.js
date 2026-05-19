const https = require('https');
const axios = require('axios');

const BASE_URL = 'https://esi.evetech.net/latest';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MIN_DELAY_MS = 300; // 0.3 seconds between outbound calls
const MAX_RETRIES = 2;

const cache = new Map();
let lastRequestTime = 0;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cacheKey = (...parts) => parts.join(':');

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) {
    console.info(`[Cache] miss ${key}`);
    return null;
  }
  const isFresh = Date.now() - hit.timestamp < CACHE_TTL_MS;
  if (!isFresh) {
    console.info(`[Cache] stale ${key}`);
    cache.delete(key);
    return null;
  }
  console.info(`[Cache] hit ${key}`);
  return hit.value;
}

function setCached(key, value) {
  cache.set(key, { value, timestamp: Date.now() });
}

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

async function rateLimitedGet(url, attempt = 0) {
  const wait = Math.max(0, lastRequestTime + MIN_DELAY_MS - Date.now());
  if (wait > 0) {
    await delay(wait);
  }

  try {
    console.info(`[ESI] GET ${url}`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'EveArbitrageTool/1.0 (github.com/user)',
        'Accept-Language': 'en'
      },
      httpsAgent: insecureAgent,
      timeout: 15000
    });
    lastRequestTime = Date.now();
    return response.data;
  } catch (error) {
    const status = error.response?.status;
    console.error(`[ESI] Request failed (${status || 'no-status'}) for ${url}`);
    if (attempt < MAX_RETRIES) {
      await delay(500 * (attempt + 1));
      return rateLimitedGet(url, attempt + 1);
    }
    throw error;
  }
}

async function fetchMarketOrders({ regionId, typeId, orderType = 'sell' }) {
  const key = cacheKey('orders', regionId, typeId, orderType);
  const cached = getCached(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    order_type: orderType,
    type_id: String(typeId),
    datasource: 'tranquility',
    page: '1'
  });
  const url = `${BASE_URL}/markets/${regionId}/orders/?${params.toString()}`;
  const payload = await rateLimitedGet(url);
  setCached(key, payload);
  return payload;
}

async function fetchTypeInfo(typeId) {
  const key = cacheKey('type', typeId);
  const cached = getCached(key);
  if (cached) return cached;

  const url = `${BASE_URL}/universe/types/${typeId}/?datasource=tranquility`;
  const payload = await rateLimitedGet(url);
  setCached(key, payload);
  return payload;
}

async function fetchMarketHistory({ regionId, typeId }) {
  const key = cacheKey('history', regionId, typeId);
  const cached = getCached(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    type_id: String(typeId),
    datasource: 'tranquility'
  });
  const url = `${BASE_URL}/markets/${regionId}/history/?${params.toString()}`;
  const payload = await rateLimitedGet(url);
  setCached(key, payload);
  return payload;
}

async function fetchRegion(regionId) {
  const key = cacheKey('region', regionId);
  const cached = getCached(key);
  if (cached) return cached;

  const url = `${BASE_URL}/universe/regions/${regionId}/?datasource=tranquility`;
  const payload = await rateLimitedGet(url);
  setCached(key, payload);
  return payload;
}

module.exports = {
  fetchMarketOrders,
  fetchTypeInfo,
  fetchMarketHistory,
  fetchRegion,
  delay
};
