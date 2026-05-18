const { fetchMarketOrders, delay } = require('./esiClient');
const items = require('./itemList');

const REGIONS = {
  JITA: { id: 10000002, name: 'The Forge (Jita)' },
  AMARR: { id: 10000043, name: 'Domain (Amarr)' }
};

const BROKER_FEE_RATE = 0.03;
const SALES_TAX_RATE = 0.015;
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 500;

async function getLowestSellPrice(regionId, typeId) {
  const orders = await fetchMarketOrders({ regionId, typeId, orderType: 'sell' });
  if (!Array.isArray(orders) || orders.length === 0) return null;
  let minPrice = Number.POSITIVE_INFINITY;
  for (const order of orders) {
    if (typeof order.price === 'number' && order.price < minPrice) {
      minPrice = order.price;
    }
  }
  return Number.isFinite(minPrice) ? minPrice : null;
}

function buildOpportunity({ item, buyRegion, sellRegion, buyPrice, sellPrice }) {
  const spread = sellPrice - buyPrice;
  if (spread <= 0) {
    return null;
  }

  const brokerFees = (buyPrice + sellPrice) * BROKER_FEE_RATE;
  const salesTax = sellPrice * SALES_TAX_RATE;
  const totalFees = brokerFees + salesTax;
  const netProfit = spread - totalFees;
  const spreadPercent = (spread / buyPrice) * 100;

  return {
    typeId: item.typeId,
    itemName: item.name,
    category: item.category,
    buyRegion,
    sellRegion,
    buyPrice,
    sellPrice,
    spread,
    spreadPercent,
    brokerFees,
    salesTax,
    estimatedFees: totalFees,
    netProfit,
    volumePerDay: null
  };
}

async function evaluateItem(item) {
  const jitaPrice = await getLowestSellPrice(REGIONS.JITA.id, item.typeId);
  const amarrPrice = await getLowestSellPrice(REGIONS.AMARR.id, item.typeId);

  if (jitaPrice === null || amarrPrice === null) {
    return null;
  }

  const opportunities = [];

  const jitaToAmarr = buildOpportunity({
    item,
    buyRegion: REGIONS.JITA,
    sellRegion: REGIONS.AMARR,
    buyPrice: jitaPrice,
    sellPrice: amarrPrice
  });

  if (jitaToAmarr) opportunities.push(jitaToAmarr);

  const amarrToJita = buildOpportunity({
    item,
    buyRegion: REGIONS.AMARR,
    sellRegion: REGIONS.JITA,
    buyPrice: amarrPrice,
    sellPrice: jitaPrice
  });

  if (amarrToJita) opportunities.push(amarrToJita);

  if (!opportunities.length) {
    return null;
  }

  opportunities.sort((a, b) => b.netProfit - a.netProfit);
  return {
    item,
    jitaPrice,
    amarrPrice,
    bestOpportunity: opportunities[0]
  };
}

async function scanMarket({ minProfit = 0, minMargin = 0 }) {
  const results = [];
  let missingData = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    for (const item of batch) {
      const evaluation = await evaluateItem(item);
      if (!evaluation) {
        missingData += 1;
        continue;
      }

      const { bestOpportunity } = evaluation;
      if (
        bestOpportunity.netProfit >= minProfit &&
        bestOpportunity.spreadPercent >= minMargin
      ) {
        results.push(bestOpportunity);
      }
    }

    if (i + BATCH_SIZE < items.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  results.sort((a, b) => b.netProfit - a.netProfit);

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      minProfit,
      minMargin
    },
    summary: {
      totalItems: items.length,
      filteredCount: results.length,
      missingData,
      brokerFeeRate: BROKER_FEE_RATE,
      salesTaxRate: SALES_TAX_RATE,
      batchSize: BATCH_SIZE,
      batchDelayMs: BATCH_DELAY_MS
    },
    opportunities: results
  };
}

module.exports = {
  scanMarket,
  constants: {
    REGIONS,
    BROKER_FEE_RATE,
    SALES_TAX_RATE,
    BATCH_SIZE,
    BATCH_DELAY_MS
  }
};
