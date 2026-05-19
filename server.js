process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const path = require('path');
const express = require('express');
const { scanMarket, constants } = require('./marketScanner');

const { regions, DEFAULT_FILTERS, DEFAULT_FEES } = constants;

const numberFromQuery = (value) => {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const intFromQuery = (value) => {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const PORT = process.env.PORT || 4000;
const app = express();

app.use(express.json());
app.use((req, _res, next) => {
  console.info(`[API] ${req.method} ${req.url}`);
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/arbitrage', async (req, res) => {
  const numericKeys = [
    'minProfit',
    'minMargin',
    'minPrice',
    'minVolume24h',
    'buyBrokerRate',
    'sellBrokerRate',
    'salesTaxRate'
  ];

  const options = {};
  numericKeys.forEach((key) => {
    const value = numberFromQuery(req.query[key]);
    if (value !== undefined) {
      options[key] = value;
    }
  });

  const buyRegionId = intFromQuery(req.query.buyRegionId);
  if (buyRegionId) options.buyRegionId = buyRegionId;
  const sellRegionId = intFromQuery(req.query.sellRegionId);
  if (sellRegionId) options.sellRegionId = sellRegionId;

  try {
    const { opportunities, meta } = await scanMarket(options);
    console.info(
      `[API] Scan success — buyRegion=${meta.filters.buyRegionId} sellRegion=${meta.filters.sellRegionId} matches=${opportunities.length}`
    );
    res.setHeader('X-Arbitrage-Generated-At', meta.generatedAt);
    res.json(opportunities);
  } catch (error) {
    console.error('[API] /api/arbitrage failed', error.message);
    res.status(500).json({
      error: 'Unable to complete arbitrage scan at this time.',
      details: error.message
    });
  }
});

app.get('/api/regions', (_req, res) => {
  res.json({
    regions,
    defaults: {
      filters: {
        ...DEFAULT_FILTERS,
        maxPrice: null
      },
      fees: DEFAULT_FEES
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`EVE Arbitrage server listening on port ${PORT}`);
});
