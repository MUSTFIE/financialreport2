// ========== 資料管理 ==========
const STORAGE_KEY = 'accounting_records_v1';
const RATES_STORAGE_KEY = 'accounting_rates_v1';
const ACCOUNTS_STORAGE_KEY = 'accounting_accounts_v1';

const DEFAULT_RATES = {
  MOP: 1,
  HKD: 1.03,
  CNY: 1.196
};

const CATEGORY_ICONS = {
  '餐飲': '🍔', '交通': '🚗', '購物': '🛍️', '娛樂': '🎮',
  '居住': '🏠', '母嬰': '👶', '保險費': '🛡️', '學貸': '🎓',
  '生活費': '💵', '薪資': '💼', '電話費': '📞', '電費': '⚡',
  '淘寶': '🛒', '上網費': '🌐', '醫療': '🏥', '其他': '🏷️'
};

const ACCOUNT_TYPE_ICONS = {
  '現金': '💵', '銀行': '🏦', '信用卡': '💳',
  '電子錢包': '📱', '投資': '📈', '其他': '🏷️'
};

// ----- Rates -----
function loadRates() {
  try {
    const data = localStorage.getItem(RATES_STORAGE_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      return { ...DEFAULT_RATES, ...parsed, MOP: 1 };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_RATES };
}

function saveRates(rates) {
  localStorage.setItem(RATES_STORAGE_KEY, JSON.stringify({
    HKD: rates.HKD,
    CNY: rates.CNY
  }));
}

let ratesToMOP = loadRates();

function toMOP(amount, currency) {
  return Number(amount) * (ratesToMOP[currency] || 1);
}

// ----- Records -----
function loadRecords() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveRecords(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// ----- Accounts -----
function loadAccounts() {
  try {
    const data = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveAccounts(list) {
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(list));
}

// ========== 狀態 ==========
let records = loadRecords();
let accounts = loadAccounts();
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let currentType = 'expense';
let currentPage = 'monthly';
let categoryChart = null;
let yearlyMonthChart = null;
let yearlyCategoryChart = null;
let assetsAccountChart = null;
let assetsCurrencyChart = null;

// ========== DOM helper ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ========== 初始化 ==========
function init() {
  $('#date').valueAsDate = new Date();

  // 導航
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  // 每月
  $('#btn-add').addEventListener('click', openAddModal);
  $('#btn-close-modal').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  $('#btn-prev-month').addEventListener('click', () => changeMonth(-1));
  $('#btn-next-month').addEventListener('click', () => changeMonth(1));
  $('#record-form').addEventListener('submit', handleSubmit);
  $('#category').addEventListener('change', toggleCustomCategory);

  // 年度
  $('#btn-prev-year').addEventListener('click', () => { currentYear--; renderYearly(); });
  $('#btn-next-year').addEventListener('click', () => { currentYear++; renderYearly(); });

  // 戶口
  $('#btn-add-account').addEventListener('click', openAddAccountModal);
  $('#btn-close-account-modal').addEventListener('click', closeAccountModal);
  $('#btn-cancel-account').addEventListener('click', closeAccountModal);
  $('#account-form').addEventListener('submit', handleAccountSubmit);
  $('#account-modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('#account-modal-overlay')) closeAccountModal();
  });

  // 匯率
  $('#btn-rates').addEventListener('click', openRatesModal);
  $('#btn-close-rates').addEventListener('click', closeRatesModal);
  $('#btn-reset-rates').addEventListener('click', resetRates);
  $('#rates-form').addEventListener('submit', handleRatesSubmit);
  $('#rates-modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('#rates-modal-overlay')) closeRatesModal();
  });

  // 類型切換
  $$('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.dataset.type;
    });
  });

  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('#modal-overlay')) closeModal();
  });

  switchPage('monthly');
}

// ========== 頁面切換 ==========
function switchPage(page) {
  currentPage = page;
  $$('.page').forEach(p => p.classList.remove('active'));
  $(`#page-${page}`).classList.add('active');

  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));

  // 頂部按鈕顯示
  $$('.page-only').forEach(btn => {
    btn.classList.toggle('hidden', btn.dataset.page !== page);
  });

  if (page === 'monthly') renderMonthly();
  else if (page === 'yearly') renderYearly();
  else if (page === 'accounts') renderAccounts();
  else if (page === 'assets') renderAssets();
}

// ========== 工具 ==========
function formatMoney(n) {
  return Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========== 每月記帳 ==========
function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  else if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderMonthly();
}

function getMonthRecords() {
  return records
    .filter(r => {
      const d = new Date(r.date);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);
}

function renderMonthly() {
  $('#current-month-label').textContent = `${currentYear}年${currentMonth + 1}月`;
  renderMonthSummary();
  renderMonthChart();
  renderMonthRecords();
}

function renderMonthSummary() {
  let income = 0, expense = 0;
  getMonthRecords().forEach(r => {
    const amt = toMOP(r.amount, r.currency);
    if (r.type === 'income') income += amt;
    else expense += amt;
  });
  $('#summary-income').textContent = 'MOP ' + formatMoney(income);
  $('#summary-expense').textContent = 'MOP ' + formatMoney(expense);
  $('#summary-balance').textContent = 'MOP ' + formatMoney(income - expense);
}

function renderMonthRecords() {
  const list = getMonthRecords();
  const el = $('#records-list');
  el.innerHTML = '';
  if (list.length === 0) {
    $('#no-records').style.display = 'block';
    return;
  }
  $('#no-records').style.display = 'none';

  list.forEach(r => {
    const icon = CATEGORY_ICONS[r.category] || '🏷️';
    const accName = r.accountId ? (accounts.find(a => a.id === r.accountId)?.name || '') : '';
    const item = document.createElement('div');
    item.className = 'record-item';
    item.innerHTML = `
      <div class="record-left">
        <div class="record-category">${icon} ${escapeHtml(r.category)}</div>
        <div class="record-meta">
          ${r.date} · ${escapeHtml(r.payment)}${accName ? ' · ' + escapeHtml(accName) : ''}${r.note ? ' · ' + escapeHtml(r.note) : ''}
        </div>
      </div>
      <div class="record-right">
        <div class="record-amount ${r.type}">
          ${r.type === 'expense' ? '−' : '+'} ${formatMoney(Number(r.amount))}
        </div>
        <div class="record-currency">${r.currency}</div>
        <div class="record-actions">
          <button class="edit" data-id="${r.id}">編輯</button>
          <button class="delete" data-id="${r.id}">刪除</button>
        </div>
      </div>
    `;
    el.appendChild(item);
  });

  el.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(btn.dataset.id); });
  });
  el.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('確定要刪除此筆紀錄嗎？')) deleteRecord(btn.dataset.id);
    });
  });
}

function renderMonthChart() {
  const monthRecords = getMonthRecords().filter(r => r.type === 'expense');
  const canvas = $('#categoryChart');
  const noData = $('#no-chart-data');

  if (categoryChart) { categoryChart.destroy(); categoryChart = null; }

  if (monthRecords.length === 0) {
    canvas.style.display = 'none';
    noData.style.display = 'block';
    return;
  }
  canvas.style.display = 'block';
  noData.style.display = 'none';

  const byCategory = {};
  monthRecords.forEach(r => {
    const cat = r.category || '其他';
    byCategory[cat] = (byCategory[cat] || 0) + toMOP(r.amount, r.currency);
  });
  const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([c]) => `${CATEGORY_ICONS[c] || '🏷️'} ${c}`);
  const data = sorted.map(([, v]) => v);
  const colors = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#64748b','#0ea5e9','#a855f7','#06b6d4','#84cc16','#f43f5e','#6366f1'];

  categoryChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: '支出 (MOP)', data, backgroundColor: colors.slice(0, labels.length), borderRadius: 6, borderSkipped: false }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `MOP ${formatMoney(ctx.raw)}` } }
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: (v) => formatMoney(v) }, grid: { color: '#f3f4f6' } },
        y: { grid: { display: false } }
      }
    }
  });
}

// ========== 年度紀錄 ==========
function getYearRecords() {
  return records.filter(r => new Date(r.date).getFullYear() === currentYear);
}

function renderYearly() {
  $('#current-year-label').textContent = `${currentYear}年`;

  const yearRecs = getYearRecords();
  let income = 0, expense = 0;
  yearRecs.forEach(r => {
    const amt = toMOP(r.amount, r.currency);
    if (r.type === 'income') income += amt;
    else expense += amt;
  });
  $('#year-income').textContent = 'MOP ' + formatMoney(income);
  $('#year-expense').textContent = 'MOP ' + formatMoney(expense);
  $('#year-balance').textContent = 'MOP ' + formatMoney(income - expense);

  // 各月收支
  const monthsInc = Array(12).fill(0);
  const monthsExp = Array(12).fill(0);
  yearRecs.forEach(r => {
    const m = new Date(r.date).getMonth();
    const amt = toMOP(r.amount, r.currency);
    if (r.type === 'income') monthsInc[m] += amt;
    else monthsExp[m] += amt;
  });

  const monthLabels = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  if (yearlyMonthChart) { yearlyMonthChart.destroy(); yearlyMonthChart = null; }
  yearlyMonthChart = new Chart($('#yearlyMonthChart'), {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [
        { label: '收入', data: monthsInc, backgroundColor: '#10b981', borderRadius: 4 },
        { label: '支出', data: monthsExp, backgroundColor: '#ef4444', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: MOP ${formatMoney(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: (v) => formatMoney(v) }, grid: { color: '#f3f4f6' } }
      }
    }
  });

  // 年度分類
  const expRecs = yearRecs.filter(r => r.type === 'expense');
  const canvas = $('#yearlyCategoryChart');
  const noData = $('#no-year-cat-data');
  if (yearlyCategoryChart) { yearlyCategoryChart.destroy(); yearlyCategoryChart = null; }

  if (expRecs.length === 0) {
    canvas.style.display = 'none';
    noData.style.display = 'block';
  } else {
    canvas.style.display = 'block';
    noData.style.display = 'none';
    const byCat = {};
    expRecs.forEach(r => {
      const c = r.category || '其他';
      byCat[c] = (byCat[c] || 0) + toMOP(r.amount, r.currency);
    });
    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(([c]) => `${CATEGORY_ICONS[c] || '🏷️'} ${c}`);
    const data = sorted.map(([, v]) => v);
    const colors = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#64748b','#0ea5e9','#a855f7','#06b6d4','#84cc16','#f43f5e','#6366f1'];

    yearlyCategoryChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: '支出 (MOP)', data, backgroundColor: colors.slice(0, labels.length), borderRadius: 6, borderSkipped: false }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `MOP ${formatMoney(ctx.raw)}` } }
        },
        scales: {
          x: { beginAtZero: true, ticks: { callback: (v) => formatMoney(v) }, grid: { color: '#f3f4f6' } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  // 各月明細列表
  const listEl = $('#yearly-months-list');
  listEl.innerHTML = '';
  for (let m = 11; m >= 0; m--) {
    if (monthsInc[m] === 0 && monthsExp[m] === 0) continue;
    const bar = document.createElement('div');
    bar.className = 'month-bar';
    bar.innerHTML = `
      <div class="month-name">${currentYear}年${m + 1}月</div>
      <div class="month-stats">
        <div class="inc">＋ ${formatMoney(monthsInc[m])}</div>
        <div class="exp">− ${formatMoney(monthsExp[m])}</div>
        <div>結餘 ${formatMoney(monthsInc[m] - monthsExp[m])}</div>
      </div>
    `;
    listEl.appendChild(bar);
  }
  if (!listEl.children.length) {
    listEl.innerHTML = '<div class="empty-hint">本年尚無紀錄</div>';
  }
}

// ========== 戶口管理 ==========
function renderAccounts() {
  let total = 0;
  accounts.forEach(a => { total += toMOP(a.balance, a.currency); });
  $('#accounts-total').textContent = 'MOP ' + formatMoney(total);

  const el = $('#accounts-list');
  el.innerHTML = '';
  if (accounts.length === 0) {
    $('#no-accounts').style.display = 'block';
    return;
  }
  $('#no-accounts').style.display = 'none';

  // 依 MOP 金額排序
  const sorted = [...accounts].sort((a, b) => toMOP(b.balance, b.currency) - toMOP(a.balance, a.currency));

  sorted.forEach(a => {
    const icon = ACCOUNT_TYPE_ICONS[a.type] || '🏷️';
    const item = document.createElement('div');
    item.className = 'account-item';
    item.innerHTML = `
      <div class="account-left">
        <div class="account-name">${icon} ${escapeHtml(a.name)}</div>
        <div class="account-meta">${escapeHtml(a.type)} · ${a.currency}${a.note ? ' · ' + escapeHtml(a.note) : ''}</div>
      </div>
      <div class="account-right">
        <div class="account-balance">${formatMoney(Number(a.balance))} ${a.currency}</div>
        <div class="account-meta">≈ MOP ${formatMoney(toMOP(a.balance, a.currency))}</div>
        <div class="account-actions">
          <button class="edit" data-id="${a.id}">編輯</button>
          <button class="delete" data-id="${a.id}">刪除</button>
        </div>
      </div>
    `;
    el.appendChild(item);
  });

  el.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', () => openEditAccountModal(btn.dataset.id));
  });
  el.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('確定要刪除此戶口嗎？')) {
        accounts = accounts.filter(a => a.id !== btn.dataset.id);
        saveAccounts(accounts);
        renderAccounts();
      }
    });
  });
}

function populateAccountSelect(selectedId = '') {
  const sel = $('#record-account');
  sel.innerHTML = '<option value="">不關聯</option>';
  accounts.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name} (${a.currency})`;
    if (a.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ========== 總資產 ==========
function renderAssets() {
  let total = 0;
  accounts.forEach(a => { total += toMOP(a.balance, a.currency); });
  $('#assets-total').textContent = 'MOP ' + formatMoney(total);

  const noData = $('#no-assets-data');
  if (assetsAccountChart) { assetsAccountChart.destroy(); assetsAccountChart = null; }
  if (assetsCurrencyChart) { assetsCurrencyChart.destroy(); assetsCurrencyChart = null; }

  if (accounts.length === 0) {
    noData.style.display = 'block';
    $('#assetsAccountChart').style.display = 'none';
    $('#assetsCurrencyChart').style.display = 'none';
    $('#assets-detail-list').innerHTML = '<div class="empty-hint">請先到「戶口」頁面新增戶口</div>';
    return;
  }
  noData.style.display = 'none';
  $('#assetsAccountChart').style.display = 'block';
  $('#assetsCurrencyChart').style.display = 'block';

  // 依戶口
  const sorted = [...accounts].sort((a, b) => toMOP(b.balance, b.currency) - toMOP(a.balance, a.currency));
  const accLabels = sorted.map(a => `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`);
  const accData = sorted.map(a => toMOP(a.balance, a.currency));
  const colors = ['#4f46e5','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#64748b','#0ea5e9'];

  assetsAccountChart = new Chart($('#assetsAccountChart'), {
    type: 'doughnut',
    data: {
      labels: accLabels,
      datasets: [{ data: accData, backgroundColor: colors.slice(0, accLabels.length), borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = total ? ((ctx.raw / total) * 100).toFixed(1) : 0;
              return `${ctx.label}: MOP ${formatMoney(ctx.raw)} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  // 依貨幣
  const byCur = {};
  accounts.forEach(a => {
    byCur[a.currency] = (byCur[a.currency] || 0) + toMOP(a.balance, a.currency);
  });
  const curLabels = Object.keys(byCur);
  const curData = Object.values(byCur);

  assetsCurrencyChart = new Chart($('#assetsCurrencyChart'), {
    type: 'doughnut',
    data: {
      labels: curLabels,
      datasets: [{ data: curData, backgroundColor: ['#4f46e5', '#10b981', '#f59e0b'], borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = total ? ((ctx.raw / total) * 100).toFixed(1) : 0;
              return `${ctx.label}: MOP ${formatMoney(ctx.raw)} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  // 明細
  const detailEl = $('#assets-detail-list');
  detailEl.innerHTML = '';
  sorted.forEach(a => {
    const icon = ACCOUNT_TYPE_ICONS[a.type] || '🏷️';
    const pct = total ? ((toMOP(a.balance, a.currency) / total) * 100).toFixed(1) : 0;
    const item = document.createElement('div');
    item.className = 'account-item';
    item.innerHTML = `
      <div class="account-left">
        <div class="account-name">${icon} ${escapeHtml(a.name)}</div>
        <div class="account-meta">${escapeHtml(a.type)} · ${a.currency}</div>
      </div>
      <div class="account-right">
        <div class="account-balance">MOP ${formatMoney(toMOP(a.balance, a.currency))}</div>
        <div class="account-meta">${formatMoney(Number(a.balance))} ${a.currency} · ${pct}%</div>
      </div>
    `;
    detailEl.appendChild(item);
  });
}

// ========== 紀錄 Modal ==========
function openAddModal() {
  $('#modal-title').textContent = '新增紀錄';
  $('#record-form').reset();
  $('#edit-id').value = '';
  $('#date').valueAsDate = new Date();
  currentType = 'expense';
  $$('.type-btn').forEach(b => b.classList.remove('active'));
  $('.type-btn[data-type="expense"]').classList.add('active');
  $('#custom-category-row').classList.add('hidden');
  $('#custom-category').value = '';
  $('#custom-category').required = false;
  populateAccountSelect();
  $('#modal-overlay').classList.remove('hidden');
}

function openEditModal(id) {
  const record = records.find(r => r.id === id);
  if (!record) return;

  $('#modal-title').textContent = '編輯紀錄';
  $('#edit-id').value = record.id;
  $('#amount').value = record.amount;
  $('#currency').value = record.currency;
  $('#date').value = record.date;
  $('#payment').value = record.payment;
  $('#note').value = record.note || '';

  currentType = record.type;
  $$('.type-btn').forEach(b => b.classList.remove('active'));
  $(`.type-btn[data-type="${record.type}"]`).classList.add('active');

  const preset = Array.from($('#category').options).map(o => o.value);
  if (preset.includes(record.category)) {
    $('#category').value = record.category;
    $('#custom-category-row').classList.add('hidden');
    $('#custom-category').value = '';
    $('#custom-category').required = false;
  } else {
    $('#category').value = '其他';
    $('#custom-category-row').classList.remove('hidden');
    $('#custom-category').value = record.category;
    $('#custom-category').required = true;
  }

  populateAccountSelect(record.accountId || '');
  $('#modal-overlay').classList.remove('hidden');
}

function closeModal() {
  $('#modal-overlay').classList.add('hidden');
}

function toggleCustomCategory() {
  if ($('#category').value === '其他') {
    $('#custom-category-row').classList.remove('hidden');
    $('#custom-category').required = true;
    $('#custom-category').focus();
  } else {
    $('#custom-category-row').classList.add('hidden');
    $('#custom-category').required = false;
    $('#custom-category').value = '';
  }
}

function handleSubmit(e) {
  e.preventDefault();
  let category = $('#category').value;
  if (category === '其他') {
    category = $('#custom-category').value.trim();
    if (!category) { alert('請輸入自訂分類名稱'); return; }
  }

  const oldRecord = records.find(r => r.id === $('#edit-id').value);
  const record = {
    id: $('#edit-id').value || String(Date.now()),
    type: currentType,
    amount: Number($('#amount').value),
    currency: $('#currency').value,
    date: $('#date').value,
    category,
    payment: $('#payment').value,
    accountId: $('#record-account').value || '',
    note: $('#note').value.trim(),
    createdAt: oldRecord?.createdAt || new Date().toISOString()
  };

  // 若關聯戶口，更新戶口餘額
  updateAccountBalanceFromRecord(oldRecord, record);

  const idx = records.findIndex(r => r.id === record.id);
  if (idx >= 0) records[idx] = record;
  else records.push(record);

  saveRecords(records);
  closeModal();
  if (currentPage === 'monthly') renderMonthly();
  else if (currentPage === 'yearly') renderYearly();
}

function updateAccountBalanceFromRecord(oldRec, newRec) {
  // 還原舊紀錄對戶口的影響
  if (oldRec && oldRec.accountId) {
    const acc = accounts.find(a => a.id === oldRec.accountId);
    if (acc) {
      const delta = oldRec.type === 'income' ? -Number(oldRec.amount) : Number(oldRec.amount);
      // 僅在同貨幣時直接調整（簡化）
      if (acc.currency === oldRec.currency) {
        acc.balance = Number(acc.balance) + delta;
      }
    }
  }
  // 套用新紀錄
  if (newRec.accountId) {
    const acc = accounts.find(a => a.id === newRec.accountId);
    if (acc && acc.currency === newRec.currency) {
      const delta = newRec.type === 'income' ? Number(newRec.amount) : -Number(newRec.amount);
      acc.balance = Number(acc.balance) + delta;
    }
  }
  saveAccounts(accounts);
}

function deleteRecord(id) {
  const rec = records.find(r => r.id === id);
  if (rec && rec.accountId) {
    // 還原戶口餘額
    const acc = accounts.find(a => a.id === rec.accountId);
    if (acc && acc.currency === rec.currency) {
      const delta = rec.type === 'income' ? -Number(rec.amount) : Number(rec.amount);
      acc.balance = Number(acc.balance) + delta;
      saveAccounts(accounts);
    }
  }
  records = records.filter(r => r.id !== id);
  saveRecords(records);
  renderMonthly();
}

// ========== 戶口 Modal ==========
function openAddAccountModal() {
  $('#account-modal-title').textContent = '新增戶口';
  $('#account-form').reset();
  $('#account-edit-id').value = '';
  $('#account-modal-overlay').classList.remove('hidden');
}

function openEditAccountModal(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  $('#account-modal-title').textContent = '編輯戶口';
  $('#account-edit-id').value = acc.id;
  $('#account-name').value = acc.name;
  $('#account-type').value = acc.type;
  $('#account-currency').value = acc.currency;
  $('#account-balance').value = acc.balance;
  $('#account-note').value = acc.note || '';
  $('#account-modal-overlay').classList.remove('hidden');
}

function closeAccountModal() {
  $('#account-modal-overlay').classList.add('hidden');
}

function handleAccountSubmit(e) {
  e.preventDefault();
  const acc = {
    id: $('#account-edit-id').value || String(Date.now()),
    name: $('#account-name').value.trim(),
    type: $('#account-type').value,
    currency: $('#account-currency').value,
    balance: Number($('#account-balance').value),
    note: $('#account-note').value.trim()
  };
  const idx = accounts.findIndex(a => a.id === acc.id);
  if (idx >= 0) accounts[idx] = acc;
  else accounts.push(acc);
  saveAccounts(accounts);
  closeAccountModal();
  renderAccounts();
}

// ========== 匯率 ==========
function openRatesModal() {
  $('#rate-hkd').value = ratesToMOP.HKD;
  $('#rate-cny').value = ratesToMOP.CNY;
  $('#rates-modal-overlay').classList.remove('hidden');
}

function closeRatesModal() {
  $('#rates-modal-overlay').classList.add('hidden');
}

function handleRatesSubmit(e) {
  e.preventDefault();
  const hkd = Number($('#rate-hkd').value);
  const cny = Number($('#rate-cny').value);
  if (hkd <= 0 || cny <= 0) { alert('匯率必須大於 0'); return; }
  ratesToMOP = { MOP: 1, HKD: hkd, CNY: cny };
  saveRates(ratesToMOP);
  closeRatesModal();
  // 重新渲染當前頁
  switchPage(currentPage);
}

function resetRates() {
  ratesToMOP = { ...DEFAULT_RATES };
  saveRates(ratesToMOP);
  $('#rate-hkd').value = ratesToMOP.HKD;
  $('#rate-cny').value = ratesToMOP.CNY;
}

// ========== 啟動 ==========
init();
