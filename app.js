// ========== Storage Keys ==========
const STORAGE_KEY = 'accounting_records_v2';
const RATES_KEY = 'accounting_rates_v2';
const ACCOUNTS_KEY = 'accounting_accounts_v2';
const LIABILITIES_KEY = 'accounting_liabilities_v1';
const MPF_KEY = 'accounting_mpf_v1';

const DEFAULT_RATES = { MOP: 1, HKD: 1.03, CNY: 1.196, HKD_CNY: 0.86 };

const CATEGORY_ICONS = {
  '餐飲':'🍔','交通':'🚗','購物':'🛍️','娛樂':'🎮','居住':'🏠','母嬰':'👶',
  '保險費':'🛡️','學貸':'🎓','生活費':'💵','薪資':'💼','電話費':'📞','電費':'⚡',
  '淘寶':'🛒','上網費':'🌐','醫療':'🏥','其他':'🏷️'
};
const ACCOUNT_TYPE_ICONS = {
  '現金':'💵','銀行':'🏦','信用卡':'💳','電子錢包':'📱','投資':'📈','其他':'🏷️'
};
const TYPE_ORDER = ['現金','銀行','信用卡','電子錢包','投資','其他'];
const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#64748b','#0ea5e9','#a855f7','#06b6d4','#84cc16','#f43f5e','#6366f1'];

// ========== Helpers ==========
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
function formatMoney(n) {
  return Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
function loadJSON(key, fallback) {
  try {
    const d = localStorage.getItem(key);
    return d ? JSON.parse(d) : fallback;
  } catch { return fallback; }
}
function saveJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

// ========== Rates ==========
function loadRates() {
  const p = loadJSON(RATES_KEY, null);
  if (p) return { ...DEFAULT_RATES, ...p, MOP: 1 };
  return { ...DEFAULT_RATES };
}
function saveRatesObj(r) {
  saveJSON(RATES_KEY, { HKD: r.HKD, CNY: r.CNY, HKD_CNY: r.HKD_CNY });
}
let rates = loadRates();

function toMOP(amount, currency) {
  if (currency === 'MOP') return Number(amount);
  if (currency === 'HKD') return Number(amount) * rates.HKD;
  if (currency === 'CNY') return Number(amount) * rates.CNY;
  return Number(amount);
}

function balancesToMOP(balances) {
  if (!balances) return 0;
  return toMOP(balances.MOP || 0, 'MOP') + toMOP(balances.HKD || 0, 'HKD') + toMOP(balances.CNY || 0, 'CNY');
}

// ========== Data ==========
let records = loadJSON(STORAGE_KEY, []);
let accounts = loadJSON(ACCOUNTS_KEY, []);
// migrate old single-currency accounts
accounts = accounts.map(a => {
  if (a.balances) return a;
  const bal = { MOP: 0, HKD: 0, CNY: 0 };
  if (a.currency && a.balance != null) bal[a.currency] = Number(a.balance);
  return { id: a.id, name: a.name, type: a.type, balances: bal, note: a.note || '' };
});
saveJSON(ACCOUNTS_KEY, accounts);

let liabilities = loadJSON(LIABILITIES_KEY, []);
let mpfData = loadJSON(MPF_KEY, { totalBalance: 0, funds: [], contributions: [] });

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let currentType = 'expense';
let currentPage = 'monthly';
let charts = {};

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); charts[key] = null; }
}

// ========== Horizontal bar chart helper ==========
function makeHBarChart(canvas, labels, data, labelText) {
  const total = data.reduce((a, b) => a + b, 0) || 1;
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: labelText || '金額 (MOP)',
        data,
        backgroundColor: COLORS.slice(0, labels.length),
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = ((ctx.raw / total) * 100).toFixed(1);
              return `MOP ${formatMoney(ctx.raw)}（${pct}%）`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { callback: v => formatMoney(v) },
          grid: { color: '#f3f4f6' }
        },
        y: { grid: { display: false } }
      }
    }
  });
}

// ========== Init ==========
function init() {
  $('#date').valueAsDate = new Date();

  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  // monthly
  $('#btn-add').addEventListener('click', openAddModal);
  $('#btn-close-modal').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  $('#btn-prev-month').addEventListener('click', () => changeMonth(-1));
  $('#btn-next-month').addEventListener('click', () => changeMonth(1));
  $('#record-form').addEventListener('submit', handleRecordSubmit);
  $('#category').addEventListener('change', toggleCustomCategory);
  $$('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.dataset.type;
    });
  });
  $('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) closeModal(); });

  // yearly
  $('#btn-prev-year').addEventListener('click', () => { currentYear--; renderYearly(); });
  $('#btn-next-year').addEventListener('click', () => { currentYear++; renderYearly(); });

  // accounts
  $('#btn-add-account').addEventListener('click', openAddAccountModal);
  $('#btn-close-account-modal').addEventListener('click', closeAccountModal);
  $('#btn-cancel-account').addEventListener('click', closeAccountModal);
  $('#account-form').addEventListener('submit', handleAccountSubmit);
  $('#account-modal-overlay').addEventListener('click', e => { if (e.target === $('#account-modal-overlay')) closeAccountModal(); });

  // repay
  $('#btn-repay').addEventListener('click', openRepayModal);
  $('#btn-close-repay').addEventListener('click', closeRepayModal);
  $('#btn-cancel-repay').addEventListener('click', closeRepayModal);
  $('#repay-form').addEventListener('submit', handleRepaySubmit);
  $('#repay-modal-overlay').addEventListener('click', e => { if (e.target === $('#repay-modal-overlay')) closeRepayModal(); });

  // liabilities
  $('#btn-add-liability').addEventListener('click', openAddLiabilityModal);
  $('#btn-close-liability-modal').addEventListener('click', closeLiabilityModal);
  $('#btn-cancel-liability').addEventListener('click', closeLiabilityModal);
  $('#liability-form').addEventListener('submit', handleLiabilitySubmit);
  $('#liability-modal-overlay').addEventListener('click', e => { if (e.target === $('#liability-modal-overlay')) closeLiabilityModal(); });

  // mpf
  $('#btn-add-mpf').addEventListener('click', openAddMpfModal);
  $('#btn-close-mpf-modal').addEventListener('click', closeMpfModal);
  $('#btn-cancel-mpf').addEventListener('click', closeMpfModal);
  $('#mpf-form').addEventListener('submit', handleMpfSubmit);
  $('#mpf-modal-overlay').addEventListener('click', e => { if (e.target === $('#mpf-modal-overlay')) closeMpfModal(); });
  $('#btn-edit-mpf-funds').addEventListener('click', openMpfFundsModal);
  $('#btn-close-mpf-funds').addEventListener('click', closeMpfFundsModal);
  $('#btn-cancel-mpf-funds').addEventListener('click', closeMpfFundsModal);
  $('#mpf-funds-form').addEventListener('submit', handleMpfFundsSubmit);
  $('#btn-add-fund-row').addEventListener('click', () => addFundRow());
  $('#mpf-funds-modal-overlay').addEventListener('click', e => { if (e.target === $('#mpf-funds-modal-overlay')) closeMpfFundsModal(); });

  // rates
  $('#btn-rates').addEventListener('click', openRatesModal);
  $('#btn-close-rates').addEventListener('click', closeRatesModal);
  $('#btn-reset-rates').addEventListener('click', resetRates);
  $('#rates-form').addEventListener('submit', handleRatesSubmit);
  $('#rates-modal-overlay').addEventListener('click', e => { if (e.target === $('#rates-modal-overlay')) closeRatesModal(); });

  switchPage('monthly');
}

function switchPage(page) {
  currentPage = page;
  $$('.page').forEach(p => p.classList.remove('active'));
  $(`#page-${page}`).classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.page-only').forEach(btn => {
    btn.classList.toggle('hidden', btn.dataset.page !== page);
  });
  if (page === 'monthly') renderMonthly();
  else if (page === 'yearly') renderYearly();
  else if (page === 'accounts') renderAccounts();
  else if (page === 'assets') renderAssets();
  else if (page === 'mpf') renderMpf();
}

// ========== Monthly ==========
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
    .sort((a, b) => new Date(b.date) - new Date(a.date) || String(b.id).localeCompare(String(a.id)));
}

function renderMonthly() {
  $('#current-month-label').textContent = `${currentYear}年${currentMonth + 1}月`;
  let income = 0, expense = 0;
  getMonthRecords().forEach(r => {
    const amt = toMOP(r.amount, r.currency);
    if (r.type === 'income') income += amt; else expense += amt;
  });
  $('#summary-income').textContent = 'MOP ' + formatMoney(income);
  $('#summary-expense').textContent = 'MOP ' + formatMoney(expense);
  $('#summary-balance').textContent = 'MOP ' + formatMoney(income - expense);
  renderMonthChart();
  renderMonthRecords();
}

function renderMonthChart() {
  const list = getMonthRecords().filter(r => r.type === 'expense');
  const canvas = $('#categoryChart');
  const noData = $('#no-chart-data');
  destroyChart('category');
  if (!list.length) {
    canvas.style.display = 'none';
    noData.style.display = 'block';
    return;
  }
  canvas.style.display = 'block';
  noData.style.display = 'none';
  const byCat = {};
  list.forEach(r => {
    const c = r.category || '其他';
    byCat[c] = (byCat[c] || 0) + toMOP(r.amount, r.currency);
  });
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  charts.category = makeHBarChart(
    canvas,
    sorted.map(([c]) => `${CATEGORY_ICONS[c] || '🏷️'} ${c}`),
    sorted.map(([, v]) => v),
    '支出 (MOP)'
  );
}

function renderMonthRecords() {
  const list = getMonthRecords();
  const el = $('#records-list');
  el.innerHTML = '';
  if (!list.length) { $('#no-records').style.display = 'block'; return; }
  $('#no-records').style.display = 'none';
  list.forEach(r => {
    const icon = CATEGORY_ICONS[r.category] || '🏷️';
    const acc = accounts.find(a => a.id === r.accountId);
    const accName = acc ? acc.name : '';
    const item = document.createElement('div');
    item.className = 'record-item';
    item.innerHTML = `
      <div class="record-left">
        <div class="record-category">${icon} ${escapeHtml(r.category)}</div>
        <div class="record-meta">${r.date}${accName ? ' · ' + escapeHtml(accName) : ''}${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
      </div>
      <div class="record-right">
        <div class="record-amount ${r.type}">${r.type === 'expense' ? '−' : '+'} ${formatMoney(Number(r.amount))}</div>
        <div class="record-currency">${r.currency}</div>
        <div class="record-actions">
          <button class="edit" data-id="${r.id}">編輯</button>
          <button class="delete" data-id="${r.id}">刪除</button>
        </div>
      </div>`;
    el.appendChild(item);
  });
  el.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditModal(btn.dataset.id); });
  });
  el.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteRecord(btn.dataset.id); // no confirm
    });
  });
}

// ========== Yearly ==========
function getYearRecords() {
  return records.filter(r => new Date(r.date).getFullYear() === currentYear);
}

function renderYearly() {
  $('#current-year-label').textContent = `${currentYear}年`;
  const yearRecs = getYearRecords();
  let income = 0, expense = 0;
  const monthsInc = Array(12).fill(0);
  const monthsExp = Array(12).fill(0);
  yearRecs.forEach(r => {
    const m = new Date(r.date).getMonth();
    const amt = toMOP(r.amount, r.currency);
    if (r.type === 'income') { income += amt; monthsInc[m] += amt; }
    else { expense += amt; monthsExp[m] += amt; }
  });
  $('#year-income').textContent = 'MOP ' + formatMoney(income);
  $('#year-expense').textContent = 'MOP ' + formatMoney(expense);
  $('#year-balance').textContent = 'MOP ' + formatMoney(income - expense);

  // monthly bars - horizontal grouped: show each month as label with income/expense
  destroyChart('yearlyMonth');
  const monthLabels = [];
  const monthData = [];
  // For horizontal: stack or show net + separate. Simpler: show expense bars by month and income
  // Use two datasets on horizontal is awkward. Show combined: each month one bar for expense and use tooltip for both.
  // Better: labels = months, two datasets still works with indexAxis y
  const mLabels = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  charts.yearlyMonth = new Chart($('#yearlyMonthChart'), {
    type: 'bar',
    data: {
      labels: mLabels,
      datasets: [
        { label: '收入', data: monthsInc, backgroundColor: '#10b981', borderRadius: 4 },
        { label: '支出', data: monthsExp, backgroundColor: '#ef4444', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = (monthsInc[ctx.dataIndex] + monthsExp[ctx.dataIndex]) || 1;
              const pct = ((ctx.raw / total) * 100).toFixed(1);
              return `${ctx.dataset.label}: MOP ${formatMoney(ctx.raw)}（${pct}%）`;
            }
          }
        }
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: v => formatMoney(v) }, grid: { color: '#f3f4f6' } },
        y: { grid: { display: false } }
      }
    }
  });

  // category
  const expRecs = yearRecs.filter(r => r.type === 'expense');
  const canvas = $('#yearlyCategoryChart');
  const noData = $('#no-year-cat-data');
  destroyChart('yearlyCat');
  if (!expRecs.length) {
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
    charts.yearlyCat = makeHBarChart(
      canvas,
      sorted.map(([c]) => `${CATEGORY_ICONS[c] || '🏷️'} ${c}`),
      sorted.map(([, v]) => v)
    );
  }

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
      </div>`;
    listEl.appendChild(bar);
  }
  if (!listEl.children.length) listEl.innerHTML = '<div class="empty-hint">本年尚無紀錄</div>';
}

// ========== Accounts ==========
function accountNetMOP(a) {
  const total = balancesToMOP(a.balances);
  // 信用卡：正數＝欠款，對淨額為負
  if (a.type === '信用卡') return -total;
  return total;
}

function renderAccounts() {
  let net = 0;
  accounts.forEach(a => { net += accountNetMOP(a); });
  $('#accounts-total').textContent = 'MOP ' + formatMoney(net);

  const container = $('#accounts-by-type');
  container.innerHTML = '';
  if (!accounts.length) {
    $('#no-accounts').style.display = 'block';
    return;
  }
  $('#no-accounts').style.display = 'none';

  TYPE_ORDER.forEach(type => {
    const group = accounts.filter(a => a.type === type);
    if (!group.length) return;
    const section = document.createElement('div');
    section.className = 'type-group';
    section.innerHTML = `<div class="type-group-title">${ACCOUNT_TYPE_ICONS[type] || ''} ${type}</div>`;
    const sorted = [...group].sort((a, b) => Math.abs(balancesToMOP(b.balances)) - Math.abs(balancesToMOP(a.balances)));
    sorted.forEach(a => {
      const mop = balancesToMOP(a.balances);
      const parts = [];
      if (a.balances.MOP) parts.push(`MOP ${formatMoney(a.balances.MOP)}`);
      if (a.balances.HKD) parts.push(`HKD ${formatMoney(a.balances.HKD)}`);
      if (a.balances.CNY) parts.push(`CNY ${formatMoney(a.balances.CNY)}`);
      const item = document.createElement('div');
      item.className = 'account-item';
      const isDebt = a.type === '信用卡';
      item.innerHTML = `
        <div class="account-left">
          <div class="account-name">${escapeHtml(a.name)}</div>
          <div class="account-meta">${parts.join(' · ') || '餘額 0'}${a.note ? ' · ' + escapeHtml(a.note) : ''}</div>
        </div>
        <div class="account-right">
          <div class="account-balance ${isDebt ? 'debt' : ''}">${isDebt ? '欠 ' : ''}MOP ${formatMoney(mop)}</div>
          <div class="account-actions">
            <button class="edit" data-id="${a.id}">編輯</button>
            <button class="delete" data-id="${a.id}">刪除</button>
          </div>
        </div>`;
      section.appendChild(item);
    });
    container.appendChild(section);
  });

  container.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', () => openEditAccountModal(btn.dataset.id));
  });
  container.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', () => {
      accounts = accounts.filter(a => a.id !== btn.dataset.id);
      saveJSON(ACCOUNTS_KEY, accounts);
      renderAccounts();
    });
  });
}

function populateAccountSelect(selectedId = '') {
  const sel = $('#record-account');
  sel.innerHTML = '<option value="">請選擇戶口</option>';
  accounts.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
    if (a.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ========== Assets ==========
function renderAssets() {
  // Gross assets: non-credit-card accounts
  // Liabilities: credit card debts + explicit liabilities
  let gross = 0;
  let creditDebt = 0;
  accounts.forEach(a => {
    const mop = balancesToMOP(a.balances);
    if (a.type === '信用卡') creditDebt += mop;
    else gross += mop;
  });
  let otherLiab = 0;
  liabilities.forEach(l => { otherLiab += balancesToMOP(l.balances); });
  const totalLiab = creditDebt + otherLiab;
  const net = gross - totalLiab;

  $('#assets-gross').textContent = 'MOP ' + formatMoney(gross);
  $('#assets-liability').textContent = 'MOP ' + formatMoney(totalLiab);
  $('#assets-net').textContent = 'MOP ' + formatMoney(net);

  // Asset accounts only (non credit card)
  const assetAccounts = accounts.filter(a => a.type !== '信用卡' && balancesToMOP(a.balances) > 0);
  destroyChart('assetsAcc');
  destroyChart('assetsCur');
  const noData = $('#no-assets-data');

  if (!assetAccounts.length) {
    noData.style.display = 'block';
    $('#assetsAccountChart').style.display = 'none';
    $('#assetsCurrencyChart').style.display = 'none';
  } else {
    noData.style.display = 'none';
    $('#assetsAccountChart').style.display = 'block';
    $('#assetsCurrencyChart').style.display = 'block';

    const sorted = [...assetAccounts].sort((a, b) => balancesToMOP(b.balances) - balancesToMOP(a.balances));
    charts.assetsAcc = makeHBarChart(
      $('#assetsAccountChart'),
      sorted.map(a => `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`),
      sorted.map(a => balancesToMOP(a.balances))
    );

    const byCur = { MOP: 0, HKD: 0, CNY: 0 };
    assetAccounts.forEach(a => {
      byCur.MOP += Number(a.balances.MOP || 0);
      byCur.HKD += toMOP(a.balances.HKD || 0, 'HKD');
      byCur.CNY += toMOP(a.balances.CNY || 0, 'CNY');
    });
    const curEntries = Object.entries(byCur).filter(([, v]) => v > 0);
    charts.assetsCur = makeHBarChart(
      $('#assetsCurrencyChart'),
      curEntries.map(([c]) => c),
      curEntries.map(([, v]) => v)
    );
  }

  // detail
  const detailEl = $('#assets-detail-list');
  detailEl.innerHTML = '';
  const sortedAll = [...accounts].filter(a => a.type !== '信用卡').sort((a, b) => balancesToMOP(b.balances) - balancesToMOP(a.balances));
  sortedAll.forEach(a => {
    const mop = balancesToMOP(a.balances);
    const pct = gross ? ((mop / gross) * 100).toFixed(1) : 0;
    const item = document.createElement('div');
    item.className = 'account-item';
    item.innerHTML = `
      <div class="account-left">
        <div class="account-name">${ACCOUNT_TYPE_ICONS[a.type] || ''} ${escapeHtml(a.name)}</div>
        <div class="account-meta">${a.type}</div>
      </div>
      <div class="account-right">
        <div class="account-balance">MOP ${formatMoney(mop)}</div>
        <div class="account-meta">${pct}%</div>
      </div>`;
    detailEl.appendChild(item);
  });
  if (!sortedAll.length) detailEl.innerHTML = '<div class="empty-hint">請先到「戶口」新增資產戶口</div>';

  // liabilities list
  const liabEl = $('#liabilities-list');
  liabEl.innerHTML = '';
  // show credit cards as liabilities too
  const ccList = accounts.filter(a => a.type === '信用卡' && balancesToMOP(a.balances) > 0);
  if (!liabilities.length && !ccList.length) {
    $('#no-liabilities').style.display = 'block';
  } else {
    $('#no-liabilities').style.display = 'none';
    ccList.forEach(a => {
      const item = document.createElement('div');
      item.className = 'account-item';
      item.innerHTML = `
        <div class="account-left">
          <div class="account-name">💳 ${escapeHtml(a.name)}</div>
          <div class="account-meta">信用卡欠款</div>
        </div>
        <div class="account-right">
          <div class="account-balance debt">MOP ${formatMoney(balancesToMOP(a.balances))}</div>
        </div>`;
      liabEl.appendChild(item);
    });
    liabilities.forEach(l => {
      const mop = balancesToMOP(l.balances);
      const parts = [];
      if (l.balances.MOP) parts.push(`MOP ${formatMoney(l.balances.MOP)}`);
      if (l.balances.HKD) parts.push(`HKD ${formatMoney(l.balances.HKD)}`);
      if (l.balances.CNY) parts.push(`CNY ${formatMoney(l.balances.CNY)}`);
      const item = document.createElement('div');
      item.className = 'account-item';
      item.innerHTML = `
        <div class="account-left">
          <div class="account-name">${escapeHtml(l.name)}</div>
          <div class="account-meta">${parts.join(' · ')}${l.note ? ' · ' + escapeHtml(l.note) : ''}</div>
        </div>
        <div class="account-right">
          <div class="account-balance debt">MOP ${formatMoney(mop)}</div>
          <div class="account-actions">
            <button class="edit" data-id="${l.id}">編輯</button>
            <button class="delete" data-id="${l.id}">刪除</button>
          </div>
        </div>`;
      liabEl.appendChild(item);
    });
    liabEl.querySelectorAll('.edit').forEach(btn => {
      btn.addEventListener('click', () => openEditLiabilityModal(btn.dataset.id));
    });
    liabEl.querySelectorAll('.delete').forEach(btn => {
      btn.addEventListener('click', () => {
        liabilities = liabilities.filter(l => l.id !== btn.dataset.id);
        saveJSON(LIABILITIES_KEY, liabilities);
        renderAssets();
      });
    });
  }
}

// ========== MPF ==========
function renderMpf() {
  $('#mpf-total').textContent = 'MOP ' + formatMoney(mpfData.totalBalance || 0);

  const thisYear = new Date().getFullYear();
  let emp = 0, emr = 0;
  (mpfData.contributions || []).forEach(c => {
    if (new Date(c.date).getFullYear() === thisYear) {
      emp += Number(c.employee) || 0;
      emr += Number(c.employer) || 0;
    }
  });
  $('#mpf-employee-year').textContent = 'MOP ' + formatMoney(emp);
  $('#mpf-employer-year').textContent = 'MOP ' + formatMoney(emr);

  // funds chart
  destroyChart('mpfFund');
  const funds = mpfData.funds || [];
  const canvas = $('#mpfFundChart');
  const noFund = $('#no-mpf-fund');
  if (!funds.length) {
    canvas.style.display = 'none';
    noFund.style.display = 'block';
  } else {
    canvas.style.display = 'block';
    noFund.style.display = 'none';
    const total = mpfData.totalBalance || 0;
    charts.mpfFund = makeHBarChart(
      canvas,
      funds.map(f => f.name),
      funds.map(f => total * (Number(f.percent) || 0) / 100)
    );
  }

  // funds list
  const fl = $('#mpf-funds-list');
  fl.innerHTML = '';
  if (!funds.length) {
    fl.innerHTML = '<div class="empty-hint">點「編輯配置」設定基金</div>';
  } else {
    funds.forEach(f => {
      const amt = (mpfData.totalBalance || 0) * (Number(f.percent) || 0) / 100;
      const item = document.createElement('div');
      item.className = 'account-item';
      item.innerHTML = `
        <div class="account-left">
          <div class="account-name">${escapeHtml(f.name)}</div>
          <div class="account-meta">${f.percent}%</div>
        </div>
        <div class="account-right">
          <div class="account-balance">MOP ${formatMoney(amt)}</div>
        </div>`;
      fl.appendChild(item);
    });
  }

  // contributions
  const cl = $('#mpf-contrib-list');
  cl.innerHTML = '';
  const contribs = [...(mpfData.contributions || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!contribs.length) {
    $('#no-mpf-contrib').style.display = 'block';
  } else {
    $('#no-mpf-contrib').style.display = 'none';
    contribs.forEach(c => {
      const item = document.createElement('div');
      item.className = 'record-item';
      item.innerHTML = `
        <div class="record-left">
          <div class="record-category">${c.date}</div>
          <div class="record-meta">僱員 ${formatMoney(c.employee)} · 僱主 ${formatMoney(c.employer)}${c.note ? ' · ' + escapeHtml(c.note) : ''}</div>
        </div>
        <div class="record-right">
          <div class="record-amount income">＋ ${formatMoney(Number(c.employee) + Number(c.employer))}</div>
          <div class="record-actions">
            <button class="edit" data-id="${c.id}">編輯</button>
            <button class="delete" data-id="${c.id}">刪除</button>
          </div>
        </div>`;
      cl.appendChild(item);
    });
    cl.querySelectorAll('.edit').forEach(btn => {
      btn.addEventListener('click', () => openEditMpfModal(btn.dataset.id));
    });
    cl.querySelectorAll('.delete').forEach(btn => {
      btn.addEventListener('click', () => {
        mpfData.contributions = mpfData.contributions.filter(c => c.id !== btn.dataset.id);
        saveJSON(MPF_KEY, mpfData);
        renderMpf();
      });
    });
  }
}

// ========== Record CRUD ==========
function applyBalanceDelta(accountId, currency, delta, isCreditCard) {
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return;
  if (!acc.balances) acc.balances = { MOP: 0, HKD: 0, CNY: 0 };
  // 一般戶口：收入 +、支出 −
  // 信用卡（正數＝欠款）：支出 +欠款、收入（還款類）−欠款
  // delta 已由呼叫端決定正負
  acc.balances[currency] = Number(acc.balances[currency] || 0) + delta;
  saveJSON(ACCOUNTS_KEY, accounts);
}

function balanceDeltaForRecord(type, amount, accountType) {
  // returns delta to apply to account balance for this currency
  if (accountType === '信用卡') {
    // expense increases debt; income decreases debt
    return type === 'expense' ? Number(amount) : -Number(amount);
  }
  // normal: expense decreases, income increases
  return type === 'expense' ? -Number(amount) : Number(amount);
}

function openAddModal() {
  if (!accounts.length) {
    alert('請先到「戶口」頁面新增至少一個戶口');
    return;
  }
  $('#modal-title').textContent = '新增紀錄';
  $('#record-form').reset();
  $('#edit-id').value = '';
  $('#date').valueAsDate = new Date();
  currentType = 'expense';
  $$('.type-btn').forEach(b => b.classList.remove('active'));
  $('.type-btn[data-type="expense"]').classList.add('active');
  $('#custom-category-row').classList.add('hidden');
  $('#custom-category').required = false;
  populateAccountSelect();
  $('#modal-overlay').classList.remove('hidden');
}

function openEditModal(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  $('#modal-title').textContent = '編輯紀錄';
  $('#edit-id').value = r.id;
  $('#amount').value = r.amount;
  $('#currency').value = r.currency;
  $('#date').value = r.date;
  $('#note').value = r.note || '';
  currentType = r.type;
  $$('.type-btn').forEach(b => b.classList.remove('active'));
  $(`.type-btn[data-type="${r.type}"]`).classList.add('active');
  const preset = Array.from($('#category').options).map(o => o.value);
  if (preset.includes(r.category)) {
    $('#category').value = r.category;
    $('#custom-category-row').classList.add('hidden');
    $('#custom-category').required = false;
  } else {
    $('#category').value = '其他';
    $('#custom-category-row').classList.remove('hidden');
    $('#custom-category').value = r.category;
    $('#custom-category').required = true;
  }
  populateAccountSelect(r.accountId || '');
  $('#modal-overlay').classList.remove('hidden');
}

function closeModal() { $('#modal-overlay').classList.add('hidden'); }

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

function handleRecordSubmit(e) {
  e.preventDefault();
  let category = $('#category').value;
  if (category === '其他') {
    category = $('#custom-category').value.trim();
    if (!category) { alert('請輸入自訂分類名稱'); return; }
  }
  const accountId = $('#record-account').value;
  if (!accountId) { alert('請選擇戶口'); return; }

  const old = records.find(r => r.id === $('#edit-id').value);
  const record = {
    id: $('#edit-id').value || String(Date.now()),
    type: currentType,
    amount: Number($('#amount').value),
    currency: $('#currency').value,
    date: $('#date').value,
    category,
    accountId,
    note: $('#note').value.trim(),
    createdAt: old?.createdAt || new Date().toISOString()
  };

  // reverse old
  if (old && old.accountId) {
    const oldAcc = accounts.find(a => a.id === old.accountId);
    if (oldAcc) {
      const rev = -balanceDeltaForRecord(old.type, old.amount, oldAcc.type);
      applyBalanceDelta(old.accountId, old.currency, rev, oldAcc.type === '信用卡');
    }
  }
  // apply new
  const newAcc = accounts.find(a => a.id === record.accountId);
  if (newAcc) {
    const d = balanceDeltaForRecord(record.type, record.amount, newAcc.type);
    applyBalanceDelta(record.accountId, record.currency, d, newAcc.type === '信用卡');
  }

  const idx = records.findIndex(r => r.id === record.id);
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  saveJSON(STORAGE_KEY, records);
  closeModal();
  if (currentPage === 'monthly') renderMonthly();
  else if (currentPage === 'yearly') renderYearly();
}

function deleteRecord(id) {
  const rec = records.find(r => r.id === id);
  if (rec && rec.accountId) {
    const acc = accounts.find(a => a.id === rec.accountId);
    if (acc) {
      const rev = -balanceDeltaForRecord(rec.type, rec.amount, acc.type);
      applyBalanceDelta(rec.accountId, rec.currency, rev, acc.type === '信用卡');
    }
  }
  records = records.filter(r => r.id !== id);
  saveJSON(STORAGE_KEY, records);
  renderMonthly();
}

// ========== Account Modal ==========
function openAddAccountModal() {
  $('#account-modal-title').textContent = '新增戶口';
  $('#account-form').reset();
  $('#account-edit-id').value = '';
  $('#acc-bal-mop').value = 0;
  $('#acc-bal-hkd').value = 0;
  $('#acc-bal-cny').value = 0;
  $('#account-modal-overlay').classList.remove('hidden');
}

function openEditAccountModal(id) {
  const a = accounts.find(x => x.id === id);
  if (!a) return;
  $('#account-modal-title').textContent = '編輯戶口';
  $('#account-edit-id').value = a.id;
  $('#account-name').value = a.name;
  $('#account-type').value = a.type;
  $('#acc-bal-mop').value = a.balances?.MOP || 0;
  $('#acc-bal-hkd').value = a.balances?.HKD || 0;
  $('#acc-bal-cny').value = a.balances?.CNY || 0;
  $('#account-note').value = a.note || '';
  $('#account-modal-overlay').classList.remove('hidden');
}

function closeAccountModal() { $('#account-modal-overlay').classList.add('hidden'); }

function handleAccountSubmit(e) {
  e.preventDefault();
  const acc = {
    id: $('#account-edit-id').value || String(Date.now()),
    name: $('#account-name').value.trim(),
    type: $('#account-type').value,
    balances: {
      MOP: Number($('#acc-bal-mop').value) || 0,
      HKD: Number($('#acc-bal-hkd').value) || 0,
      CNY: Number($('#acc-bal-cny').value) || 0
    },
    note: $('#account-note').value.trim()
  };
  const idx = accounts.findIndex(a => a.id === acc.id);
  if (idx >= 0) accounts[idx] = acc;
  else accounts.push(acc);
  saveJSON(ACCOUNTS_KEY, accounts);
  closeAccountModal();
  renderAccounts();
}

// ========== Repay ==========
function openRepayModal() {
  const sources = accounts.filter(a => a.type !== '信用卡');
  const cards = accounts.filter(a => a.type === '信用卡');
  if (!sources.length || !cards.length) {
    alert('需要至少一個非信用卡戶口，以及一個信用卡戶口');
    return;
  }
  const fromSel = $('#repay-from');
  const toSel = $('#repay-to');
  fromSel.innerHTML = '';
  toSel.innerHTML = '';
  sources.forEach(a => {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
    fromSel.appendChild(o);
  });
  cards.forEach(a => {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
    toSel.appendChild(o);
  });
  $('#repay-date').valueAsDate = new Date();
  $('#repay-amount').value = '';
  $('#repay-note').value = '';
  $('#repay-modal-overlay').classList.remove('hidden');
}

function closeRepayModal() { $('#repay-modal-overlay').classList.add('hidden'); }

function handleRepaySubmit(e) {
  e.preventDefault();
  const fromId = $('#repay-from').value;
  const toId = $('#repay-to').value;
  const currency = $('#repay-currency').value;
  const amount = Number($('#repay-amount').value);
  if (amount <= 0) return;

  // source decreases
  applyBalanceDelta(fromId, currency, -amount, false);
  // credit card debt decreases
  applyBalanceDelta(toId, currency, -amount, true);

  // also log as records
  const date = $('#repay-date').value;
  const note = $('#repay-note').value.trim() || '信用卡還款';
  records.push({
    id: String(Date.now()),
    type: 'expense',
    amount,
    currency,
    date,
    category: '其他',
    accountId: fromId,
    note: note + '（轉出）',
    createdAt: new Date().toISOString()
  });
  // debt reduction is reflected in account balance; optional second record skipped to avoid double expense
  saveJSON(STORAGE_KEY, records);
  closeRepayModal();
  renderAccounts();
}

// ========== Liabilities ==========
function openAddLiabilityModal() {
  $('#liability-modal-title').textContent = '新增扣減項';
  $('#liability-form').reset();
  $('#liability-edit-id').value = '';
  $('#liab-bal-mop').value = 0;
  $('#liab-bal-hkd').value = 0;
  $('#liab-bal-cny').value = 0;
  $('#liability-modal-overlay').classList.remove('hidden');
}

function openEditLiabilityModal(id) {
  const l = liabilities.find(x => x.id === id);
  if (!l) return;
  $('#liability-modal-title').textContent = '編輯扣減項';
  $('#liability-edit-id').value = l.id;
  $('#liability-name').value = l.name;
  $('#liab-bal-mop').value = l.balances?.MOP || 0;
  $('#liab-bal-hkd').value = l.balances?.HKD || 0;
  $('#liab-bal-cny').value = l.balances?.CNY || 0;
  $('#liability-note').value = l.note || '';
  $('#liability-modal-overlay').classList.remove('hidden');
}

function closeLiabilityModal() { $('#liability-modal-overlay').classList.add('hidden'); }

function handleLiabilitySubmit(e) {
  e.preventDefault();
  const l = {
    id: $('#liability-edit-id').value || String(Date.now()),
    name: $('#liability-name').value.trim(),
    balances: {
      MOP: Number($('#liab-bal-mop').value) || 0,
      HKD: Number($('#liab-bal-hkd').value) || 0,
      CNY: Number($('#liab-bal-cny').value) || 0
    },
    note: $('#liability-note').value.trim()
  };
  const idx = liabilities.findIndex(x => x.id === l.id);
  if (idx >= 0) liabilities[idx] = l;
  else liabilities.push(l);
  saveJSON(LIABILITIES_KEY, liabilities);
  closeLiabilityModal();
  renderAssets();
}

// ========== MPF Modals ==========
function openAddMpfModal() {
  $('#mpf-modal-title').textContent = '新增供款紀錄';
  $('#mpf-form').reset();
  $('#mpf-edit-id').value = '';
  $('#mpf-date').valueAsDate = new Date();
  $('#mpf-modal-overlay').classList.remove('hidden');
}

function openEditMpfModal(id) {
  const c = mpfData.contributions.find(x => x.id === id);
  if (!c) return;
  $('#mpf-modal-title').textContent = '編輯供款紀錄';
  $('#mpf-edit-id').value = c.id;
  $('#mpf-date').value = c.date;
  $('#mpf-employee').value = c.employee;
  $('#mpf-employer').value = c.employer;
  $('#mpf-note').value = c.note || '';
  $('#mpf-modal-overlay').classList.remove('hidden');
}

function closeMpfModal() { $('#mpf-modal-overlay').classList.add('hidden'); }

function handleMpfSubmit(e) {
  e.preventDefault();
  const c = {
    id: $('#mpf-edit-id').value || String(Date.now()),
    date: $('#mpf-date').value,
    employee: Number($('#mpf-employee').value) || 0,
    employer: Number($('#mpf-employer').value) || 0,
    note: $('#mpf-note').value.trim()
  };
  if (!mpfData.contributions) mpfData.contributions = [];
  const idx = mpfData.contributions.findIndex(x => x.id === c.id);
  // adjust total balance by delta
  const old = idx >= 0 ? mpfData.contributions[idx] : null;
  const oldTotal = old ? (Number(old.employee) + Number(old.employer)) : 0;
  const newTotal = c.employee + c.employer;
  mpfData.totalBalance = Number(mpfData.totalBalance || 0) - oldTotal + newTotal;
  if (idx >= 0) mpfData.contributions[idx] = c;
  else mpfData.contributions.push(c);
  saveJSON(MPF_KEY, mpfData);
  closeMpfModal();
  renderMpf();
}

function openMpfFundsModal() {
  $('#mpf-total-balance').value = mpfData.totalBalance || 0;
  const container = $('#mpf-funds-inputs');
  container.innerHTML = '';
  const funds = mpfData.funds?.length ? mpfData.funds : [{ name: '股票基金', percent: 60 }, { name: '債券基金', percent: 30 }, { name: '保守基金', percent: 10 }];
  funds.forEach(f => addFundRow(f.name, f.percent));
  $('#mpf-funds-modal-overlay').classList.remove('hidden');
}

function addFundRow(name = '', percent = '') {
  const row = document.createElement('div');
  row.className = 'fund-row';
  row.innerHTML = `
    <input type="text" placeholder="基金名稱" value="${escapeHtml(name)}" class="fund-name">
    <input type="number" placeholder="%" step="0.1" min="0" max="100" value="${percent}" class="fund-pct">
    <button type="button" class="btn-remove">×</button>`;
  row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
  $('#mpf-funds-inputs').appendChild(row);
}

function closeMpfFundsModal() { $('#mpf-funds-modal-overlay').classList.add('hidden'); }

function handleMpfFundsSubmit(e) {
  e.preventDefault();
  mpfData.totalBalance = Number($('#mpf-total-balance').value) || 0;
  const rows = $$('#mpf-funds-inputs .fund-row');
  mpfData.funds = [];
  rows.forEach(row => {
    const name = row.querySelector('.fund-name').value.trim();
    const percent = Number(row.querySelector('.fund-pct').value) || 0;
    if (name) mpfData.funds.push({ name, percent });
  });
  saveJSON(MPF_KEY, mpfData);
  closeMpfFundsModal();
  renderMpf();
}

// ========== Rates ==========
function openRatesModal() {
  $('#rate-hkd').value = rates.HKD;
  $('#rate-cny').value = rates.CNY;
  $('#rate-hkd-cny').value = rates.HKD_CNY;
  $('#rates-modal-overlay').classList.remove('hidden');
}
function closeRatesModal() { $('#rates-modal-overlay').classList.add('hidden'); }
function handleRatesSubmit(e) {
  e.preventDefault();
  const hkd = Number($('#rate-hkd').value);
  const cny = Number($('#rate-cny').value);
  const hkdCny = Number($('#rate-hkd-cny').value);
  if (hkd <= 0 || cny <= 0 || hkdCny <= 0) { alert('匯率必須大於 0'); return; }
  rates = { MOP: 1, HKD: hkd, CNY: cny, HKD_CNY: hkdCny };
  saveRatesObj(rates);
  closeRatesModal();
  switchPage(currentPage);
}
function resetRates() {
  rates = { ...DEFAULT_RATES };
  saveRatesObj(rates);
  $('#rate-hkd').value = rates.HKD;
  $('#rate-cny').value = rates.CNY;
  $('#rate-hkd-cny').value = rates.HKD_CNY;
}

// ========== Start ==========
init();
