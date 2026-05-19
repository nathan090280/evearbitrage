const { fetchMarketOrders, fetchMarketHistory, delay } = require('./esiClient');
const items = require('./itemList');
const regions = require('./regions');

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 500;
const DEFAULT_FILTERS = {
  minProfit: 50_000_000,
  minMargin: 5,
  minPrice: 100_000_000,
  minVolume24h: 1,
  buyRegionId: 10000002, // Jita
  sellRegionId: 10000043 // Amarr
};

const DEFAULT_FEES = {
  buyBrokerRate: 0.0165,
  sellBrokerRate: 0.0165,
  salesTaxRate: 0.042
};

const REGION_INDEX = regions
  .filter((region) => region.id)
  .reduce((acc, region) => acc.set(region.id, region), new Map());

async function getLowestSellQuote(regionId, typeId) {
  let orders;
  try {
    orders = await fetchMarketOrders({ regionId, typeId, orderType: 'sell' });
  } catch (error) {
    console.error(
      `[Scanner] Unable to load sell orders for type ${typeId} in region ${regionId}: ${error.message}`
    );
    return null;
  }
  if (!Array.isArray(orders) || orders.length === 0) return null;
  let best = null;
  for (const order of orders) {
    if (typeof order.price !== 'number') continue;
    if (!best || order.price < best.price) {
      best = {
        price: order.price,
        quantity: order.volume_remain ?? null
      };
    }
  }
  return best;
}

async function getVolumeStats(regionId, typeId) {
  let history;
  try {
    history = await fetchMarketHistory({ regionId, typeId });
  } catch (error) {
    console.error(
      `[Scanner] Unable to load history for type ${typeId} in region ${regionId}: ${error.message}`
    );
    return { volume24h: 0, volume30d: 0 };
  }
  if (!Array.isArray(history) || history.length === 0) {
    return { volume24h: 0, volume30d: 0 };
  }

  const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));
  const latest = sorted[0];
  const last30 = sorted.slice(0, 30);
  const volume24h = latest?.volume ?? 0;
  const volume30d = last30.reduce((sum, day) => sum + (day.volume ?? 0), 0);
  return { volume24h, volume30d };
}

function buildOpportunity({
  item,
  buyRegion,
  sellRegion,
  buyQuote,
  sellQuote,
  fees,
  volumeStats
}) {
  const spread = sellQuote.price - buyQuote.price;
  if (spread <= 0) {
    return null;
  }

  const brokerFees = buyQuote.price * fees.buyBrokerRate + sellQuote.price * fees.sellBrokerRate;
  const salesTax = sellQuote.price * fees.salesTaxRate;
  const totalFees = brokerFees + salesTax;
  const netProfit = spread - totalFees;
  const spreadPercent = (spread / buyQuote.price) * 100;

  return {
    itemName: item.name,
    buyRegion: buyRegion.name,
    sellRegion: sellRegion.name,
    buyPrice: buyQuote.price,
    sellPrice: sellQuote.price,
    marginPercent: spreadPercent,
    estimatedFees: totalFees,
    estimatedProfit: netProfit,
    availableQuantity: buyQuote.quantity,
    volume24h: volumeStats.volume24h,
    volume30d: volumeStats.volume30d
  };
}

async function evaluateItem(item, context) {
  const { buyRegion, sellRegion, fees, filters } = context;
  const buyQuote = await getLowestSellQuote(buyRegion.id, item.typeId);
  const sellQuote = await getLowestSellQuote(sellRegion.id, item.typeId);

  if (!buyQuote || !sellQuote) {
    return null;
  }

  if (buyQuote.price < filters.minPrice) {
    return null;
  }

  const volumeStats = await getVolumeStats(sellRegion.id, item.typeId);
  if (volumeStats.volume24h < filters.minVolume24h) {
    return null;
  }

  return buildOpportunity({
    item,
    buyRegion,
    sellRegion,
    buyQuote,
    sellQuote,
    fees,
    volumeStats
  });
}

async function scanMarket(options = {}) {
  const filters = {
    ...DEFAULT_FILTERS,
    ...Object.fromEntries(
      Object.entries(options).filter(([key]) =>
        [
          'minProfit',
          'minMargin',
          'minPrice',
          'minVolume24h',
          'buyRegionId',
          'sellRegionId'
        ].includes(key)
      )
    )
  };

  const fees = {
    ...DEFAULT_FEES,
    ...Object.fromEntries(
      Object.entries(options).filter(([key]) =>
        ['buyBrokerRate', 'sellBrokerRate', 'salesTaxRate'].includes(key)
      )
    )
  };

  const buyRegion = REGION_INDEX.get(Number(filters.buyRegionId)) || REGION_INDEX.get(10000002);
  const sellRegion = REGION_INDEX.get(Number(filters.sellRegionId)) || REGION_INDEX.get(10000043);

  const results = [];
  let missingData = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    for (const item of batch) {
      let opportunity;
      try {
        opportunity = await evaluateItem(item, { buyRegion, sellRegion, fees, filters });
      } catch (error) {
        console.error(`[Scanner] Evaluation failed for ${item.name}: ${error.message}`);
        missingData += 1;
        continue;
      }
      if (!opportunity) {
        missingData += 1;
        continue;
      }

      if (opportunity.estimatedProfit >= filters.minProfit && opportunity.marginPercent >= filters.minMargin) {
        results.push(opportunity);
      }
    }

    if (i + BATCH_SIZE < items.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  results.sort((a, b) => b.estimatedProfit - a.estimatedProfit);

  return {
    opportunities: results,
    meta: {
      generatedAt: new Date().toISOString(),
      filters,
      fees,
      totals: {
        totalItems: items.length,
        filteredCount: results.length,
        missingData,
        batchSize: BATCH_SIZE,
        batchDelayMs: BATCH_DELAY_MS
      }
    }
  };
}

module.exports = {
  scanMarket,
  constants: {
    regions,
    DEFAULT_FILTERS,
    DEFAULT_FEES,
    BATCH_SIZE,
    BATCH_DELAY_MS
  }
};
