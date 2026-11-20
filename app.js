const STORAGE_KEY = 'fuel_calc_win_db_v2';

let appData = {
  settings: {
    theme: 'theme-vista',
    defaultMode: 'ODO',
    defaultCurrency: 'PLN',
    activeVehicleId: 'v1',
    firstLaunchPrompted: false
  },
  vehicles: [
    { id: 'v1', name: 'Mój Samochód', serviceOdo: 0, tuvDate: '', taxDate: '' }
  ],
  entries: []
};

let currentInputMode = 'ODO';
let currentCurrency = 'PLN';
let currentStatsPeriod = 'ALL';
let renamingVehicleId = null;

// ================= INICJALIZACJA =================
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  applyTheme(appData.settings.theme);
  setupNavigation();
  setupFormLogic();
  setupSettingsLogic();
  setupStatsFilter();
  setupRenameModal();
  renderAll();
  registerServiceWorker();

  // Przy pierwszym starcie (gdy domyślna nazwa i brak wpisów) pozwól od razu nazwać auto
  const firstVeh = appData.vehicles[0];
  if (!appData.settings.firstLaunchPrompted && firstVeh && firstVeh.name === 'Mój Samochód' && appData.entries.length === 0) {
    appData.settings.firstLaunchPrompted = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    openRenameModal(firstVeh.id);
  }
});

function loadData() {
  // Migracja z v1 jeśli istnieje
  const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('fuel_calc_win_db_v1');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      appData = {
        ...appData,
        ...parsed,
        settings: { ...appData.settings, ...(parsed.settings || {}) }
      };
      if (!appData.vehicles || appData.vehicles.length === 0) {
        appData.vehicles = [{ id: 'v1', name: 'Mój Samochód', serviceOdo: 0, tuvDate: '', taxDate: '' }];
      } else {
        appData.vehicles = appData.vehicles.map(v => ({
          serviceOdo: 0,
          tuvDate: '',
          taxDate: '',
          ...v
        }));
      }
    } catch (e) {
      console.error('Błąd odczytu bazy:', e);
    }
  }
}

function saveData(msg = 'Zapisano zmiany') {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  setStatus(msg);
  renderAll();
}

function setStatus(text) {
  document.getElementById('status-text').textContent = text;
}

function applyTheme(themeName) {
  document.body.className = themeName;
  document.getElementById('sel-theme').value = themeName;
}

// ================= OKNO ZMIANY NAZWY POJAZDU =================
function setupRenameModal() {
  document.getElementById('btn-rename-active-vehicle').addEventListener('click', () => {
    openRenameModal(appData.settings.activeVehicleId);
  });

  document.getElementById('btn-inline-rename').addEventListener('click', () => {
    openRenameModal(appData.settings.activeVehicleId);
  });

  document.getElementById('btn-modal-save').addEventListener('click', () => {
    const newName = document.getElementById('modal-vehicle-input').value.trim();
    if (newName && renamingVehicleId) {
      const veh = appData.vehicles.find(v => v.id === renamingVehicleId);
      if (veh) {
        veh.name = newName;
        saveData('Zmieniono nazwę pojazdu na: ' + newName);
      }
    }
    closeRenameModal();
  });

  document.getElementById('btn-modal-cancel').addEventListener('click', closeRenameModal);

  document.getElementById('modal-vehicle-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btn-modal-save').click();
    }
  });
}

window.openRenameModal = function(vehicleId) {
  const veh = appData.vehicles.find(v => v.id === vehicleId);
  if (!veh) return;
  renamingVehicleId = vehicleId;
  const inp = document.getElementById('modal-vehicle-input');
  inp.value = veh.name === 'Mój Samochód' ? '' : veh.name;
  document.getElementById('rename-modal').style.display = 'flex';
  setTimeout(() => inp.focus(), 50);
};

function closeRenameModal() {
  document.getElementById('rename-modal').style.display = 'none';
  renamingVehicleId = null;
}

// ================= NAWIGACJA ZAKŁADEK =================
function setupNavigation() {
  const buttons = document.querySelectorAll('.tool-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      switchTab(target);
      if (target === 'tab-add') {
        resetFormForNew();
      }
    });
  });

  document.getElementById('btn-quick-add').addEventListener('click', () => {
    switchTab('tab-add');
    resetFormForNew();
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tool-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === tabId);
  });
}

// ================= LOGIKA OBLICZEŃ SPALANIA =================
function getVehicleEntries(vehicleId) {
  return appData.entries
    .filter(e => e.vehicleId === vehicleId)
    .sort((a, b) => new Date(a.date) - new Date(b.date) || a.odo - b.odo);
}

function calculateComputedEntries(vehicleId) {
  const list = getVehicleEntries(vehicleId);
  let accLiters = 0;
  let accDist = 0;
  let prevOdo = null;

  return list.map((entry, idx) => {
    let tripDist = entry.trip || 0;
    if (idx === 0) {
      prevOdo = entry.odo;
      return { ...entry, calcDist: tripDist, consumption: null };
    }

    if (prevOdo !== null && entry.odo > prevOdo) {
      tripDist = +(entry.odo - prevOdo).toFixed(1);
    }
    prevOdo = entry.odo;

    accLiters += entry.liters;
    accDist += tripDist;

    let consumption = null;
    if (entry.isFull && accDist > 0) {
      consumption = +((accLiters / accDist) * 100).toFixed(2);
      accLiters = 0;
      accDist = 0;
    }

    return {
      ...entry,
      calcDist: tripDist,
      consumption
    };
  });
}

// ================= FORMULARZ TANKOWANIA =================
function setupFormLogic() {
  const modeOdoBtn = document.getElementById('mode-odo');
  const modeTripBtn = document.getElementById('mode-trip');
  const currPlnBtn = document.getElementById('curr-pln');
  const currEurBtn = document.getElementById('curr-eur');

  modeOdoBtn.addEventListener('click', () => setInputMode('ODO'));
  modeTripBtn.addEventListener('click', () => setInputMode('TRIP'));

  currPlnBtn.addEventListener('click', () => setCurrency('PLN'));
  currEurBtn.addEventListener('click', () => setCurrency('EUR'));

  const inpLiters = document.getElementById('inp-liters');
  const inpPrice = document.getElementById('inp-price');
  const inpTotal = document.getElementById('inp-total');

  inpPrice.addEventListener('input', () => {
    const l = parseFloat(inpLiters.value);
    const p = parseFloat(inpPrice.value);
    if (l > 0 && p > 0) inpTotal.value = (l * p).toFixed(2);
  });

  inpTotal.addEventListener('input', () => {
    const l = parseFloat(inpLiters.value);
    const t = parseFloat(inpTotal.value);
    if (l > 0 && t > 0) inpPrice.value = (t / l).toFixed(3);
  });

  inpLiters.addEventListener('input', () => {
    const l = parseFloat(inpLiters.value);
    const p = parseFloat(inpPrice.value);
    const t = parseFloat(inpTotal.value);
    if (l > 0 && p > 0) inpTotal.value = (l * p).toFixed(2);
    else if (l > 0 && t > 0) inpPrice.value = (t / l).toFixed(3);
  });

  document.getElementById('inp-distance').addEventListener('input', updateDistanceHint);
  document.getElementById('fuel-form').addEventListener('submit', handleFormSubmit);

  document.getElementById('btn-cancel-form').addEventListener('click', () => {
    switchTab('tab-home');
  });

  document.getElementById('btn-delete-entry').addEventListener('click', () => {
    const id = document.getElementById('edit-entry-id').value;
    if (id && confirm('Czy na pewno usunąć ten wpis tankowania?')) {
      appData.entries = appData.entries.filter(e => e.id !== id);
      saveData('Usunięto wpis');
      switchTab('tab-home');
    }
  });
}

function setInputMode(mode) {
  currentInputMode = mode;
  document.getElementById('mode-odo').classList.toggle('active', mode === 'ODO');
  document.getElementById('mode-trip').classList.toggle('active', mode === 'TRIP');
  document.getElementById('lbl-distance').textContent =
    mode === 'ODO' ? 'Stan licznika całkowitego ODO (km):' : 'Przebieg dzienny Trip (km):';
  document.getElementById('inp-distance').placeholder =
    mode === 'ODO' ? 'np. 145320' : 'np. 640.5';
  updateDistanceHint();
}

function setCurrency(curr) {
  currentCurrency = curr;
  document.getElementById('curr-pln').classList.toggle('active', curr === 'PLN');
  document.getElementById('curr-eur').classList.toggle('active', curr === 'EUR');
}

function getLastOdo(vehicleId, excludeId = null) {
  const list = getVehicleEntries(vehicleId).filter(e => e.id !== excludeId);
  return list.length > 0 ? list[list.length - 1].odo : 0;
}

function updateDistanceHint() {
  const editId = document.getElementById('edit-entry-id').value || null;
  const lastOdo = getLastOdo(appData.settings.activeVehicleId, editId);
  const val = parseFloat(document.getElementById('inp-distance').value);
  const hint = document.getElementById('distance-hint');

  if (currentInputMode === 'ODO') {
    if (!isNaN(val) && lastOdo > 0) {
      const diff = (val - lastOdo).toFixed(1);
      hint.textContent = `Poprzedni ODO: ${lastOdo} km (Dystans: ${diff >= 0 ? '+' + diff : diff} km)`;
    } else {
      hint.textContent = lastOdo > 0 ? `Poprzedni stan licznika: ${lastOdo} km` : 'Pierwszy wpis dla tego pojazdu';
    }
  } else {
    const newOdo = !isNaN(val) ? (lastOdo + val).toFixed(1) : lastOdo;
    hint.textContent = `Nowy stan ODO wyniesie: ${newOdo} km (poprzedni: ${lastOdo} km)`;
  }
}

function resetFormForNew() {
  document.getElementById('fuel-form').reset();
  document.getElementById('edit-entry-id').value = '';
  document.getElementById('form-legend').textContent = 'Nowe tankowanie';
  document.getElementById('btn-delete-entry').style.display = 'none';
  document.getElementById('inp-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('inp-full').checked = true;
  setInputMode(appData.settings.defaultMode);
  setCurrency(appData.settings.defaultCurrency);
  updateDistanceHint();
}

function openEditForm(entryId) {
  const entry = appData.entries.find(e => e.id === entryId);
  if (!entry) return;

  switchTab('tab-add');
  document.getElementById('edit-entry-id').value = entry.id;
  document.getElementById('form-legend').textContent = 'Edycja wpisu z dnia ' + entry.date;
  document.getElementById('btn-delete-entry').style.display = 'inline-block';

  setInputMode('ODO');
  document.getElementById('inp-distance').value = entry.odo;
  document.getElementById('inp-liters').value = entry.liters;
  setCurrency(entry.currency);
  document.getElementById('inp-price').value = entry.pricePerLiter || '';
  document.getElementById('inp-total').value = entry.totalCost || '';
  document.getElementById('inp-full').checked = entry.isFull;
  document.getElementById('inp-date').value = entry.date;
  document.getElementById('inp-route').value = entry.route || 'Mieszany';
  document.getElementById('inp-note').value = entry.note || '';
  updateDistanceHint();
}

function handleFormSubmit(e) {
  e.preventDefault();
  const vId = appData.settings.activeVehicleId;
  const editId = document.getElementById('edit-entry-id').value;
  const rawDist = parseFloat(document.getElementById('inp-distance').value);
  const liters = parseFloat(document.getElementById('inp-liters').value);
  let price = parseFloat(document.getElementById('inp-price').value) || 0;
  let total = parseFloat(document.getElementById('inp-total').value) || 0;

  if (price > 0 && total === 0) total = +(liters * price).toFixed(2);
  if (total > 0 && price === 0) price = +(total / liters).toFixed(3);

  const lastOdo = getLastOdo(vId, editId || null);
  let finalOdo = rawDist;
  let tripVal = 0;

  if (currentInputMode === 'TRIP') {
    tripVal = rawDist;
    finalOdo = +(lastOdo + rawDist).toFixed(1);
  } else {
    if (lastOdo > 0 && rawDist < lastOdo) {
      alert(`Błąd: Nowy stan licznika (${rawDist} km) jest mniejszy niż poprzedni (${lastOdo} km)!`);
      return;
    }
    tripVal = lastOdo > 0 ? +(rawDist - lastOdo).toFixed(1) : 0;
  }

  const entryObj = {
    id: editId || 'e_' + Date.now(),
    vehicleId: vId,
    date: document.getElementById('inp-date').value,
    odo: finalOdo,
    trip: tripVal,
    liters: liters,
    currency: currentCurrency,
    pricePerLiter: price,
    totalCost: total,
    isFull: document.getElementById('inp-full').checked,
    route: document.getElementById('inp-route').value,
    note: document.getElementById('inp-note').value.trim()
  };

  if (editId) {
    const idx = appData.entries.findIndex(x => x.id === editId);
    if (idx !== -1) appData.entries[idx] = entryObj;
  } else {
    appData.entries.push(entryObj);
  }

  saveData(editId ? 'Zaktualizowano wpis' : 'Dodano tankowanie');
  switchTab('tab-home');
}

// ================= RENDEROWANIE PULPITU I LISTY =================
function renderAll() {
  renderVehicleSelectors();
  renderHome();
  renderStats();
}

function renderVehicleSelectors() {
  const select = document.getElementById('active-vehicle-select');
  select.innerHTML = '';

  appData.vehicles.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    if (v.id === appData.settings.activeVehicleId) opt.selected = true;
    select.appendChild(opt);
  });

  const activeVeh = appData.vehicles.find(v => v.id === appData.settings.activeVehicleId) || appData.vehicles[0];
  document.getElementById('home-vehicle-name').textContent = activeVeh.name;
  document.getElementById('srv-veh-name').textContent = activeVeh.name;
  document.getElementById('inp-service-odo').value = activeVeh.serviceOdo || '';
  document.getElementById('inp-tuv-date').value = activeVeh.tuvDate || '';
  document.getElementById('inp-tax-date').value = activeVeh.taxDate || '';

  // Lista pojazdów w ustawieniach (z opcją edycji nazwy każdego auta!)
  const vList = document.getElementById('vehicles-list');
  vList.innerHTML = '';
  appData.vehicles.forEach(v => {
    const row = document.createElement('div');
    row.className = 'veh-item';
    row.innerHTML = `
      <span>🚗 <strong>${v.name}</strong></span>
      <div class="veh-actions">
        <button type="button" class="win-btn-sm" onclick="openRenameModal('${v.id}')">✏️ Zmień nazwę</button>
        ${appData.vehicles.length > 1 ? `<button type="button" class="win-btn-sm" onclick="deleteVehicle('${v.id}')">Usuń</button>` : ''}
      </div>
    `;
    vList.appendChild(row);
  });
}

function formatDateBadge(dateStr, label, boxId, textId) {
  const box = document.getElementById(boxId);
  const txt = document.getElementById(textId);
  if (!dateStr) {
    box.style.display = 'none';
    return false;
  }

  const target = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));

  const parts = dateStr.split('-');
  const plDate = `${parts[2]}.${parts[1]}.${parts[0]}`;

  box.style.display = 'block';
  box.classList.remove('alert-info', 'alert-warn', 'overdue');

  if (diffDays < 0) {
    box.classList.add('overdue');
    txt.textContent = `${label}: ${plDate} (${Math.abs(diffDays)} dni po!)`;
  } else if (diffDays <= 30) {
    box.classList.add('alert-warn');
    txt.textContent = `${label}: ${plDate} (za ${diffDays} dni)`;
  } else {
    box.classList.add('alert-info');
    txt.textContent = `${label}: ${plDate} (za ${diffDays} dni)`;
  }
  return true;
}

function renderHome() {
  const vId = appData.settings.activeVehicleId;
  const computed = calculateComputedEntries(vId);
  const fullEntries = computed.filter(e => e.consumption !== null);

  const lastEl = document.getElementById('kpi-last-consumption');
  const avgEl = document.getElementById('kpi-avg-consumption');
  const trendEl = document.getElementById('kpi-trend');

  let avgCons = 0;
  if (fullEntries.length > 0) {
    const totalDistForFull = fullEntries.reduce((s, e) => s + e.calcDist, 0);
    avgCons = totalDistForFull > 0 ? +(fullEntries.reduce((s, e) => s + e.consumption, 0) / fullEntries.length).toFixed(2) : 0;

    const lastCons = fullEntries[fullEntries.length - 1].consumption;
    lastEl.innerHTML = `${lastCons.toFixed(2)} <small>l/100</small>`;
    avgEl.innerHTML = `${avgCons.toFixed(2)} <small>l/100</small>`;

    const diff = +(lastCons - avgCons).toFixed(2);
    if (diff < 0) {
      trendEl.innerHTML = `<span class="txt-green">▼ ${Math.abs(diff)} mniej niż średnia</span>`;
    } else if (diff > 0) {
      trendEl.innerHTML = `<span class="txt-red">▲ +${diff} więcej niż średnia</span>`;
    } else {
      trendEl.textContent = 'Równo ze średnią';
    }
  } else {
    lastEl.innerHTML = `--,-- <small>l/100</small>`;
    avgEl.innerHTML = `--,-- <small>l/100</small>`;
    trendEl.textContent = 'Wymaga min. 2 pełnych tankowań';
  }

  const lastOdo = computed.length > 0 ? computed[computed.length - 1].odo : 0;
  const totalDist = computed.reduce((s, e) => s + (e.calcDist || 0), 0);
  document.getElementById('kpi-total-dist').textContent = `${totalDist.toFixed(0)} km (ODO: ${lastOdo})`;
  document.getElementById('status-odo').textContent = `ODO: ${lastOdo} km`;

  updateCost100Preview('PLN', 'kpi-cost-pln', 'zł', avgCons, computed);
  updateCost100Preview('EUR', 'kpi-cost-eur', '€', avgCons, computed);

  // Przypomnienie o wymianie oleju
  const activeVeh = appData.vehicles.find(v => v.id === vId);
  const srvBar = document.getElementById('service-alert-bar');
  if (activeVeh && activeVeh.serviceOdo > 0 && lastOdo > 0) {
    const left = activeVeh.serviceOdo - lastOdo;
    srvBar.style.display = 'block';
    if (left >= 0) {
      srvBar.classList.remove('overdue');
      document.getElementById('service-alert-text').textContent = `Do wymiany oleju: ${left.toFixed(0)} km (przy ${activeVeh.serviceOdo} km)`;
    } else {
      srvBar.classList.add('overdue');
      document.getElementById('service-alert-text').textContent = `PRZEKROCZONO SERWIS o ${Math.abs(left).toFixed(0)} km!`;
    }
  } else {
    srvBar.style.display = 'none';
  }

  // Terminy: Przegląd techniczny (TÜV) + Podatek Kfz-Steuer obok siebie
  const hasTuv = activeVeh ? formatDateBadge(activeVeh.tuvDate, 'Przegląd', 'tuv-alert-box', 'tuv-alert-text') : false;
  const hasTax = activeVeh ? formatDateBadge(activeVeh.taxDate, 'Kfz-Steuer', 'tax-alert-box', 'tax-alert-text') : false;
  const datesGrid = document.getElementById('dates-alert-grid');
  if (hasTuv || hasTax) {
    datesGrid.style.display = 'grid';
    datesGrid.style.gridTemplateColumns = (hasTuv && hasTax) ? '1fr 1fr' : '1fr';
  } else {
    datesGrid.style.display = 'none';
  }

  // Tabela historii
  const tbody = document.getElementById('history-tbody');
  tbody.innerHTML = '';
  document.getElementById('history-count').textContent = computed.length;

  [...computed].reverse().forEach(e => {
    const tr = document.createElement('tr');
    const sym = e.currency === 'EUR' ? '€' : 'zł';
    const consTxt = e.consumption !== null ? `<strong>${e.consumption.toFixed(2)}</strong>` : (e.isFull ? 'Start' : 'Część.');
    tr.innerHTML = `
      <td>${e.date}<br><small style="color:var(--text-muted)">${e.route || ''}</small></td>
      <td>${e.liters.toFixed(2)} l ${e.isFull ? '🟢' : '🟡'}</td>
      <td>${e.calcDist > 0 ? '+' + e.calcDist + ' km' : e.odo + ' km'}</td>
      <td>${consTxt}</td>
      <td>${e.totalCost > 0 ? e.totalCost.toFixed(2) + ' ' + sym : '-'}</td>
    `;
    tr.addEventListener('click', () => openEditForm(e.id));
    tbody.appendChild(tr);
  });
}

function updateCost100Preview(curr, elId, symbol, avgCons, entries) {
  const priced = entries.filter(e => e.currency === curr && e.pricePerLiter > 0);
  const el = document.getElementById(elId);
  if (priced.length > 0 && avgCons > 0) {
    const avgPrice = priced.reduce((s, e) => s + e.pricePerLiter, 0) / priced.length;
    el.textContent = `${(avgCons * avgPrice).toFixed(2)} ${symbol}`;
  } else {
    el.textContent = '--';
  }
}

// ================= STATYSTYKI I WYKRES =================
function setupStatsFilter() {
  document.querySelectorAll('.filter-bar button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-bar button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentStatsPeriod = btn.dataset.period;
      renderStats();
    });
  });
}

function renderStats() {
  const vId = appData.settings.activeVehicleId;
  let list = calculateComputedEntries(vId);

  const now = new Date();
  if (currentStatsPeriod === 'MONTH') {
    list = list.filter(e => {
      const d = new Date(e.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  } else if (currentStatsPeriod === '3M') {
    const cut = new Date();
    cut.setMonth(now.getMonth() - 3);
    list = list.filter(e => new Date(e.date) >= cut);
  } else if (currentStatsPeriod === 'YEAR') {
    list = list.filter(e => new Date(e.date).getFullYear() === now.getFullYear());
  }

  const fulls = list.filter(e => e.consumption !== null);
  let avgCons = 0;

  if (fulls.length > 0) {
    const vals = fulls.map(e => e.consumption);
    avgCons = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
    document.getElementById('st-avg').textContent = avgCons.toFixed(2);
    document.getElementById('st-min').textContent = Math.min(...vals).toFixed(2);
    document.getElementById('st-max').textContent = Math.max(...vals).toFixed(2);
  } else {
    document.getElementById('st-avg').textContent = '--';
    document.getElementById('st-min').textContent = '--';
    document.getElementById('st-max').textContent = '--';
  }

  const dist = list.reduce((s, e) => s + (e.calcDist || 0), 0);
  const liters = list.reduce((s, e) => s + e.liters, 0);
  document.getElementById('st-dist').textContent = `${dist.toFixed(1)} km`;
  document.getElementById('st-liters').textContent = `${liters.toFixed(2)} l`;

  renderCurrencyBlock('PLN', 'zł', 'st-pln', list, avgCons);
  renderCurrencyBlock('EUR', '€', 'st-eur', list, avgCons);
  renderChart(fulls.slice(-10));
}

function renderCurrencyBlock(curr, sym, prefix, list, avgCons) {
  const items = list.filter(e => e.currency === curr);
  const sum = items.reduce((s, e) => s + (e.totalCost || 0), 0);
  const priced = items.filter(e => e.pricePerLiter > 0);
  const avgP = priced.length > 0 ? priced.reduce((s, e) => s + e.pricePerLiter, 0) / priced.length : 0;

  document.getElementById(`${prefix}-sum`).textContent = `${sum.toFixed(2)} ${sym}`;
  document.getElementById(`${prefix}-price`).textContent = avgP > 0 ? `${avgP.toFixed(2)} ${sym}` : '--';
  document.getElementById(`${prefix}-100`).textContent = (avgP > 0 && avgCons > 0) ? `${(avgP * avgCons).toFixed(2)} ${sym}` : '--';
}

function renderChart(items) {
  const box = document.getElementById('retro-chart');
  box.innerHTML = '';
  if (items.length === 0) {
    box.innerHTML = '<div class="empty-msg">Za mało pełnych tankowań do wykresu</div>';
    return;
  }

  const maxVal = Math.max(...items.map(i => i.consumption)) * 1.15;
  items.forEach(item => {
    const pct = Math.max(10, Math.round((item.consumption / maxVal) * 100));
    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-wrap';
    wrap.innerHTML = `
      <div class="chart-bar-val">${item.consumption.toFixed(1)}</div>
      <div class="chart-bar" style="height:${pct}%"></div>
      <div class="chart-bar-lbl">${item.date.slice(5)}</div>
    `;
    box.appendChild(wrap);
  });
}

// ================= USTAWIENIA, POJAZDY I KOPIA =================
function setupSettingsLogic() {
  document.getElementById('sel-theme').addEventListener('change', (e) => {
    appData.settings.theme = e.target.value;
    applyTheme(e.target.value);
    saveData('Zmieniono motyw');
  });

  document.getElementById('active-vehicle-select').addEventListener('change', (e) => {
    appData.settings.activeVehicleId = e.target.value;
    saveData('Przełączono pojazd');
  });

  document.getElementById('btn-add-vehicle').addEventListener('click', () => {
    const inp = document.getElementById('new-vehicle-name');
    const name = inp.value.trim();
    if (!name) return;
    const newId = 'v_' + Date.now();
    appData.vehicles.push({ id: newId, name, serviceOdo: 0, tuvDate: '', taxDate: '' });
    appData.settings.activeVehicleId = newId;
    inp.value = '';
    saveData('Dodano pojazd: ' + name);
  });

  document.getElementById('btn-save-service').addEventListener('click', () => {
    const valOdo = parseInt(document.getElementById('inp-service-odo').value, 10) || 0;
    const valTuv = document.getElementById('inp-tuv-date').value || '';
    const valTax = document.getElementById('inp-tax-date').value || '';
    const veh = appData.vehicles.find(v => v.id === appData.settings.activeVehicleId);
    if (veh) {
      veh.serviceOdo = valOdo;
      veh.tuvDate = valTuv;
      veh.taxDate = valTax;
      saveData('Zapisano terminy serwisu, przeglądu i Kfz-Steuer');
    }
  });

  document.getElementById('def-mode').value = appData.settings.defaultMode;
  document.getElementById('def-mode').addEventListener('change', (e) => {
    appData.settings.defaultMode = e.target.value;
    saveData('Zapisano domyślny tryb');
  });

  document.getElementById('def-curr').value = appData.settings.defaultCurrency;
  document.getElementById('def-curr').addEventListener('change', (e) => {
    appData.settings.defaultCurrency = e.target.value;
    saveData('Zapisano domyślną walutę');
  });

  document.getElementById('btn-export-json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
    downloadFile(blob, `paliwo_kopia_${new Date().toISOString().slice(0,10)}.json`);
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    const vId = appData.settings.activeVehicleId;
    const rows = calculateComputedEntries(vId);
    let csv = '\uFEFFData;ODO (km);Dystans (km);Litry;Spalanie (l/100);Cena/l;Kwota;Waluta;Pelny bak;Trasa;Notatka\n';
    rows.forEach(r => {
      csv += `${r.date};${r.odo};${r.calcDist};${r.liters};${r.consumption || ''};${r.pricePerLiter};${r.totalCost};${r.currency};${r.isFull ? 'TAK' : 'NIE'};${r.route};"${r.note}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadFile(blob, `rozliczenie_paliwa_${new Date().toISOString().slice(0,10)}.csv`);
  });

  document.getElementById('inp-import-json').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (imported.entries && imported.vehicles) {
          appData = imported;
          applyTheme(appData.settings.theme || 'theme-vista');
          saveData('Przywrócono kopię z pliku!');
          alert('Kopia zapasowa została pomyślnie wczytana.');
        } else {
          alert('Nieprawidłowy format pliku kopii.');
        }
      } catch (err) {
        alert('Błąd podczas odczytu pliku JSON.');
      }
    };
    reader.readAsText(file);
  });
}

window.deleteVehicle = function(id) {
  if (appData.vehicles.length <= 1) return;
  if (!confirm('Usunąć ten pojazd wraz z jego historią tankowań?')) return;
  appData.vehicles = appData.vehicles.filter(v => v.id !== id);
  appData.entries = appData.entries.filter(e => e.vehicleId !== id);
  appData.settings.activeVehicleId = appData.vehicles[0].id;
  saveData('Usunięto pojazd');
};

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setStatus('Wyeksportowano: ' + filename);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
