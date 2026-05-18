process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const path = require('path');
const express = require('express');
const { scanMarket } = require('./marketScanner');

const PORT = process.env.PORT || 4000;
const app = express();

app.use(express.json());
app.use((req, _res, next) => {
  console.info(`[API] ${req.method} ${req.url}`);
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/arbitrage', async (req, res) => {
  const minProfit = Number.parseFloat(req.query.minProfit) || 0;
  const minMargin = Number.parseFloat(req.query.minMargin) || 0;

  try {
    const { opportunities, meta } = await scanMarket({ minProfit, minMargin });
    console.info(
      `[API] Scan success — filters profit>=${minProfit} margin>=${minMargin}, matches=${opportunities.length}`
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`EVE Arbitrage server listening on port ${PORT}`);
});
