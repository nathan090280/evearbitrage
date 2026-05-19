const statusEl = document.getElementById('status');
const form = document.getElementById('scanForm');
const table = document.getElementById('resultsTable');
const tbody = table.querySelector('tbody');
const template = document.getElementById('rowTemplate');
const scanButton = document.getElementById('scanButton');
const buyRegionSelect = document.getElementById('buyRegion');
const sellRegionSelect = document.getElementById('sellRegion');
const minProfitInput = document.getElementById('minProfit');
const minMarginInput = document.getElementById('minMargin');
const minPriceInput = document.getElementById('minPrice');
const minVolume24hInput = document.getElementById('minVolume24h');
const minVolume30dInput = document.getElementById('minVolume30d');
const buyBrokerInput = document.getElementById('buyBrokerRate');
const sellBrokerInput = document.getElementById('sellBrokerRate');
const salesTaxInput = document.getElementById('salesTaxRate');
const highsecCheckbox = document.getElementById('highsecOnly');

let lastData = [];
let lastGeneratedAt = null;
let regionOptions = [];
let currentSort = {
  key: 'estimatedProfit',
  direction: 'desc'
};

function formatISK(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'ISK',
    maximumFractionDigits: value >= 1_000_000_000 ? 0 : 2
  })
    .format(value)
    .replace('ISK', '');
}

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(2)}%`;
}

function updateStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.dataset.type = type;
}

function setLoading(loading) {
  scanButton.disabled = loading;
  scanButton.textContent = loading ? 'Scanning…' : 'Scan Now';
}

function renderRows(data) {
  tbody.innerHTML = '';
  data.forEach((row) => {
    const clone = template.content.cloneNode(true);
    clone.querySelector('.item-name').textContent = row.itemName;
    clone.querySelector('.buy-region').textContent = row.buyRegion;
    clone.querySelector('.buy-price').textContent = formatISK(row.buyPrice);
    clone.querySelector('.sell-region').textContent = row.sellRegion;
    clone.querySelector('.sell-price').textContent = formatISK(row.sellPrice);
    clone.querySelector('.quantity').textContent = row.availableQuantity
      ? row.availableQuantity.toLocaleString()
      : '—';
    clone.querySelector('.spread-percent').textContent = formatPercent(row.marginPercent);
    clone.querySelector('.fees').textContent = formatISK(row.estimatedFees);
    clone.querySelector('.net-profit').textContent = formatISK(row.estimatedProfit);
    clone.querySelector('.volume24').textContent = row.volume24h
      ? row.volume24h.toLocaleString()
      : '—';
    clone.querySelector('.volume30').textContent = row.volume30d
      ? row.volume30d.toLocaleString()
      : '—';
    tbody.appendChild(clone);
  });
}

function sortData(data, key, direction) {
  const mapped = [...data];
  mapped.sort((a, b) => {
    const valA = a[key] ?? 0;
    const valB = b[key] ?? 0;
    if (typeof valA === 'string') {
      return direction === 'asc'
        ? valA.localeCompare(valB)
        : valB.localeCompare(valA);
    }
    return direction === 'asc' ? valA - valB : valB - valA;
  });
  return mapped;
}

function appendQueryNumber(url, key, input) {
  if (input === undefined || input === null) return;

  let numberValue;
  if (typeof input === 'number') {
    numberValue = input;
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed === '') return;
    numberValue = Number.parseFloat(trimmed);
  } else if (typeof input.value === 'string') {
    const trimmed = input.value.trim();
    if (trimmed === '') return;
    numberValue = Number.parseFloat(trimmed);
  } else {
    return;
  }

  if (!Number.isFinite(numberValue)) return;
  url.searchParams.set(key, String(numberValue));
}

async function fetchArbitrage(params) {
  const url = new URL('/api/arbitrage', window.location.origin);
  appendQueryNumber(url, 'minProfit', params.minProfit);
  appendQueryNumber(url, 'minMargin', params.minMargin);
  appendQueryNumber(url, 'minPrice', params.minPrice);
  appendQueryNumber(url, 'minVolume24h', params.minVolume24h);
  appendQueryNumber(url, 'minVolume30d', params.minVolume30d);
  appendQueryNumber(url, 'buyBrokerRate', params.buyBrokerRate);
  appendQueryNumber(url, 'sellBrokerRate', params.sellBrokerRate);
  appendQueryNumber(url, 'salesTaxRate', params.salesTaxRate);
  if (typeof params.highsecOnly === 'boolean') {
    url.searchParams.set('highsecOnly', params.highsecOnly ? 'true' : 'false');
  }
  if (params.buyRegionId) url.searchParams.set('buyRegionId', params.buyRegionId);
  if (params.sellRegionId) url.searchParams.set('sellRegionId', params.sellRegionId);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch data');
  }
  const generatedAt = response.headers.get('x-arbitrage-generated-at');
  const payload = await response.json();
  return { opportunities: payload, generatedAt };
}

async function handleScan(event) {
  event.preventDefault();
  const params = {
    minProfit: minProfitInput.value.trim(),
    minMargin: minMarginInput.value.trim(),
    minPrice: minPriceInput.value.trim(),
    minVolume24h: minVolume24hInput.value.trim(),
    minVolume30d: minVolume30dInput.value.trim(),
    buyRegionId: buyRegionSelect.value,
    sellRegionId: sellRegionSelect.value,
    buyBrokerRate: percentageToDecimal(buyBrokerInput.value.trim()),
    sellBrokerRate: percentageToDecimal(sellBrokerInput.value.trim()),
    salesTaxRate: percentageToDecimal(salesTaxInput.value.trim()),
    highsecOnly: highsecCheckbox.checked
  };

  setLoading(true);
  updateStatus('Scanning ESI… this can take up to 20 seconds depending on cache.', 'info');

  try {
    const payload = await fetchArbitrage(params);
    lastGeneratedAt = payload.generatedAt;
    lastData = payload.opportunities ?? [];
    if (!lastData.length) {
      updateStatus('No opportunities matched the filters. Try lowering thresholds.', 'warn');
    } else {
      const timestamp = lastGeneratedAt
        ? new Date(lastGeneratedAt).toLocaleTimeString()
        : 'recently';
      updateStatus(
        `Scan completed at ${timestamp} — showing ${lastData.length} opportunities`,
        'success'
      );
    }
    const sorted = sortData(lastData, currentSort.key, currentSort.direction);
    renderRows(sorted);
  } catch (error) {
    console.error(error);
    updateStatus(`Scan failed: ${error.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

function setupSorting() {
  const headers = table.querySelectorAll('th[data-sort]');
  headers.forEach((header) => {
    header.addEventListener('click', () => {
      const key = header.dataset.sort;
      if (currentSort.key === key) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort.key = key;
        currentSort.direction = 'desc';
      }
      const sorted = sortData(lastData, currentSort.key, currentSort.direction);
      renderRows(sorted);
    });
  });
}

function percentageToDecimal(value) {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed / 100;
}

function decimalToPercentage(value) {
  if (typeof value !== 'number') return '';
  return (value * 100).toFixed(2).replace(/\.00$/, '');
}

function populateRegionSelect(select, regionsList, defaultId) {
  select.innerHTML = '';
  regionsList.forEach((region) => {
    const option = document.createElement('option');
    option.value = region.id;
    option.textContent = region.name;
    if (region.id === defaultId) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

async function loadRegions() {
  try {
    const response = await fetch('/api/regions');
    if (!response.ok) throw new Error('Failed to load region list');
    const data = await response.json();
    regionOptions = data.regions ?? [];
    const defaults = data.defaults ?? {};
    populateRegionSelect(buyRegionSelect, regionOptions, defaults.filters?.buyRegionId);
    populateRegionSelect(sellRegionSelect, regionOptions, defaults.filters?.sellRegionId);
    if (defaults.filters && typeof defaults.filters.minProfit === 'number') {
      minProfitInput.value = defaults.filters.minProfit;
    }
    if (defaults.filters && typeof defaults.filters.minMargin === 'number') {
      minMarginInput.value = defaults.filters.minMargin;
    }
    if (defaults.filters && typeof defaults.filters.minPrice === 'number') {
      minPriceInput.value = defaults.filters.minPrice;
    }
    if (defaults.filters && typeof defaults.filters.minVolume24h === 'number') {
      minVolume24hInput.value = defaults.filters.minVolume24h;
    }
    if (defaults.filters && typeof defaults.filters.minVolume30d === 'number') {
      minVolume30dInput.value = defaults.filters.minVolume30d;
    }
    if (defaults.filters && typeof defaults.filters.highsecOnly === 'boolean') {
      highsecCheckbox.checked = defaults.filters.highsecOnly;
    }
    if (defaults.fees) {
      buyBrokerInput.value = decimalToPercentage(defaults.fees.buyBrokerRate || 0);
      sellBrokerInput.value = decimalToPercentage(defaults.fees.sellBrokerRate || 0);
      salesTaxInput.value = decimalToPercentage(defaults.fees.salesTaxRate || 0);
    }
  } catch (error) {
    console.error(error);
    regionOptions = [
      { id: 10000002, name: 'The Forge (Jita)' },
      { id: 10000043, name: 'Domain (Amarr)' }
    ];
    populateRegionSelect(buyRegionSelect, regionOptions, 10000002);
    populateRegionSelect(sellRegionSelect, regionOptions, 10000043);
  }
}

form.addEventListener('submit', handleScan);
setupSorting();
loadRegions().then(() => {
  minPriceInput.value = minPriceInput.value || '300000000';
  minVolume24hInput.value = minVolume24hInput.value || '1';
  minVolume30dInput.value = minVolume30dInput.value || '10';
  updateStatus('Ready to scan. Choose thresholds and launch.', 'info');
});
