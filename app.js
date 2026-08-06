const STORAGE_KEY = 'accounting_records_v2';
const RATES_KEY = 'accounting_rates_v2';
const ACCOUNTS_KEY = 'accounting_accounts_v2';
const LIABILITIES_KEY = 'accounting_liabilities_v1';
const MPF_KEY = 'accounting_mpf_v2';

const DEFAULT_RATES = { MOP: 1, HKD: 1.03, CNY: 1.196, HKD_CNY: 0.86 };
const CATEGORY_ICONS = {
  '餐飲':'🍔','交通':'🚗','購物':'🛍️','娛樂':'🎮','居住':'🏠','母嬰':'👶',
  '保險費':'🛡️','學貸':'🎓','生活費':'💵','薪資':'💼','電話費':'📞','電費':'⚡',
  '淘寶':'🛒','上網費':'🌐','醫療':'🏥','信用卡還款':'💳','其他':'🏷️'
};
const ACCOUNT_TYPE_ICONS = {
  '現金':'💵','銀行':'🏦','信用卡':'💳','電子錢包':'📱','投資':'📈','其他':'🏷️'
};
const TYPE_ORDER = ['現金','銀行','信用卡','電子錢包','投資','其他'];
const BAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#64748b','#0ea5e9','#a855f7','#06b6d4','#84cc16','#f43f5e','#6366f1'];

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
  try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : fallback; }
  catch { return fallback; }
}
function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function loadRates() {
  const p = loadJSON(RATES_KEY, null);
  return p ? { ...DEFAULT_RATES, ...p, MOP: 1 } : { ...DEFAULT_RATES };
}
function saveRatesObj(r) {
  saveJSON(RATES_KEY, { HKD: r.HKD, CNY: r.CNY, HKD_CNY: r.HKD_CNY });
}
let rates = loadRates();

function toMOP(amount, currency) {
  if (currency === 'HKD') return (Number(amount) || 0) * rates.HKD;
  if (currency === 'CNY') return (Number(amount) || 0) * rates.CNY;
  return Number(amount) || 0;
}
function balancesToMOP(b) {
  if (!b) return 0;
  return toMOP(b.MOP || 0, 'MOP') + toMOP(b.HKD || 0, 'HKD') + toMOP(b.CNY || 0, 'CNY');
}

function isRepayment(r) {
  return r.category === '信用卡還款' || !!r.repayToId;
}

let records = loadJSON(STORAGE_KEY, []);
let accounts = loadJSON(ACCOUNTS_KEY, []);
accounts = accounts.map(a => {
  if (a.balances) return a;
  const bal = { MOP: 0, HKD: 0, CNY: 0 };
  if (a.currency && a.balance != null) bal[a.currency] = Number(a.balance);
  return { id: a.id, name: a.name, type: a.type, balances: bal, note: a.note || '', linkedBankId: a.linkedBankId || '' };
});
saveJSON(ACCOUNTS_KEY, accounts);

let liabilities = loadJSON(LIABILITIES_KEY, []);
let mpfData = loadJSON(MPF_KEY, { accounts: [] });
if (!mpfData.accounts) mpfData = { accounts: [] };

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let currentType = 'expense';
let currentPage = 'monthly';
let filters = { type: '', category: '', account: '', dateFrom: '', dateTo: '' };
let expandedAccountId = null;

// ========== HTML Bar List ==========
function renderBarList(container, items) {
  // items: [{ label, value, color? }]
  container.innerHTML = '';
  if (!items.length) return;
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1);
  items.forEach((item, idx) => {
    const pct = (Math.abs(item.value) / max) * 100;
    const share = items.reduce((s, i) => s + Math.abs(i.value), 0);
    const sharePct = share ? ((Math.abs(item.value) / share) * 100).toFixed(1) : 0;
    const color = item.color || BAR_COLORS[idx % BAR_COLORS.length];
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-row-top">
        <span class="bar-label">${item.label}</span>
        <span class="bar-val">MOP ${formatMoney(item.value)}（${sharePct}%）</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
    container.appendChild(row);
  });
}

function renderDualMonthBars(container, monthsInc, monthsExp) {
  container.innerHTML = '';
  const max = Math.max(...monthsInc, ...monthsExp, 1);
  const labels = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  for (let m = 0; m < 12; m++) {
    if (monthsInc[m] === 0 && monthsExp[m] === 0) continue;
    const row = document.createElement('div');
    row.className = 'bar-row';
    const incW = (monthsInc[m] / max) * 100;
    const expW = (monthsExp[m] / max) * 100;
    row.innerHTML = `
      <div class="bar-row-top">
        <span class="bar-label">${labels[m]}</span>
        <span class="bar-val"><span style="color:#10b981">+${formatMoney(monthsInc[m])}</span> / <span style="color:#ef4444">−${formatMoney(monthsExp[m])}</span></span>
      </div>
      <div class="bar-dual">
        <div class="bar-track" style="flex:1"><div class="bar-fill" style="width:${incW}%;background:#10b981"></div></div>
        <div class="bar-track" style="flex:1"><div class="bar-fill" style="width:${expW}%;background:#ef4444"></div></div>
      </div>`;
    container.appendChild(row);
  }
  if (!container.children.length) {
    container.innerHTML = '<div class="empty-hint">本年尚無紀錄</div>';
  }
}

// ========== Init ==========
function init() {
  const dateEl = $('#date');
  if (dateEl) dateEl.valueAsDate = new Date();

  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  $('#btn-add').addEventListener('click', openAddModal);
  $('#btn-close-modal').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  $('#btn-prev-month').addEventListener('click', () => changeMonth(-1));
  $('#btn-next-month').addEventListener('click', () => changeMonth(1));
  $('#record-form').addEventListener('submit', handleRecordSubmit);
  $('#category').addEventListener('change', onCategoryChange);
  $$('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.dataset.type;
    });
  });
  $('#modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') closeModal(); });

  // Filter - bind once
  $('#btn-toggle-filter').addEventListener('click', () => {
    $('#filter-panel').classList.toggle('hidden');
  });
  $('#btn-filter-apply').addEventListener('click', () => {
    filters.type = $('#filter-type').value;
    filters.category = $('#filter-category').value;
    filters.account = $('#filter-account').value;
    filters.dateFrom = $('#filter-date-from').value;
    filters.dateTo = $('#filter-date-to').value;
    renderMonthRecords();
  });
  $('#btn-filter-reset').addEventListener('click', () => {
    filters = { type: '', category: '', account: '', dateFrom: '', dateTo: '' };
    $('#filter-type').value = '';
    $('#filter-category').value = '';
    $('#filter-account').value = '';
    $('#filter-date-from').value = '';
    $('#filter-date-to').value = '';
    renderMonthRecords();
  });

  $('#btn-prev-year').addEventListener('click', () => { currentYear--; renderYearly(); });
  $('#btn-next-year').addEventListener('click', () => { currentYear++; renderYearly(); });

  $('#btn-add-account').addEventListener('click', openAddAccountModal);
  $('#btn-close-account-modal').addEventListener('click', closeAccountModal);
  $('#btn-cancel-account').addEventListener('click', closeAccountModal);
  $('#account-form').addEventListener('submit', handleAccountSubmit);
  $('#account-type').addEventListener('change', onAccountTypeChange);
  $('#account-modal-overlay').addEventListener('click', e => { if (e.target.id === 'account-modal-overlay') closeAccountModal(); });

  $('#btn-repay').addEventListener('click', openRepayModal);
  $('#btn-close-repay').addEventListener('click', closeRepayModal);
  $('#btn-cancel-repay').addEventListener('click', closeRepayModal);
  $('#repay-form').addEventListener('submit', handleRepaySubmit);
  $('#repay-modal-overlay').addEventListener('click', e => { if (e.target.id === 'repay-modal-overlay') closeRepayModal(); });

  $('#btn-add-liability').addEventListener('click', openAddLiabilityModal);
  $('#btn-close-liability-modal').addEventListener('click', closeLiabilityModal);
  $('#btn-cancel-liability').addEventListener('click', closeLiabilityModal);
  $('#liability-form').addEventListener('submit', handleLiabilitySubmit);
  $('#liability-modal-overlay').addEventListener('click', e => { if (e.target.id === 'liability-modal-overlay') closeLiabilityModal(); });

  // MPF - ensure buttons work
  const btnMpf = $('#btn-add-mpf-account');
  if (btnMpf) btnMpf.addEventListener('click', openAddMpfAccountModal);
  $('#btn-close-mpf-account').addEventListener('click', closeMpfAccountModal);
  $('#btn-cancel-mpf-account').addEventListener('click', closeMpfAccountModal);
  $('#mpf-account-form').addEventListener('submit', handleMpfAccountSubmit);
  $('#mpf-account-modal-overlay').addEventListener('click', e => { if (e.target.id === 'mpf-account-modal-overlay') closeMpfAccountModal(); });
  $('#btn-close-mpf-change').addEventListener('click', closeMpfChangeModal);
  $('#btn-cancel-mpf-change').addEventListener('click', closeMpfChangeModal);
  $('#mpf-change-form').addEventListener('submit', handleMpfChangeSubmit);
  $('#mpf-change-modal-overlay').addEventListener('click', e => { if (e.target.id === 'mpf-change-modal-overlay') closeMpfChangeModal(); });

  $('#btn-rates').addEventListener('click', openRatesModal);
  $('#btn-close-rates').addEventListener('click', closeRatesModal);
  $('#btn-reset-rates').addEventListener('click', resetRates);
  $('#rates-form').addEventListener('submit', handleRatesSubmit);
  $('#rates-modal-overlay').addEventListener('click', e => { if (e.target.id === 'rates-modal-overlay') closeRatesModal(); });

  switchPage('monthly');
}

function switchPage(page) {
  currentPage = page;
  $$('.page').forEach(p => p.classList.remove('active'));
  const pageEl = $(`#page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.page-only').forEach(btn => {
    const show = btn.dataset.page === page;
    btn.classList.toggle('hidden', !show);
  });
  if (page === 'monthly') renderMonthly();
  else if (page === 'yearly') renderYearly();
  else if (page === 'accounts') renderAccounts();
  else if (page === 'mpf') renderMpf();
  else if (page === 'assets') renderAssets();
}

// ========== Monthly ==========
function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  else if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  filters = { type: '', category: '', account: '', dateFrom: '', dateTo: '' };
  const ft = $('#filter-type'); if (ft) ft.value = '';
  const fc = $('#filter-category'); if (fc) fc.value = '';
  const fa = $('#filter-account'); if (fa) fa.value = '';
  const fd1 = $('#filter-date-from'); if (fd1) fd1.value = '';
  const fd2 = $('#filter-date-to'); if (fd2) fd2.value = '';
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

function getFilteredMonthRecords() {
  return getMonthRecords().filter(r => {
    if (filters.type && r.type !== filters.type) return false;
    if (filters.category && r.category !== filters.category) return false;
    if (filters.account && r.accountId !== filters.account) return false;
    if (filters.dateFrom && r.date < filters.dateFrom) return false;
    if (filters.dateTo && r.date > filters.dateTo) return false;
    return true;
  });
}

function populateFilterOptions() {
  const monthRecs = getMonthRecords();
  const cats = [...new Set(monthRecs.map(r => r.category).filter(Boolean))];
  const catSel = $('#filter-category');
  if (!catSel) return;
  const cur = filters.category;
  catSel.innerHTML = '<option value="">全部</option>';
  cats.forEach(c => {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = `${CATEGORY_ICONS[c] || ''} ${c}`;
    catSel.appendChild(o);
  });
  catSel.value = cur;

  const accSel = $('#filter-account');
  if (!accSel) return;
  const curA = filters.account;
  accSel.innerHTML = '<option value="">全部</option>';
  accounts.forEach(a => {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
    accSel.appendChild(o);
  });
  accSel.value = curA;
}

function renderMonthly() {
  $('#current-month-label').textContent = `${currentYear}年${currentMonth + 1}月`;
  const list = getMonthRecords();
  let income = 0, expense = 0, repayment = 0;
  list.forEach(r => {
    const amt = toMOP(r.amount, r.currency);
    if (r.type === 'income') income += amt;
    else if (isRepayment(r)) repayment += amt;
    else expense += amt;
  });
  $('#summary-income').textContent = 'MOP ' + formatMoney(income);
  $('#summary-expense').textContent = 'MOP ' + formatMoney(expense);
  $('#summary-expense-all').textContent = 'MOP ' + formatMoney(expense + repayment);
  $('#summary-balance').textContent = 'MOP ' + formatMoney(income - expense - repayment);
  populateFilterOptions();
  renderMonthBars();
  renderMonthRecords();
}

function renderMonthBars() {
  const list = getMonthRecords().filter(r => r.type === 'expense' && !isRepayment(r));
  const container = $('#categoryBars');
  const noData = $('#no-chart-data');
  if (!list.length) {
    container.innerHTML = '';
    noData.style.display = 'block';
    return;
  }
  noData.style.display = 'none';
  const byCat = {};
  list.forEach(r => {
    const c = r.category || '其他';
    byCat[c] = (byCat[c] || 0) + toMOP(r.amount, r.currency);
  });
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  renderBarList(container, sorted.map(([c, v]) => ({
    label: `${CATEGORY_ICONS[c] || '🏷️'} ${c}`,
    value: v
  })));
}

function renderMonthRecords() {
  const list = getFilteredMonthRecords();
  const el = $('#records-list');
  el.innerHTML = '';
  if (!list.length) {
    $('#no-records').style.display = 'block';
    $('#no-records').textContent = getMonthRecords().length ? '沒有符合篩選的紀錄' : '本月尚無紀錄，點擊上方按鈕新增';
    return;
  }
  $('#no-records').style.display = 'none';
  list.forEach(r => {
    const icon = CATEGORY_ICONS[r.category] || '🏷️';
    const acc = accounts.find(a => a.id === r.accountId);
    const accName = acc ? acc.name : '';
    const sign = r.type === 'income' ? '+' : '−';
    const item = document.createElement('div');
    item.className = 'record-item';
    item.innerHTML = `
      <div class="record-left">
        <div class="record-category">${icon} ${escapeHtml(r.category)}</div>
        <div class="record-meta">${r.date}${accName ? ' · ' + escapeHtml(accName) : ''}${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
      </div>
      <div class="record-right">
        <div class="record-amount ${r.type}">${sign} ${formatMoney(Number(r.amount))}</div>
        <div class="record-currency">${r.currency}</div>
        <div class="record-actions">
          <button type="button" class="edit" data-id="${r.id}">編輯</button>
          <button type="button" class="delete" data-id="${r.id}">刪除</button>
        </div>
      </div>`;
    el.appendChild(item);
  });
  el.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditModal(btn.dataset.id); });
  });
  el.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteRecord(btn.dataset.id); });
  });
}

// ========== Yearly ==========
function getYearRecords() {
  return records.filter(r => new Date(r.date).getFullYear() === currentYear);
}

function renderYearly() {
  $('#current-year-label').textContent = `${currentYear}年`;
  const yearRecs = getYearRecords();
  let income = 0, expense = 0, repayment = 0;
  const monthsInc = Array(12).fill(0);
  const monthsExp = Array(12).fill(0);
  yearRecs.forEach(r => {
    const m = new Date(r.date).getMonth();
    const amt = toMOP(r.amount, r.currency);
    if (r.type === 'income') { income += amt; monthsInc[m] += amt; }
    else if (isRepayment(r)) { repayment += amt; monthsExp[m] += amt; }
    else { expense += amt; monthsExp[m] += amt; }
  });
  $('#year-income').textContent = 'MOP ' + formatMoney(income);
  $('#year-expense').textContent = 'MOP ' + formatMoney(expense);
  $('#year-balance').textContent = 'MOP ' + formatMoney(income - expense - repayment);

  renderDualMonthBars($('#yearlyMonthBars'), monthsInc, monthsExp);

  const expRecs = yearRecs.filter(r => r.type === 'expense' && !isRepayment(r));
  const noData = $('#no-year-cat-data');
  if (!expRecs.length) {
    $('#yearlyCategoryBars').innerHTML = '';
    noData.style.display = 'block';
  } else {
    noData.style.display = 'none';
    const byCat = {};
    expRecs.forEach(r => {
      const c = r.category || '其他';
      byCat[c] = (byCat[c] || 0) + toMOP(r.amount, r.currency);
    });
    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    renderBarList($('#yearlyCategoryBars'), sorted.map(([c, v]) => ({
      label: `${CATEGORY_ICONS[c] || '🏷️'} ${c}`,
      value: v
    })));
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
  return a.type === '信用卡' ? -total : total;
}

function getAccountLedger(accountId) {
  return records
    .filter(r => r.accountId === accountId || r.repayToId === accountId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
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

    group.forEach(a => {
      const b = a.balances || { MOP: 0, HKD: 0, CNY: 0 };
      const isDebt = a.type === '信用卡';
      const linked = a.linkedBankId ? accounts.find(x => x.id === a.linkedBankId) : null;
      const expanded = expandedAccountId === a.id;
      const ledger = expanded ? getAccountLedger(a.id) : [];

      let ledgerHtml = '';
      if (expanded) {
        if (!ledger.length) {
          ledgerHtml = '<div class="ledger-empty">此戶口尚無流水紀錄</div>';
        } else {
          ledgerHtml = ledger.slice(0, 50).map(r => {
            const sign = r.type === 'income' ? '+' : '−';
            const cls = r.type === 'income' ? 'income' : 'expense';
            return `<div class="ledger-item">
              <span>${r.date} · ${escapeHtml(r.category)}${r.note ? ' · ' + escapeHtml(r.note) : ''}</span>
              <span class="record-amount ${cls}">${sign}${formatMoney(r.amount)} ${r.currency}</span>
            </div>`;
          }).join('');
        }
      }

      const item = document.createElement('div');
      item.className = 'account-item' + (expanded ? ' expanded' : '');
      item.dataset.id = a.id;
      item.innerHTML = `
        <div class="account-item-header">
          <div>
            <div class="account-name">${escapeHtml(a.name)}</div>
            ${linked ? `<div class="account-meta">扣帳銀行：${escapeHtml(linked.name)}</div>` : ''}
            ${a.note ? `<div class="account-meta">${escapeHtml(a.note)}</div>` : ''}
            ${isDebt ? '<div class="account-meta" style="color:#ef4444">正數＝欠款</div>' : ''}
          </div>
          <div class="account-actions">
            <button type="button" class="edit" data-id="${a.id}">編輯</button>
            <button type="button" class="delete" data-id="${a.id}">刪除</button>
          </div>
        </div>
        <table class="account-currency-table">
          <tr class="${!(b.MOP) ? 'zero' : ''}"><td>MOP</td><td>${formatMoney(b.MOP || 0)}</td></tr>
          <tr class="${!(b.HKD) ? 'zero' : ''}"><td>HKD</td><td>${formatMoney(b.HKD || 0)}</td></tr>
          <tr class="${!(b.CNY) ? 'zero' : ''}"><td>CNY</td><td>${formatMoney(b.CNY || 0)}</td></tr>
        </table>
        <div class="account-ledger">
          <div class="ledger-title">流水帳（點戶口可收合）</div>
          ${ledgerHtml}
        </div>`;
      section.appendChild(item);
    });
    container.appendChild(section);
  });

  // expand on card click (not on buttons)
  container.querySelectorAll('.account-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const id = item.dataset.id;
      expandedAccountId = expandedAccountId === id ? null : id;
      renderAccounts();
    });
  });
  container.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditAccountModal(btn.dataset.id); });
  });
  container.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      accounts = accounts.filter(a => a.id !== btn.dataset.id);
      saveJSON(ACCOUNTS_KEY, accounts);
      if (expandedAccountId === btn.dataset.id) expandedAccountId = null;
      renderAccounts();
    });
  });
}

function populateAccountSelect(selectedId = '') {
  const sel = $('#record-account');
  sel.innerHTML = '<option value="">請選擇戶口</option>';
  TYPE_ORDER.forEach(type => {
    const group = accounts.filter(a => a.type === type);
    if (!group.length) return;
    const og = document.createElement('optgroup');
    og.label = `${ACCOUNT_TYPE_ICONS[type] || ''} ${type}`;
    group.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name;
      if (a.id === selectedId) opt.selected = true;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
}

function populateRepayToSelect(selectedId = '') {
  const sel = $('#repay-to-account');
  sel.innerHTML = '<option value="">請選擇信用卡</option>';
  accounts.filter(a => a.type === '信用卡').forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    if (a.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function populateLinkedBankSelect(selectedId = '') {
  const sel = $('#linked-bank');
  sel.innerHTML = '<option value="">請選擇銀行戶口</option>';
  accounts.filter(a => a.type === '銀行').forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    if (a.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function onAccountTypeChange() {
  const isWallet = $('#account-type').value === '電子錢包';
  $('#linked-bank-row').classList.toggle('hidden', !isWallet);
  if (isWallet) populateLinkedBankSelect();
}

function onCategoryChange() {
  const isRepay = $('#category').value === '信用卡還款';
  $('#repay-to-row').classList.toggle('hidden', !isRepay);
  $('#repay-to-account').required = isRepay;
  if (isRepay) populateRepayToSelect();

  if ($('#category').value === '其他') {
    $('#custom-category-row').classList.remove('hidden');
    $('#custom-category').required = true;
  } else {
    $('#custom-category-row').classList.add('hidden');
    $('#custom-category').required = false;
    $('#custom-category').value = '';
  }
}

// ========== Assets ==========
function renderAssets() {
  let gross = 0, creditDebt = 0;
  accounts.forEach(a => {
    const mop = balancesToMOP(a.balances);
    if (a.type === '信用卡') creditDebt += mop;
    else gross += mop;
  });
  let mpfTotal = 0;
  (mpfData.accounts || []).forEach(a => { mpfTotal += Number(a.balance) || 0; });
  gross += mpfTotal;

  let otherLiab = 0;
  liabilities.forEach(l => { otherLiab += balancesToMOP(l.balances); });
  const totalLiab = creditDebt + otherLiab;

  $('#assets-gross').textContent = 'MOP ' + formatMoney(gross);
  $('#assets-liability').textContent = 'MOP ' + formatMoney(totalLiab);
  $('#assets-net').textContent = 'MOP ' + formatMoney(gross - totalLiab);

  const assetAccounts = accounts.filter(a => a.type !== '信用卡' && balancesToMOP(a.balances) > 0);
  const chartItems = [
    ...assetAccounts.map(a => ({ label: `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`, value: balancesToMOP(a.balances) })),
    ...(mpfTotal > 0 ? [{ label: '🏛️ 強積金', value: mpfTotal }] : [])
  ].sort((a, b) => b.value - a.value);

  if (!chartItems.length) {
    $('#no-assets-data').style.display = 'block';
    $('#assetsAccountBars').innerHTML = '';
    $('#assetsCurrencyBars').innerHTML = '';
  } else {
    $('#no-assets-data').style.display = 'none';
    renderBarList($('#assetsAccountBars'), chartItems);
    const byCur = { MOP: 0, HKD: 0, CNY: 0 };
    assetAccounts.forEach(a => {
      byCur.MOP += Number(a.balances.MOP || 0);
      byCur.HKD += toMOP(a.balances.HKD || 0, 'HKD');
      byCur.CNY += toMOP(a.balances.CNY || 0, 'CNY');
    });
    byCur.MOP += mpfTotal;
    renderBarList($('#assetsCurrencyBars'),
      Object.entries(byCur).filter(([, v]) => v > 0).map(([c, v]) => ({ label: c, value: v }))
    );
  }

  const detailEl = $('#assets-detail-list');
  detailEl.innerHTML = '';
  chartItems.forEach(i => {
    const pct = gross ? ((i.value / gross) * 100).toFixed(1) : 0;
    const item = document.createElement('div');
    item.className = 'account-item';
    item.style.cursor = 'default';
    item.innerHTML = `
      <div class="account-item-header">
        <div class="account-name">${escapeHtml(i.label)}</div>
        <div style="text-align:right;font-weight:700;color:var(--primary)">MOP ${formatMoney(i.value)}
          <div class="account-meta">${pct}%</div>
        </div>
      </div>`;
    detailEl.appendChild(item);
  });

  const liabEl = $('#liabilities-list');
  liabEl.innerHTML = '';
  const ccList = accounts.filter(a => a.type === '信用卡' && balancesToMOP(a.balances) > 0);
  if (!liabilities.length && !ccList.length) {
    $('#no-liabilities').style.display = 'block';
  } else {
    $('#no-liabilities').style.display = 'none';
    ccList.forEach(a => {
      const b = a.balances || {};
      const item = document.createElement('div');
      item.className = 'account-item';
      item.style.cursor = 'default';
      item.innerHTML = `
        <div class="account-item-header">
          <div class="account-name">💳 ${escapeHtml(a.name)}</div>
          <div class="account-meta">信用卡欠款</div>
        </div>
        <table class="account-currency-table">
          <tr><td>MOP</td><td>${formatMoney(b.MOP || 0)}</td></tr>
          <tr><td>HKD</td><td>${formatMoney(b.HKD || 0)}</td></tr>
          <tr><td>CNY</td><td>${formatMoney(b.CNY || 0)}</td></tr>
        </table>`;
      liabEl.appendChild(item);
    });
    liabilities.forEach(l => {
      const b = l.balances || {};
      const item = document.createElement('div');
      item.className = 'account-item';
      item.style.cursor = 'default';
      item.innerHTML = `
        <div class="account-item-header">
          <div class="account-name">${escapeHtml(l.name)}</div>
          <div class="account-actions">
            <button type="button" class="edit" data-id="${l.id}">編輯</button>
            <button type="button" class="delete" data-id="${l.id}">刪除</button>
          </div>
        </div>
        <table class="account-currency-table">
          <tr><td>MOP</td><td>${formatMoney(b.MOP || 0)}</td></tr>
          <tr><td>HKD</td><td>${formatMoney(b.HKD || 0)}</td></tr>
          <tr><td>CNY</td><td>${formatMoney(b.CNY || 0)}</td></tr>
        </table>`;
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
  let total = 0;
  (mpfData.accounts || []).forEach(a => { total += Number(a.balance) || 0; });
  $('#mpf-total').textContent = 'MOP ' + formatMoney(total);

  const el = $('#mpf-accounts-list');
  el.innerHTML = '';
  if (!mpfData.accounts?.length) {
    $('#no-mpf-accounts').style.display = 'block';
    return;
  }
  $('#no-mpf-accounts').style.display = 'none';

  mpfData.accounts.forEach(acc => {
    const card = document.createElement('div');
    card.className = 'mpf-card';
    const changes = [...(acc.changes || [])].sort((a, b) => b.month.localeCompare(a.month));
    let changesHtml = changes.length
      ? changes.map(c => {
          const up = Number(c.amount) >= 0;
          return `<div class="mpf-change-item">
            <span>${c.month}${c.note ? ' · ' + escapeHtml(c.note) : ''}</span>
            <span>
              <span class="${up ? 'mpf-change-up' : 'mpf-change-down'}">${up ? '+' : ''}${formatMoney(c.amount)}</span>
              <button type="button" class="edit-change" data-acc="${acc.id}" data-id="${c.id}" style="margin-left:6px;font-size:0.7rem;padding:1px 6px;border:1px solid #e5e7eb;border-radius:4px;background:#f9fafb;cursor:pointer">編輯</button>
              <button type="button" class="del-change" data-acc="${acc.id}" data-id="${c.id}" style="font-size:0.7rem;padding:1px 6px;border:1px solid #e5e7eb;border-radius:4px;background:#f9fafb;cursor:pointer;color:#ef4444">刪</button>
            </span>
          </div>`;
        }).join('')
      : '<div class="ledger-empty">尚無月漲跌紀錄</div>';

    card.innerHTML = `
      <div class="mpf-card-header">
        <div>
          <div class="mpf-card-name">${escapeHtml(acc.name)}</div>
          ${acc.note ? `<div class="account-meta">${escapeHtml(acc.note)}</div>` : ''}
        </div>
        <div class="mpf-card-balance">MOP ${formatMoney(acc.balance)}</div>
      </div>
      <div class="account-actions" style="margin-bottom:8px">
        <button type="button" class="add-change" data-id="${acc.id}">＋ 月漲跌</button>
        <button type="button" class="edit-acc" data-id="${acc.id}">編輯</button>
        <button type="button" class="delete del-acc" data-id="${acc.id}">刪除</button>
      </div>
      <div class="mpf-changes">
        <div class="mpf-changes-title">月漲跌紀錄</div>
        ${changesHtml}
      </div>`;
    el.appendChild(card);
  });

  el.querySelectorAll('.add-change').forEach(btn => {
    btn.addEventListener('click', () => openAddMpfChangeModal(btn.dataset.id));
  });
  el.querySelectorAll('.edit-acc').forEach(btn => {
    btn.addEventListener('click', () => openEditMpfAccountModal(btn.dataset.id));
  });
  el.querySelectorAll('.del-acc').forEach(btn => {
    btn.addEventListener('click', () => {
      mpfData.accounts = mpfData.accounts.filter(a => a.id !== btn.dataset.id);
      saveJSON(MPF_KEY, mpfData);
      renderMpf();
    });
  });
  el.querySelectorAll('.edit-change').forEach(btn => {
    btn.addEventListener('click', () => openEditMpfChangeModal(btn.dataset.acc, btn.dataset.id));
  });
  el.querySelectorAll('.del-change').forEach(btn => {
    btn.addEventListener('click', () => {
      const acc = mpfData.accounts.find(a => a.id === btn.dataset.acc);
      if (!acc) return;
      const ch = (acc.changes || []).find(c => c.id === btn.dataset.id);
      if (ch) {
        acc.balance = Number(acc.balance) - Number(ch.amount);
        acc.changes = acc.changes.filter(c => c.id !== btn.dataset.id);
        saveJSON(MPF_KEY, mpfData);
        renderMpf();
      }
    });
  });
}

// ========== Balance effects ==========
function applyBalanceDelta(accountId, currency, delta) {
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return;
  if (!acc.balances) acc.balances = { MOP: 0, HKD: 0, CNY: 0 };
  acc.balances[currency] = Number(acc.balances[currency] || 0) + delta;
  saveJSON(ACCOUNTS_KEY, accounts);
}

function reverseRecordEffect(rec) {
  if (!rec || !rec.accountId) return;
  const acc = accounts.find(a => a.id === rec.accountId);
  if (!acc) return;
  const amt = Number(rec.amount);

  if (isRepayment(rec)) {
    // reverse: add back to source, add back debt on card
    applyBalanceDelta(rec.accountId, rec.currency, amt);
    if (rec.repayToId) applyBalanceDelta(rec.repayToId, rec.currency, amt);
    return;
  }

  if (acc.type === '信用卡') {
    // reverse expense (debt+): decrease debt; reverse income: increase debt
    applyBalanceDelta(rec.accountId, rec.currency, rec.type === 'expense' ? -amt : amt);
  } else if (acc.type === '電子錢包' && rec.type === 'expense' && acc.linkedBankId) {
    // reverse: add back wallet + linked bank
    applyBalanceDelta(rec.accountId, rec.currency, amt);
    applyBalanceDelta(acc.linkedBankId, rec.currency, amt);
  } else {
    applyBalanceDelta(rec.accountId, rec.currency, rec.type === 'expense' ? amt : -amt);
  }
}

function applyRecordEffect(rec) {
  if (!rec || !rec.accountId) return;
  const acc = accounts.find(a => a.id === rec.accountId);
  if (!acc) return;
  const amt = Number(rec.amount);

  if (isRepayment(rec)) {
    // source decreases, credit card debt decreases
    applyBalanceDelta(rec.accountId, rec.currency, -amt);
    if (rec.repayToId) applyBalanceDelta(rec.repayToId, rec.currency, -amt);
    return;
  }

  if (acc.type === '信用卡') {
    applyBalanceDelta(rec.accountId, rec.currency, rec.type === 'expense' ? amt : -amt);
  } else if (acc.type === '電子錢包' && rec.type === 'expense' && acc.linkedBankId) {
    // B: deduct wallet AND linked bank
    applyBalanceDelta(rec.accountId, rec.currency, -amt);
    applyBalanceDelta(acc.linkedBankId, rec.currency, -amt);
  } else {
    applyBalanceDelta(rec.accountId, rec.currency, rec.type === 'expense' ? -amt : amt);
  }
}

// ========== Record Modal ==========
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
  $('#repay-to-row').classList.add('hidden');
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
  const tb = $(`.type-btn[data-type="${r.type}"]`);
  if (tb) tb.classList.add('active');

  const preset = Array.from($('#category').options).map(o => o.value);
  if (preset.includes(r.category)) {
    $('#category').value = r.category;
    $('#custom-category-row').classList.add('hidden');
  } else {
    $('#category').value = '其他';
    $('#custom-category-row').classList.remove('hidden');
    $('#custom-category').value = r.category;
  }
  onCategoryChange();
  populateAccountSelect(r.accountId || '');
  if (isRepayment(r) && r.repayToId) populateRepayToSelect(r.repayToId);
  $('#modal-overlay').classList.remove('hidden');
}

function closeModal() { $('#modal-overlay').classList.add('hidden'); }

function handleRecordSubmit(e) {
  e.preventDefault();
  const accountId = $('#record-account').value;
  if (!accountId) { alert('請選擇戶口'); return; }

  let category = $('#category').value;
  if (category === '其他') {
    category = $('#custom-category').value.trim();
    if (!category) { alert('請輸入自訂分類名稱'); return; }
  }

  let repayToId = '';
  if (category === '信用卡還款') {
    repayToId = $('#repay-to-account').value;
    if (!repayToId) { alert('請選擇還款至哪個信用卡'); return; }
  }

  const old = records.find(r => r.id === $('#edit-id').value);
  const record = {
    id: $('#edit-id').value || String(Date.now()),
    type: currentType,
    amount: Number($('#amount').value),
    currency: $('#currency').value,
    date: $('#date').value,
    category,
    accountId,
    repayToId: repayToId || undefined,
    note: $('#note').value.trim(),
    createdAt: old?.createdAt || new Date().toISOString()
  };

  if (old) reverseRecordEffect(old);
  applyRecordEffect(record);

  const idx = records.findIndex(r => r.id === record.id);
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  saveJSON(STORAGE_KEY, records);
  closeModal();
  if (currentPage === 'monthly') renderMonthly();
  else if (currentPage === 'yearly') renderYearly();
  else if (currentPage === 'accounts') renderAccounts();
}

function deleteRecord(id) {
  const rec = records.find(r => r.id === id);
  if (rec) reverseRecordEffect(rec);
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
  $('#linked-bank-row').classList.add('hidden');
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
  onAccountTypeChange();
  if (a.type === '電子錢包') populateLinkedBankSelect(a.linkedBankId || '');
  $('#account-modal-overlay').classList.remove('hidden');
}
function closeAccountModal() { $('#account-modal-overlay').classList.add('hidden'); }
function handleAccountSubmit(e) {
  e.preventDefault();
  const type = $('#account-type').value;
  const acc = {
    id: $('#account-edit-id').value || String(Date.now()),
    name: $('#account-name').value.trim(),
    type,
    balances: {
      MOP: Number($('#acc-bal-mop').value) || 0,
      HKD: Number($('#acc-bal-hkd').value) || 0,
      CNY: Number($('#acc-bal-cny').value) || 0
    },
    linkedBankId: type === '電子錢包' ? ($('#linked-bank').value || '') : '',
    note: $('#account-note').value.trim()
  };
  if (type === '電子錢包' && !acc.linkedBankId) {
    alert('請選擇扣帳銀行戶口');
    return;
  }
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
    o.textContent = a.name;
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
  const record = {
    id: String(Date.now()),
    type: 'expense',
    amount: Number($('#repay-amount').value),
    currency: $('#repay-currency').value,
    date: $('#repay-date').value,
    category: '信用卡還款',
    accountId: $('#repay-from').value,
    repayToId: $('#repay-to').value,
    note: $('#repay-note').value.trim() || '信用卡還款',
    createdAt: new Date().toISOString()
  };
  applyRecordEffect(record);
  records.push(record);
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

// ========== MPF ==========
function openAddMpfAccountModal() {
  $('#mpf-account-modal-title').textContent = '新增強積金戶口';
  $('#mpf-account-form').reset();
  $('#mpf-account-edit-id').value = '';
  $('#mpf-account-balance').value = 0;
  $('#mpf-account-modal-overlay').classList.remove('hidden');
}
function openEditMpfAccountModal(id) {
  const a = mpfData.accounts.find(x => x.id === id);
  if (!a) return;
  $('#mpf-account-modal-title').textContent = '編輯強積金戶口';
  $('#mpf-account-edit-id').value = a.id;
  $('#mpf-account-name').value = a.name;
  $('#mpf-account-balance').value = a.balance;
  $('#mpf-account-note').value = a.note || '';
  $('#mpf-account-modal-overlay').classList.remove('hidden');
}
function closeMpfAccountModal() { $('#mpf-account-modal-overlay').classList.add('hidden'); }
function handleMpfAccountSubmit(e) {
  e.preventDefault();
  const id = $('#mpf-account-edit-id').value || String(Date.now());
  const existing = mpfData.accounts.find(a => a.id === id);
  const acc = {
    id,
    name: $('#mpf-account-name').value.trim(),
    balance: Number($('#mpf-account-balance').value) || 0,
    note: $('#mpf-account-note').value.trim(),
    changes: existing?.changes || []
  };
  const idx = mpfData.accounts.findIndex(a => a.id === id);
  if (idx >= 0) mpfData.accounts[idx] = acc;
  else mpfData.accounts.push(acc);
  saveJSON(MPF_KEY, mpfData);
  closeMpfAccountModal();
  renderMpf();
}

function openAddMpfChangeModal(accountId) {
  $('#mpf-change-modal-title').textContent = '新增月漲跌';
  $('#mpf-change-form').reset();
  $('#mpf-change-edit-id').value = '';
  $('#mpf-change-account-id').value = accountId;
  const now = new Date();
  $('#mpf-change-month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('#mpf-change-modal-overlay').classList.remove('hidden');
}
function openEditMpfChangeModal(accountId, changeId) {
  const acc = mpfData.accounts.find(a => a.id === accountId);
  const ch = acc?.changes?.find(c => c.id === changeId);
  if (!ch) return;
  $('#mpf-change-modal-title').textContent = '編輯月漲跌';
  $('#mpf-change-edit-id').value = ch.id;
  $('#mpf-change-account-id').value = accountId;
  $('#mpf-change-month').value = ch.month;
  $('#mpf-change-amount').value = ch.amount;
  $('#mpf-change-note').value = ch.note || '';
  $('#mpf-change-modal-overlay').classList.remove('hidden');
}
function closeMpfChangeModal() { $('#mpf-change-modal-overlay').classList.add('hidden'); }
function handleMpfChangeSubmit(e) {
  e.preventDefault();
  const accountId = $('#mpf-change-account-id').value;
  const acc = mpfData.accounts.find(a => a.id === accountId);
  if (!acc) return;
  if (!acc.changes) acc.changes = [];
  const editId = $('#mpf-change-edit-id').value;
  const amount = Number($('#mpf-change-amount').value);
  const month = $('#mpf-change-month').value;
  const note = $('#mpf-change-note').value.trim();
  if (editId) {
    const old = acc.changes.find(c => c.id === editId);
    if (old) {
      acc.balance = Number(acc.balance) - Number(old.amount) + amount;
      old.month = month; old.amount = amount; old.note = note;
    }
  } else {
    acc.changes.push({ id: String(Date.now()), month, amount, note });
    acc.balance = Number(acc.balance) + amount;
  }
  saveJSON(MPF_KEY, mpfData);
  closeMpfChangeModal();
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

init();
