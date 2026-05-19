const statusEl = document.getElementById('status');
const form = document.getElementById('scanForm');
const table = document.getElementById('resultsTable');
const tbody = table.querySelector('tbody');
const template = document.getElementById('rowTemplate');
const scanButton = document.getElementById('scanButton');

let lastData = [];
let lastGeneratedAt = null;
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
    clone.querySelector('.spread-percent').textContent = formatPercent(row.marginPercent);
    clone.querySelector('.fees').textContent = formatISK(row.estimatedFees);
    clone.querySelector('.net-profit').textContent = formatISK(row.estimatedProfit);
    clone.querySelector('.volume').textContent = row.volumeScore
      ? `${(row.volumeScore * 100).toFixed(0)}%`
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

async function fetchArbitrage(minProfit, minMargin) {
  const url = new URL('/api/arbitrage', window.location.origin);
  if (minProfit) url.searchParams.set('minProfit', minProfit);
  if (minMargin) url.searchParams.set('minMargin', minMargin);

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
  const minProfit = form.minProfit.value.trim();
  const minMargin = form.minMargin.value.trim();

  setLoading(true);
  updateStatus('Scanning ESI… this can take up to 20 seconds depending on cache.', 'info');

  try {
    const payload = await fetchArbitrage(minProfit, minMargin);
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

form.addEventListener('submit', handleScan);
setupSorting();
updateStatus('Ready to scan. Choose thresholds and launch.', 'info');
