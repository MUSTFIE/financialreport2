const STORAGE_KEY = 'accounting_records_v2';
const RATES_KEY = 'accounting_rates_v2';
const ACCOUNTS_KEY = 'accounting_accounts_v2';
const LIABILITIES_KEY = 'accounting_liabilities_v1';
const MPF_KEY = 'accounting_mpf_v3';
const CUSTOM_CAT_SUM_KEY = 'accounting_custom_cat_sum_v1';
const INTEREST_FLOOR = '2026-08-08';

const DEFAULT_RATES = { MOP: 1, HKD: 1.03, CNY: 1.196, HKD_CNY: 0.86 };
const CATEGORIES = [
  { name: '餐飲', icon: '🍔' }, { name: '交通', icon: '🚗' }, { name: '購物', icon: '🛍️' },
  { name: '娛樂', icon: '🎮' }, { name: '居住', icon: '🏠' }, { name: '母嬰', icon: '👶' },
  { name: '保險費', icon: '🛡️' }, { name: '學貸', icon: '🎓' }, { name: '生活費', icon: '💵' },
  { name: '薪資', icon: '💼' }, { name: '電話費', icon: '📞' }, { name: '電費', icon: '⚡' },
  { name: '淘寶', icon: '🛒' }, { name: '上網費', icon: '🌐' }, { name: '醫療', icon: '🏥' },
  { name: '信用卡還款', icon: '💳' }, { name: '戶口調整', icon: '⚖️' }, { name: '其他', icon: '🏷️' },
  { name: '代墊', icon: '🧾' }, { name: '收回應收', icon: '📥' }, { name: '利息收入', icon: '💹' }
];
const CATEGORY_ICONS = Object.fromEntries(CATEGORIES.map(c => [c.name, c.icon]));
const ACCOUNT_TYPE_ICONS = {
  '現金':'💵','銀行':'🏦','信用卡':'💳','電子錢包':'📱','投資':'📈','其他':'🏷️','應收帳款':'🧾'
};
const TYPE_ORDER = ['銀行','信用卡','電子錢包','現金','投資','應收帳款','其他'];
const BAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#64748b','#0ea5e9'];

// ========== Firebase 設定（請填入你的專案） ==========
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAr_4P8sHYFDH2ZIW-04kvN8baHaePxxQ8',
  authDomain: 'financial-record-e41e9.firebaseapp.com',
  databaseURL: 'https://financial-record-e41e9-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'financial-record-e41e9',
  storageBucket: 'financial-record-e41e9.firebasestorage.app',
  messagingSenderId: '1022975525620',
  appId: '1:1022975525620:web:c918f787d51aae670214a1'
};
let firebaseReady = false;
let auth = null;
let db = null;
let currentUser = null;
let syncing = false;

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function formatMoney(n) {
  return Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function money(currency, n) {
  return `${currency} ${formatMoney(n)}`;
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
function saveJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
  scheduleCloudSync();
}

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
function isTransfer(r) {
  return r && (r.type === 'transfer' || r.category === '內部轉帳');
}
/** 信用卡消費（非還款）：記在信用卡戶口的支出 */
function isCreditCardPurchase(r) {
  if (!r || r.type !== 'expense' || isRepayment(r) || isTransfer(r)) return false;
  if (isAdvance(r) || isCollectReceivable(r)) return false;
  const acc = accounts.find(a => a.id === r.accountId);
  return !!(acc && acc.type === '信用卡');
}
/** 代墊紀錄（含自費與應收拆分） */
function isAdvance(r) {
  return !!(r && (r.isAdvance || r.category === '代墊'));
}
/** 收回應收 */
function isCollectReceivable(r) {
  return !!(r && (r.isCollectReceivable || r.category === '收回應收'));
}
/** 日息／利息：只進戶口流水，不計入收入 */
function isInterest(r) {
  return !!(r && (r.isInterest || r.category === '利息收入'));
}
/** 不計入消費支出／收入的特殊紀錄 */
function isNonOperating(r) {
  return isTransfer(r) || isAdvance(r) || isCollectReceivable(r) || isInterest(r);
}
function getReceivableAccount() {
  return accounts.find(a => a.type === '應收帳款') || null;
}
/** 各幣互轉（經 MOP） */
function convertAmount(amount, fromCur, toCur) {
  const mop = toMOP(amount, fromCur);
  if (toCur === 'MOP') return mop;
  if (toCur === 'HKD') return rates.HKD ? mop / rates.HKD : mop;
  if (toCur === 'CNY') return rates.CNY ? mop / rates.CNY : mop;
  return mop;
}
function currencyChipsHtml(balances) {
  const b = balances || {};
  const parts = [];
  ['MOP', 'HKD', 'CNY'].forEach(c => {
    const v = Number(b[c]) || 0;
    if (v === 0) return;
    parts.push(`<div class="currency-chip"><span class="cc-code">${c}</span><span class="cc-val">${formatMoney(v)}</span></div>`);
  });
  if (!parts.length) {
    parts.push(`<div class="currency-chip"><span class="cc-code">—</span><span class="cc-val">0</span></div>`);
  }
  return `<div class="currency-chips">${parts.join('')}</div>`;
}

let records = loadJSON(STORAGE_KEY, []);
// 去掉舊資料中的 undefined（JSON 再 parse 會自動去掉）
try { records = JSON.parse(JSON.stringify(records)); } catch (_) {}
let accounts = loadJSON(ACCOUNTS_KEY, []);
accounts = accounts.map(a => {
  if (a.balances) {
    return {
      ...a,
      linkedBankId: a.linkedBankId || '',
      interestRate: a.interestRate || 0,
      interestPeriod: a.interestPeriod || 'yearly',
      lastInterestDate: a.lastInterestDate || ''
    };
  }
  const bal = { MOP: 0, HKD: 0, CNY: 0 };
  if (a.currency && a.balance != null) bal[a.currency] = Number(a.balance);
  return {
    id: a.id, name: a.name, type: a.type, balances: bal, note: a.note || '',
    linkedBankId: '', interestRate: 0, interestPeriod: 'yearly', lastInterestDate: ''
  };
});
saveJSON(ACCOUNTS_KEY, accounts);
let liabilities = loadJSON(LIABILITIES_KEY, []);
let mpfData = loadJSON(MPF_KEY, { accounts: [] });
if (!mpfData.accounts) mpfData = { accounts: [] };

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let currentType = 'expense';
let currentPage = 'monthly';
let filters = { type: '', category: '', account: '', currency: '' };
let expandedAccountId = null;
let ledgerFilterMonth = ''; // '' = 全部, 'YYYY-MM'
let expandedMpfId = null;
let expandedAssetGroup = null; // e.g. '銀行'
let mpfViewYear = new Date().getFullYear();
let mpfViewMonth = new Date().getMonth(); // 0-11

function renderBarList(container, items) {
  container.innerHTML = '';
  if (!items.length) return;
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1);
  const sum = items.reduce((s, i) => s + Math.abs(i.value), 0) || 1;
  items.forEach((item, idx) => {
    const pct = (Math.abs(item.value) / max) * 100;
    const share = ((Math.abs(item.value) / sum) * 100).toFixed(1);
    const color = item.color || BAR_COLORS[idx % BAR_COLORS.length];
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-row-top">
        <span class="bar-label">${item.label}</span>
        <span class="bar-val">MOP ${formatMoney(item.value)}（${share}%）</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
    container.appendChild(row);
  });
}

function initFirebase() {
  if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.databaseURL) {
    console.info('Firebase 未設定，使用本機模式');
    return;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();
    firebaseReady = true;
    auth.onAuthStateChanged(async user => {
      currentUser = user;
      updateAuthButton();
      if (user) {
        await onUserSignedIn(user);
      }
    });
  } catch (err) {
    console.error('Firebase 初始化失敗', err);
    firebaseReady = false;
  }
}

function updateAuthButton() {
  const btn = $('#btn-auth');
  if (!btn) return;
  if (!firebaseReady) {
    btn.title = '未設定 Firebase';
    btn.textContent = '👤';
    btn.classList.remove('logged-in');
    return;
  }
  if (currentUser) {
    btn.title = currentUser.email || '已登入';
    btn.textContent = '☁️';
    btn.classList.add('logged-in');
  } else {
    btn.title = 'Google 登入';
    btn.textContent = '👤';
    btn.classList.remove('logged-in');
  }
}

async function onUserSignedIn(user) {
  const snap = await db.ref('users/' + user.uid).once('value');
  const cloud = snap.val();
  if (!cloud || (!cloud.records && !cloud.accounts)) {
    // 雲端無資料 → 詢問是否上傳本機
    if (records.length || accounts.length) {
      const ok = confirm('偵測到本機有資料，雲端為空。是否上傳本機資料到雲端？');
      if (ok) await pushAllToCloud();
    }
  } else {
    // 雲端有資料 → 下載覆蓋本機快取
    if (cloud.records) records = cloud.records;
    if (cloud.accounts) accounts = cloud.accounts;
    if (cloud.liabilities) liabilities = cloud.liabilities;
    if (cloud.mpfData) mpfData = cloud.mpfData;
    if (cloud.rates) rates = { ...DEFAULT_RATES, ...cloud.rates, MOP: 1 };
    persistLocal();
    switchPage(currentPage);
  }
}

function persistLocal() {
  saveJSON(STORAGE_KEY, records);
  saveJSON(ACCOUNTS_KEY, accounts);
  saveJSON(LIABILITIES_KEY, liabilities);
  saveJSON(MPF_KEY, mpfData);
  saveRatesObj(rates);
}

/** Firebase RTDB 不接受 undefined，用 JSON 去掉後再寫入 */
function stripUndefined(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function pushAllToCloud() {
  if (!firebaseReady || !currentUser) return;
  syncing = true;
  try {
    const payload = stripUndefined({
      records,
      accounts,
      liabilities,
      mpfData,
      rates,
      updatedAt: Date.now()
    });
    await db.ref('users/' + currentUser.uid).set(payload);
  } catch (err) {
    console.error(err);
    alert('同步到雲端失敗：' + err.message);
  }
  syncing = false;
}

function scheduleCloudSync() {
  if (!firebaseReady || !currentUser || syncing) return;
  clearTimeout(scheduleCloudSync._t);
  scheduleCloudSync._t = setTimeout(() => pushAllToCloud(), 800);
}

async function handleAuthClick() {
  if (!firebaseReady) {
    alert('請先在 app.js 填入 FIREBASE_CONFIG（Firebase 專案設定）');
    return;
  }
  if (currentUser) {
    if (confirm('確定要登出？')) await auth.signOut();
  } else {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await auth.signInWithPopup(provider);
    } catch (err) {
      alert('登入失敗：' + err.message);
    }
  }
}

function init() {
  if ($('#date')) $('#date').valueAsDate = new Date();
  initFirebase();
  updateAuthButton();

  $$('.nav-btn').forEach(btn => btn.addEventListener('click', () => switchPage(btn.dataset.page)));
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
  $('#btn-auth').addEventListener('click', handleAuthClick);
  $('#btn-mpf-prev-month').addEventListener('click', () => {
    mpfViewMonth--;
    if (mpfViewMonth < 0) { mpfViewMonth = 11; mpfViewYear--; }
    renderMpf();
  });
  $('#btn-mpf-next-month').addEventListener('click', () => {
    mpfViewMonth++;
    if (mpfViewMonth > 11) { mpfViewMonth = 0; mpfViewYear++; }
    renderMpf();
  });

  $('#btn-toggle-filter').addEventListener('click', () => $('#filter-panel').classList.toggle('hidden'));
  $('#btn-filter-apply').addEventListener('click', () => {
    filters.type = $('#filter-type').value;
    filters.category = $('#filter-category').value;
    filters.account = $('#filter-account').value;
    filters.currency = $('#filter-currency')?.value || '';
    renderMonthRecords();
  });
  $('#btn-filter-reset').addEventListener('click', () => {
    filters = { type: '', category: '', account: '', currency: '' };
    $('#filter-type').value = '';
    $('#filter-category').value = '';
    $('#filter-account').value = '';
    if ($('#filter-currency')) $('#filter-currency').value = '';
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

  $('#btn-transfer').addEventListener('click', openTransferModal);
  $('#btn-close-transfer').addEventListener('click', closeTransferModal);
  $('#btn-cancel-transfer').addEventListener('click', closeTransferModal);
  $('#transfer-form').addEventListener('submit', handleTransferSubmit);
  $('#transfer-modal-overlay').addEventListener('click', e => { if (e.target.id === 'transfer-modal-overlay') closeTransferModal(); });
  ['transfer-from-amount','transfer-from-currency','transfer-to-currency'].forEach(id => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', autoFillTransferToAmount);
    if (el) el.addEventListener('change', autoFillTransferToAmount);
  });

  $('#btn-add-liability').addEventListener('click', openAddLiabilityModal);
  $('#btn-close-liability-modal').addEventListener('click', closeLiabilityModal);
  $('#btn-cancel-liability').addEventListener('click', closeLiabilityModal);
  $('#liability-form').addEventListener('submit', handleLiabilitySubmit);
  $('#liability-modal-overlay').addEventListener('click', e => { if (e.target.id === 'liability-modal-overlay') closeLiabilityModal(); });

  $('#btn-add-mpf-account').addEventListener('click', openAddMpfAccountModal);
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

  // export
  $('#btn-export').addEventListener('click', () => $('#export-modal-overlay').classList.remove('hidden'));
  $('#btn-close-export').addEventListener('click', () => $('#export-modal-overlay').classList.add('hidden'));
  $('#export-modal-overlay').addEventListener('click', e => { if (e.target.id === 'export-modal-overlay') $('#export-modal-overlay').classList.add('hidden'); });
  $('#btn-csv-records').addEventListener('click', exportRecordsCSV);
  $('#btn-csv-accounts').addEventListener('click', exportAccountsCSV);
  $('#btn-csv-mpf').addEventListener('click', exportMpfCSV);
  $('#btn-backup-export').addEventListener('click', exportBackup);
  $('#btn-backup-import').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', importBackup);

  // 代墊 / 收回應收
  const btnAdv = $('#btn-advance');
  if (btnAdv) btnAdv.addEventListener('click', openAdvanceModal);
  const btnCloseAdv = $('#btn-close-advance');
  if (btnCloseAdv) btnCloseAdv.addEventListener('click', closeAdvanceModal);
  const btnCancelAdv = $('#btn-cancel-advance');
  if (btnCancelAdv) btnCancelAdv.addEventListener('click', closeAdvanceModal);
  const advForm = $('#advance-form');
  if (advForm) advForm.addEventListener('submit', handleAdvanceSubmit);
  const advOverlay = $('#advance-modal-overlay');
  if (advOverlay) advOverlay.addEventListener('click', e => { if (e.target.id === 'advance-modal-overlay') closeAdvanceModal(); });
  ['advance-total', 'advance-self'].forEach(id => {
    const el = $('#' + id);
    if (el) el.addEventListener('input', () => {
      const total = Number($('#advance-total')?.value) || 0;
      const self = Number($('#advance-self')?.value) || 0;
      if ($('#advance-recv')) $('#advance-recv').value = Math.max(0, Math.round((total - self) * 100) / 100);
    });
  });

  const btnCol = $('#btn-collect');
  if (btnCol) btnCol.addEventListener('click', openCollectModal);
  const btnCloseCol = $('#btn-close-collect');
  if (btnCloseCol) btnCloseCol.addEventListener('click', closeCollectModal);
  const btnCancelCol = $('#btn-cancel-collect');
  if (btnCancelCol) btnCancelCol.addEventListener('click', closeCollectModal);
  const colForm = $('#collect-form');
  if (colForm) colForm.addEventListener('submit', handleCollectSubmit);
  const colOverlay = $('#collect-modal-overlay');
  if (colOverlay) colOverlay.addEventListener('click', e => { if (e.target.id === 'collect-modal-overlay') closeCollectModal(); });

  accrueDailyInterest();
  startInterestAutoAccrue();
  switchPage('monthly');
}

function switchPage(page) {
  currentPage = page;
  $$('.page').forEach(p => p.classList.remove('active'));
  const el = $(`#page-${page}`);
  if (el) el.classList.add('active');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.page-only').forEach(btn => btn.classList.toggle('hidden', btn.dataset.page !== page));
  if (page === 'monthly') renderMonthly();
  else if (page === 'yearly') renderYearly();
  else if (page === 'accounts') renderAccounts();
  else if (page === 'mpf') renderMpf();
  else if (page === 'assets') renderAssets();
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  else if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  filters = { type: '', category: '', account: '', currency: '' };
  ['filter-type','filter-category','filter-account','filter-currency'].forEach(id => { const e = $('#'+id); if (e) e.value = ''; });
  renderMonthly();
}

function getMonthRecords() {
  return records.filter(r => {
    const d = new Date(r.date);
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  }).sort((a, b) => new Date(b.date) - new Date(a.date) || String(b.id).localeCompare(String(a.id)));
}

function getFilteredMonthRecords() {
  return getMonthRecords().filter(r => {
    if (isInterest(r)) return false; // 日息只顯示在戶口流水
    if (filters.type && r.type !== filters.type) return false;
    if (filters.category && r.category !== filters.category) return false;
    if (filters.account && r.accountId !== filters.account && r.displayAccountId !== filters.account) return false;
    if (filters.currency && r.currency !== filters.currency) return false;
    return true;
  });
}

function populateFilterOptions() {
  const monthRecs = getMonthRecords();
  const cats = [...new Set(monthRecs.map(r => r.category).filter(Boolean))];
  const catSel = $('#filter-category');
  if (catSel) {
    catSel.innerHTML = '<option value="">全部</option>';
    cats.forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = `${CATEGORY_ICONS[c] || ''} ${c}`;
      catSel.appendChild(o);
    });
    catSel.value = filters.category;
  }
  const accSel = $('#filter-account');
  if (accSel) {
    accSel.innerHTML = '<option value="">全部</option>';
    accounts.filter(a => a.type !== '電子錢包').forEach(a => {
      const o = document.createElement('option');
      o.value = a.id; o.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
      accSel.appendChild(o);
    });
    accSel.value = filters.account;
  }
}

function renderMonthly() {
  $('#current-month-label').textContent = `${currentYear}年${currentMonth + 1}月`;
  // 消費支出：含刷卡、不含還款／代墊／收回
  // 實際支出：一般支出（非刷卡）+ 還款
  // 結餘：收入 − 消費支出
  let income = 0, consumption = 0, ccPurchase = 0, repayment = 0;
  getMonthRecords().forEach(r => {
    if (isTransfer(r) || isCollectReceivable(r) || isInterest(r)) return;
    // 代墊：只有「自費」計入消費；應收部分不計
    if (isAdvance(r)) {
      const selfAmt = toMOP(r.selfAmount != null ? r.selfAmount : 0, r.currency);
      if (selfAmt > 0) {
        consumption += selfAmt;
        const payAcc = accounts.find(a => a.id === r.accountId);
        if (payAcc && payAcc.type === '信用卡') ccPurchase += selfAmt;
      }
      return;
    }
    const amt = toMOP(r.amount, r.currency);
    if (r.type === 'income') income += amt;
    else if (isRepayment(r)) repayment += amt;
    else if (r.type === 'expense') {
      consumption += amt;
      if (isCreditCardPurchase(r)) ccPurchase += amt;
    }
  });
  const actual = consumption - ccPurchase + repayment;
  $('#summary-income').textContent = money('MOP', income);
  $('#summary-expense').textContent = money('MOP', consumption);
  $('#summary-expense-all').textContent = money('MOP', actual);
  $('#summary-balance').textContent = money('MOP', income - consumption);
  populateFilterOptions();
  renderMonthBars();
  renderCustomCatSum();
  renderMonthRecords();
}

function renderMonthBars() {
  const byCat = {};
  getMonthRecords().forEach(r => {
    if (isRepayment(r) || isCollectReceivable(r) || isInterest(r) || isTransfer(r)) return;
    if (isAdvance(r)) {
      const selfAmt = Number(r.selfAmount) || 0;
      if (selfAmt <= 0) return;
      const c = r.category || '其他';
      byCat[c] = (byCat[c] || 0) + toMOP(selfAmt, r.currency);
      return;
    }
    if (r.type !== 'expense') return;
    const c = r.category || '其他';
    byCat[c] = (byCat[c] || 0) + toMOP(r.amount, r.currency);
  });
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) {
    $('#categoryBars').innerHTML = '';
    $('#no-chart-data').style.display = 'block';
    return;
  }
  $('#no-chart-data').style.display = 'none';
  renderBarList($('#categoryBars'), sorted.map(([c, v]) => ({ label: `${CATEGORY_ICONS[c] || '🏷️'} ${c}`, value: v })));
}

function renderMonthRecords() {
  const list = getFilteredMonthRecords();
  const el = $('#records-list');
  el.innerHTML = '';
  if (!list.length) {
    $('#no-records').style.display = 'block';
    $('#no-records').textContent = getMonthRecords().length ? '沒有符合篩選的紀錄' : '本月尚無紀錄';
    return;
  }
  $('#no-records').style.display = 'none';
  list.forEach(r => {
    const icon = isTransfer(r) ? '⇄' : (CATEGORY_ICONS[r.category] || '🏷️');
    const acc = accounts.find(a => a.id === (r.displayAccountId || r.accountId));
    const toAcc = r.toAccountId ? accounts.find(a => a.id === r.toAccountId) : null;
    const wallet = r.viaWalletId ? accounts.find(a => a.id === r.viaWalletId) : null;
    const sign = isTransfer(r) || isCollectReceivable(r) ? '⇄' : (r.type === 'income' ? '+' : '−');
    let amtText;
    if (isTransfer(r) || isCollectReceivable(r)) {
      amtText = `−${money(r.currency, r.amount)} → +${money(r.toCurrency || r.currency, r.toAmount ?? r.amount)}`;
    } else if (isAdvance(r)) {
      const selfP = r.selfAmount != null ? `自費 ${money(r.currency, r.selfAmount)}` : '';
      const recvP = r.recvAmount ? `應收 ${money(r.currency, r.recvAmount)}` : '';
      amtText = `−${money(r.currency, r.amount)}` + (selfP || recvP ? `（${[selfP, recvP].filter(Boolean).join(' · ')}）` : '');
    } else {
      amtText = `${sign} ${money(r.currency, r.amount)}`;
    }
    const metaExtra = (isTransfer(r) || isCollectReceivable(r))
      ? ` · ${acc ? escapeHtml(acc.name) : ''} → ${toAcc ? escapeHtml(toAcc.name) : ''}`
      : `${acc ? ' · ' + escapeHtml(acc.name) : ''}${wallet ? ' · via ' + escapeHtml(wallet.name) : ''}`;
    const item = document.createElement('div');
    item.className = 'record-item';
    item.innerHTML = `
      <div>
        <div class="record-category">${icon} ${escapeHtml(r.category)}</div>
        <div class="record-meta">${r.date}${metaExtra}${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
      </div>
      <div class="record-right">
        <div class="record-amount">${amtText}</div>
        <div class="record-actions">
          <button type="button" class="edit" data-id="${r.id}">編輯</button>
          <button type="button" class="delete" data-id="${r.id}">刪除</button>
        </div>
      </div>`;
    el.appendChild(item);
  });
  el.querySelectorAll('.edit').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const rec = records.find(x => x.id === btn.dataset.id);
    if (rec && isAdvance(rec)) { alert('代墊紀錄請刪除後重新新增'); return; }
    if (rec && isCollectReceivable(rec)) { alert('收回紀錄請刪除後重新新增'); return; }
    if (rec && isTransfer(rec)) openTransferModal(rec.id);
    else openEditModal(btn.dataset.id);
  }));
  el.querySelectorAll('.delete').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); deleteRecord(btn.dataset.id); }));
}

function getYearRecords() {
  return records.filter(r => new Date(r.date).getFullYear() === currentYear);
}

function renderYearly() {
  $('#current-year-label').textContent = `${currentYear}年`;
  const yearRecs = getYearRecords();
  let income = 0, consumption = 0;
  const monthsInc = Array(12).fill(0);
  const monthsExp = Array(12).fill(0); // 各月消費支出（含刷卡、不含還款）
  yearRecs.forEach(r => {
    if (isTransfer(r) || isCollectReceivable(r) || isInterest(r)) return;
    const m = new Date(r.date).getMonth();
    if (isAdvance(r)) {
      const selfAmt = toMOP(r.selfAmount != null ? r.selfAmount : 0, r.currency);
      if (selfAmt > 0) { consumption += selfAmt; monthsExp[m] += selfAmt; }
      return;
    }
    const amt = toMOP(r.amount, r.currency);
    if (r.type === 'income') { income += amt; monthsInc[m] += amt; }
    else if (isRepayment(r)) { /* 還款不計入消費支出 */ }
    else if (r.type === 'expense') { consumption += amt; monthsExp[m] += amt; }
  });
  $('#year-income').textContent = money('MOP', income);
  $('#year-expense').textContent = money('MOP', consumption);
  $('#year-balance').textContent = money('MOP', income - consumption);

  const byCat = {};
  yearRecs.forEach(r => {
    if (isRepayment(r) || isCollectReceivable(r) || isInterest(r) || isTransfer(r)) return;
    if (isAdvance(r)) {
      const selfAmt = Number(r.selfAmount) || 0;
      if (selfAmt <= 0) return;
      const c = r.category || '其他';
      byCat[c] = (byCat[c] || 0) + toMOP(selfAmt, r.currency);
      return;
    }
    if (r.type !== 'expense') return;
    const c = r.category || '其他';
    byCat[c] = (byCat[c] || 0) + toMOP(r.amount, r.currency);
  });
  if (!Object.keys(byCat).length) {
    $('#yearlyCategoryBars').innerHTML = '';
    $('#no-year-cat-data').style.display = 'block';
  } else {
    $('#no-year-cat-data').style.display = 'none';
    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    renderBarList($('#yearlyCategoryBars'), sorted.map(([c, v]) => ({ label: `${CATEGORY_ICONS[c] || '🏷️'} ${c}`, value: v })));
  }

  const listEl = $('#yearly-months-list');
  listEl.innerHTML = '';
  for (let m = 11; m >= 0; m--) {
    if (!monthsInc[m] && !monthsExp[m]) continue;
    const bal = monthsInc[m] - monthsExp[m];
    const balCls = bal > 0 ? 'positive' : bal < 0 ? 'negative' : '';
    const bar = document.createElement('div');
    bar.className = 'month-bar month-bar-list';
    bar.innerHTML = `
      <span class="month-name">${currentYear}年${m + 1}月</span>
      <span class="month-stats-inline">
        <span class="inc">＋${money('MOP', monthsInc[m])}</span>
        <span class="exp">−${money('MOP', monthsExp[m])}</span>
        <span class="bal ${balCls}">結餘 ${money('MOP', bal)}</span>
      </span>`;
    listEl.appendChild(bar);
  }
  if (!listEl.children.length) listEl.innerHTML = '<div class="empty-hint">本年尚無紀錄</div>';
}

/** 計入淨額的戶口（不含電子錢包、信用卡） */
function netAssetAccounts() {
  return accounts.filter(a => a.type !== '電子錢包' && a.type !== '信用卡' && a.type !== '應收帳款');
}

function getAccountLedger(accountId, monthKey = '') {
  return records
    .filter(r => {
      const hit =
        r.accountId === accountId ||
        r.displayAccountId === accountId ||
        r.repayToId === accountId ||
        r.toAccountId === accountId;
      if (!hit) return false;
      if (monthKey && String(r.date || '').slice(0, 7) !== monthKey) return false;
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function ledgerMonthOptions(accountId, isWallet) {
  const all = isWallet
    ? records.filter(r => r.viaWalletId === accountId)
    : records.filter(r =>
        r.accountId === accountId ||
        r.displayAccountId === accountId ||
        r.repayToId === accountId ||
        r.toAccountId === accountId
      );
  const months = [...new Set(all.map(r => String(r.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  return months;
}

/** 在指定戶口視角下，轉帳／收支的正負與顯示金額 */
function ledgerAmountView(r, accountId) {
  if (isTransfer(r)) {
    if (r.toAccountId === accountId) {
      return { sign: '+', cls: 'income', amount: r.toAmount ?? r.amount, currency: r.toCurrency || r.currency };
    }
    // 轉出
    return { sign: '−', cls: 'expense', amount: r.amount, currency: r.currency };
  }
  if (r.type === 'income') return { sign: '+', cls: 'income', amount: r.amount, currency: r.currency };
  return { sign: '−', cls: 'expense', amount: r.amount, currency: r.currency };
}

function renderAccounts() {
  const nets = { MOP: 0, HKD: 0, CNY: 0 };
  netAssetAccounts().forEach(a => {
    const b = a.balances || {};
    nets.MOP += Number(b.MOP) || 0;
    nets.HKD += Number(b.HKD) || 0;
    nets.CNY += Number(b.CNY) || 0;
  });
  $('#net-mop').textContent = money('MOP', nets.MOP);
  $('#net-hkd').textContent = money('HKD', nets.HKD);
  $('#net-cny').textContent = money('CNY', nets.CNY);
  $('#net-total-mop').textContent = money('MOP', toMOP(nets.MOP, 'MOP') + toMOP(nets.HKD, 'HKD') + toMOP(nets.CNY, 'CNY'));

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
      const isWallet = a.type === '電子錢包';
      const linked = isWallet && a.linkedBankId ? accounts.find(x => x.id === a.linkedBankId) : null;
      const expanded = expandedAccountId === a.id;
      let ledger = [];
      let monthOpts = [];
      if (expanded) {
        monthOpts = ledgerMonthOptions(a.id, isWallet);
        if (isWallet) {
          ledger = records
            .filter(r => {
              if (r.viaWalletId !== a.id) return false;
              if (ledgerFilterMonth && String(r.date || '').slice(0, 7) !== ledgerFilterMonth) return false;
              return true;
            })
            .sort((x, y) => new Date(y.date) - new Date(x.date));
        } else {
          ledger = getAccountLedger(a.id, ledgerFilterMonth);
        }
      }
      let ledgerHtml = '';
      if (expanded) {
        const monthSelect = `<div class="ledger-filter">
          <label>月份</label>
          <select class="ledger-month-select" data-acc="${a.id}">
            <option value="">全部</option>
            ${monthOpts.map(m => `<option value="${m}" ${m === ledgerFilterMonth ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>`;
        if (!ledger.length) {
          ledgerHtml = monthSelect + '<div class="ledger-empty">此條件下尚無流水紀錄</div>';
        } else {
          ledgerHtml = monthSelect + ledger.slice(0, 80).map(r => {
            const view = ledgerAmountView(r, a.id);
            const via = r.viaWalletId ? accounts.find(w => w.id === r.viaWalletId) : null;
            const other = isTransfer(r)
              ? (r.toAccountId === a.id
                  ? accounts.find(x => x.id === r.accountId)
                  : accounts.find(x => x.id === r.toAccountId))
              : null;
            const extra = isTransfer(r) && other
              ? ` · ${r.toAccountId === a.id ? '自' : '至'} ${escapeHtml(other.name)}`
              : (via && !isWallet ? ' · ' + escapeHtml(via.name) : '');
            return `<div class="ledger-item">
              <span>${r.date} · ${escapeHtml(r.category)}${extra}${r.note ? ' · ' + escapeHtml(r.note) : ''}</span>
              <span class="record-amount ${view.cls}">${view.sign}${money(view.currency, view.amount)}</span>
            </div>`;
          }).join('');
        }
      }
      const rateInfo = (a.type === '銀行' && a.interestRate > 0)
        ? `<div class="account-meta">年利率 ${a.interestRate}% · ${a.interestPeriod === 'daily' ? '日息' : a.interestPeriod === 'monthly' ? '月息' : '年息'}</div>`
        : '';
      const chips = isWallet
        ? `<div class="account-meta" style="margin-top:8px">扣帳銀行：${linked ? escapeHtml(linked.name) : '未設定'}（不計入淨額）</div>`
        : currencyChipsHtml(b);
      const item = document.createElement('div');
      item.className = 'account-item' + (expanded ? ' expanded' : '');
      item.dataset.id = a.id;
      item.innerHTML = `
        <div class="account-item-header">
          <div>
            <div class="account-name">${escapeHtml(a.name)}</div>
            ${rateInfo}
            ${a.note ? `<div class="account-meta">${escapeHtml(a.note)}</div>` : ''}
          </div>
          <div class="account-actions">
            <button type="button" class="edit" data-id="${a.id}">編輯</button>
            <button type="button" class="delete" data-id="${a.id}">刪除</button>
          </div>
        </div>
        ${chips}
        <div class="account-ledger">
          <div class="ledger-title">流水帳（再點一次收合）</div>
          ${ledgerHtml}
        </div>`;
      section.appendChild(item);
    });
    container.appendChild(section);
  });

  container.querySelectorAll('.account-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('select')) return;
      const id = item.dataset.id;
      if (expandedAccountId === id) {
        expandedAccountId = null;
        ledgerFilterMonth = '';
      } else {
        expandedAccountId = id;
        ledgerFilterMonth = '';
      }
      renderAccounts();
    });
  });
  container.querySelectorAll('.ledger-month-select').forEach(sel => {
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', e => {
      e.stopPropagation();
      ledgerFilterMonth = sel.value;
      expandedAccountId = sel.dataset.acc;
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
  // 排序：電子支付 → 信用卡 → 銀行 → 現金（不顯示投資／其他）
  let firstWalletId = '';
  ['電子錢包', '信用卡', '銀行', '現金'].forEach(type => {
    const group = accounts.filter(a => a.type === type);
    if (!group.length) return;
    if (type === '電子錢包' && !firstWalletId) firstWalletId = group[0].id;
    const og = document.createElement('optgroup');
    const labelMap = { '電子錢包': '電子支付', '信用卡': '信用卡', '銀行': '銀行戶口', '現金': '現金' };
    og.label = `${ACCOUNT_TYPE_ICONS[type] || ''} ${labelMap[type] || type}`;
    group.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id; opt.textContent = a.name;
      if (a.id === selectedId) opt.selected = true;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
  // 新增時未指定：預設第一個電子支付
  if (!selectedId && firstWalletId) sel.value = firstWalletId;
}

function populateRepayToSelect(selectedId = '') {
  const sel = $('#repay-to-account');
  sel.innerHTML = '<option value="">請選擇信用卡</option>';
  accounts.filter(a => a.type === '信用卡').forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id; opt.textContent = a.name;
    if (a.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function populateLinkedBankSelect(selectedId = '') {
  const sel = $('#linked-bank');
  sel.innerHTML = '<option value="">請選擇銀行戶口</option>';
  accounts.filter(a => a.type === '銀行').forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id; opt.textContent = a.name;
    if (a.id === selectedId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function onAccountTypeChange() {
  const type = $('#account-type').value;
  const isWallet = type === '電子錢包';
  const isBank = type === '銀行';
  $('#linked-bank-row').classList.toggle('hidden', !isWallet);
  $('#balances-row').classList.toggle('hidden', isWallet);
  $('#interest-row').classList.toggle('hidden', !isBank);
  if (isWallet) populateLinkedBankSelect();
}

function onCategoryChange() {
  const cat = $('#category').value;
  const isRepay = cat === '信用卡還款';
  $('#repay-to-row').classList.toggle('hidden', !isRepay);
  $('#repay-to-account').required = isRepay;
  if (isRepay) populateRepayToSelect();
  if (cat === '其他') {
    $('#custom-category-row').classList.remove('hidden');
    $('#custom-category').required = true;
  } else {
    $('#custom-category-row').classList.add('hidden');
    $('#custom-category').required = false;
    $('#custom-category').value = '';
  }
}

function applyBalanceDelta(accountId, currency, delta) {
  const acc = accounts.find(a => a.id === accountId);
  if (!acc || acc.type === '電子錢包') return;
  if (!acc.balances) acc.balances = { MOP: 0, HKD: 0, CNY: 0 };
  acc.balances[currency] = Number(acc.balances[currency] || 0) + delta;
  saveJSON(ACCOUNTS_KEY, accounts);
}

function resolveEffectAccount(rec) {
  const acc = accounts.find(a => a.id === rec.accountId);
  if (acc && acc.type === '電子錢包' && acc.linkedBankId) {
    return { effectId: acc.linkedBankId, viaWalletId: acc.id };
  }
  return { effectId: rec.accountId, viaWalletId: null };
}

function reverseRecordEffect(rec) {
  if (!rec) return;
  if (isInterest(rec)) {
    // 日息：扣回已加的利息
    applyBalanceDelta(rec.accountId, rec.currency, -(Number(rec.amount) || 0));
    return;
  }
  if (isAdvance(rec)) {
    const total = Number(rec.amount) || 0;
    const recvAmt = Number(rec.recvAmount) || 0;
    const payAcc = accounts.find(a => a.id === rec.accountId);
    // 還原支付戶口：信用卡減少欠款；銀行／現金加回餘額
    if (payAcc && payAcc.type === '信用卡') {
      applyBalanceDelta(rec.accountId, rec.currency, -total);
    } else {
      applyBalanceDelta(rec.accountId, rec.currency, total);
    }
    if (rec.recvAccountId && recvAmt) applyBalanceDelta(rec.recvAccountId, rec.currency, -recvAmt);
    return;
  }
  if (isTransfer(rec) || isCollectReceivable(rec)) {
    applyBalanceDelta(rec.accountId, rec.currency, Number(rec.amount));
    applyBalanceDelta(rec.toAccountId, rec.toCurrency || rec.currency, -(Number(rec.toAmount ?? rec.amount)));
    return;
  }
  const amt = Number(rec.amount);
  if (isRepayment(rec)) {
    applyBalanceDelta(rec.accountId, rec.currency, amt);
    if (rec.repayToId) applyBalanceDelta(rec.repayToId, rec.currency, amt);
    return;
  }
  const { effectId } = resolveEffectAccount(rec);
  const acc = accounts.find(a => a.id === effectId);
  if (!acc) return;
  if (acc.type === '信用卡') applyBalanceDelta(effectId, rec.currency, rec.type === 'expense' ? -amt : amt);
  else applyBalanceDelta(effectId, rec.currency, rec.type === 'expense' ? amt : -amt);
}

function applyRecordEffect(rec) {
  if (!rec) return;
  if (isTransfer(rec)) {
    applyBalanceDelta(rec.accountId, rec.currency, -Number(rec.amount));
    applyBalanceDelta(rec.toAccountId, rec.toCurrency || rec.currency, Number(rec.toAmount ?? rec.amount));
    return;
  }
  const amt = Number(rec.amount);
  if (isRepayment(rec)) {
    applyBalanceDelta(rec.accountId, rec.currency, -amt);
    if (rec.repayToId) applyBalanceDelta(rec.repayToId, rec.currency, -amt);
    return;
  }
  const { effectId } = resolveEffectAccount(rec);
  const acc = accounts.find(a => a.id === effectId);
  if (!acc) return;
  if (acc.type === '信用卡') applyBalanceDelta(effectId, rec.currency, rec.type === 'expense' ? amt : -amt);
  else applyBalanceDelta(effectId, rec.currency, rec.type === 'expense' ? -amt : amt);
}

function openAddModal() {
  if (!accounts.length) { alert('請先新增戶口'); return; }
  $('#modal-title').textContent = '新增紀錄';
  $('#record-form').reset();
  $('#edit-id').value = '';
  $('#date').valueAsDate = new Date();
  currentType = 'expense';
  $$('.type-btn').forEach(b => b.classList.remove('active'));
  $('.type-btn[data-type="expense"]').classList.add('active');
  $('#category').value = '餐飲';
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

  const preset = CATEGORIES.map(c => c.name);
  if (preset.includes(r.category)) {
    $('#category').value = r.category;
    $('#custom-category-row').classList.add('hidden');
  } else {
    $('#category').value = '其他';
    $('#custom-category-row').classList.remove('hidden');
    $('#custom-category').value = r.category;
  }
  onCategoryChange();
  populateAccountSelect(r.viaWalletId || r.accountId || '');
  if (isRepayment(r) && r.repayToId) populateRepayToSelect(r.repayToId);
  $('#modal-overlay').classList.remove('hidden');
}

function closeModal() { $('#modal-overlay').classList.add('hidden'); }

function handleRecordSubmit(e) {
  e.preventDefault();
  const selectedId = $('#record-account').value;
  if (!selectedId) { alert('請選擇戶口'); return; }

  let category = $('#category').value;
  if (category === '其他') {
    category = $('#custom-category').value.trim();
    if (!category) { alert('請輸入自訂分類'); return; }
  }
  let repayToId = '';
  if (category === '信用卡還款') {
    repayToId = $('#repay-to-account').value;
    if (!repayToId) { alert('請選擇信用卡'); return; }
  }

  const selected = accounts.find(a => a.id === selectedId);
  let accountId = selectedId;
  let viaWalletId, displayAccountId;
  if (selected && selected.type === '電子錢包') {
    if (!selected.linkedBankId) { alert('此電子錢包未綁定銀行'); return; }
    viaWalletId = selected.id;
    accountId = selected.linkedBankId;
    displayAccountId = selected.linkedBankId;
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
    note: $('#note').value.trim(),
    createdAt: old?.createdAt || new Date().toISOString()
  };
  // 僅在有值時寫入，避免 Firebase 拒絕 undefined
  if (displayAccountId) record.displayAccountId = displayAccountId;
  if (viaWalletId) record.viaWalletId = viaWalletId;
  if (repayToId) record.repayToId = repayToId;

  if (old) reverseRecordEffect(old);
  applyRecordEffect(record);
  const idx = records.findIndex(r => r.id === record.id);
  if (idx >= 0) records[idx] = record; else records.push(record);
  // 清理本機既有紀錄中的 undefined 欄位
  records = stripUndefined(records);
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
  saveJSON(ACCOUNTS_KEY, accounts);
  switchPage(currentPage);
}

function openAddAccountModal() {
  $('#account-modal-title').textContent = '新增戶口';
  $('#account-form').reset();
  $('#account-edit-id').value = '';
  $('#acc-bal-mop').value = 0; $('#acc-bal-hkd').value = 0; $('#acc-bal-cny').value = 0;
  $('#acc-interest-rate').value = 0;
  $('#acc-interest-period').value = 'daily';
  $('#linked-bank-row').classList.add('hidden');
  $('#interest-row').classList.add('hidden');
  $('#balances-row').classList.remove('hidden');
  $('#adjust-row').classList.add('hidden');
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
  $('#acc-interest-rate').value = a.interestRate || 0;
  $('#acc-interest-period').value = a.interestPeriod || 'yearly';
  $('#account-note').value = a.note || '';
  onAccountTypeChange();
  if (a.type === '電子錢包') populateLinkedBankSelect(a.linkedBankId || '');
  $('#adjust-row').classList.remove('hidden');
  $('#adjust-action').value = '';
  $('#adjust-amount').value = '';
  $('#adjust-note').value = '';
  $('#account-modal-overlay').classList.remove('hidden');
}

function closeAccountModal() { $('#account-modal-overlay').classList.add('hidden'); }

function handleAccountSubmit(e) {
  e.preventDefault();
  const type = $('#account-type').value;
  const id = $('#account-edit-id').value || String(Date.now());
  const existing = accounts.find(a => a.id === id);
  const acc = {
    id, name: $('#account-name').value.trim(), type,
    balances: type === '電子錢包' ? { MOP: 0, HKD: 0, CNY: 0 } : {
      MOP: Number($('#acc-bal-mop').value) || 0,
      HKD: Number($('#acc-bal-hkd').value) || 0,
      CNY: Number($('#acc-bal-cny').value) || 0
    },
    linkedBankId: type === '電子錢包' ? ($('#linked-bank').value || '') : '',
    interestRate: type === '銀行' ? (Number($('#acc-interest-rate').value) || 0) : 0,
    interestPeriod: type === '銀行' ? ($('#acc-interest-period').value || 'yearly') : 'yearly',
    lastInterestDate: existing?.lastInterestDate || '',
    note: $('#account-note').value.trim()
  };
  if (type === '電子錢包' && !acc.linkedBankId) { alert('請選擇扣帳銀行戶口'); return; }
  if (type === '應收帳款') {
    const other = accounts.find(a => a.type === '應收帳款' && a.id !== id);
    if (other) { alert('只能有一個應收帳款總戶口'); return; }
  }

  const adjAction = $('#adjust-action').value;
  const adjAmt = Number($('#adjust-amount').value) || 0;
  const adjCur = $('#adjust-currency').value;
  const adjNote = $('#adjust-note').value.trim();
  if (existing && adjAction && adjAmt > 0 && type !== '電子錢包') {
    const delta = adjAction === 'increase' ? adjAmt : -adjAmt;
    acc.balances[adjCur] = Number(acc.balances[adjCur] || 0) + delta;
    records.push({
      id: String(Date.now()),
      type: adjAction === 'increase' ? 'income' : 'expense',
      amount: adjAmt, currency: adjCur,
      date: new Date().toISOString().slice(0, 10),
      category: '戶口調整', accountId: id,
      note: adjNote || (adjAction === 'increase' ? '增加餘額' : '減少餘額'),
      createdAt: new Date().toISOString()
    });
    saveJSON(STORAGE_KEY, records);
  }

  const idx = accounts.findIndex(a => a.id === id);
  if (idx >= 0) accounts[idx] = acc; else accounts.push(acc);
  saveJSON(ACCOUNTS_KEY, accounts);
  closeAccountModal();
  renderAccounts();
}

function openRepayModal() {
  const sources = accounts.filter(a => a.type !== '信用卡' && a.type !== '電子錢包');
  const cards = accounts.filter(a => a.type === '信用卡');
  if (!sources.length || !cards.length) { alert('需要一般戶口與信用卡'); return; }
  const fromSel = $('#repay-from'); const toSel = $('#repay-to');
  fromSel.innerHTML = ''; toSel.innerHTML = '';
  sources.forEach(a => { const o = document.createElement('option'); o.value = a.id; o.textContent = `${ACCOUNT_TYPE_ICONS[a.type]||''} ${a.name}`; fromSel.appendChild(o); });
  cards.forEach(a => { const o = document.createElement('option'); o.value = a.id; o.textContent = a.name; toSel.appendChild(o); });
  $('#repay-date').valueAsDate = new Date();
  $('#repay-amount').value = ''; $('#repay-note').value = '';
  $('#repay-modal-overlay').classList.remove('hidden');
}
function closeRepayModal() { $('#repay-modal-overlay').classList.add('hidden'); }
function handleRepaySubmit(e) {
  e.preventDefault();
  const record = {
    id: String(Date.now()), type: 'expense',
    amount: Number($('#repay-amount').value), currency: $('#repay-currency').value,
    date: $('#repay-date').value, category: '信用卡還款',
    accountId: $('#repay-from').value, repayToId: $('#repay-to').value,
    note: $('#repay-note').value.trim() || '信用卡還款',
    createdAt: new Date().toISOString()
  };
  applyRecordEffect(record);
  records.push(record);
  saveJSON(STORAGE_KEY, records);
  closeRepayModal();
  renderAccounts();
}

function nonCcAccounts() {
  return accounts.filter(a => a.type !== '信用卡' && a.type !== '電子錢包');
}
function autoFillTransferToAmount() {
  const fromAmt = Number($('#transfer-from-amount').value);
  if (!fromAmt) return;
  const fromCur = $('#transfer-from-currency').value;
  const toCur = $('#transfer-to-currency').value;
  const converted = convertAmount(fromAmt, fromCur, toCur);
  $('#transfer-to-amount').value = Math.round(converted * 100) / 100;
}
function openTransferModal(editId = '') {
  const list = nonCcAccounts();
  if (list.length < 2) { alert('至少需要兩個非信用卡／非電子錢包戶口才能轉帳'); return; }
  const fromSel = $('#transfer-from');
  const toSel = $('#transfer-to');
  fromSel.innerHTML = '';
  toSel.innerHTML = '';
  list.forEach(a => {
    const o1 = document.createElement('option');
    o1.value = a.id; o1.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
    fromSel.appendChild(o1);
    const o2 = document.createElement('option');
    o2.value = a.id; o2.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
    toSel.appendChild(o2);
  });
  const existing = editId ? records.find(r => r.id === editId) : null;
  $('#transfer-edit-id').value = existing ? existing.id : '';
  $('#transfer-modal-title').textContent = existing ? '編輯轉帳' : '內部轉帳';
  if (existing) {
    fromSel.value = existing.accountId;
    toSel.value = existing.toAccountId;
    $('#transfer-from-currency').value = existing.currency || 'MOP';
    $('#transfer-from-amount').value = existing.amount;
    $('#transfer-to-currency').value = existing.toCurrency || existing.currency || 'MOP';
    $('#transfer-to-amount').value = existing.toAmount ?? existing.amount;
    $('#transfer-date').value = existing.date;
    $('#transfer-note').value = existing.note || '';
  } else {
    if (list.length > 1) toSel.selectedIndex = 1;
    $('#transfer-from-amount').value = '';
    $('#transfer-to-amount').value = '';
    $('#transfer-note').value = '';
    $('#transfer-date').valueAsDate = new Date();
  }
  $('#transfer-modal-overlay').classList.remove('hidden');
}
function closeTransferModal() { $('#transfer-modal-overlay').classList.add('hidden'); }
function handleTransferSubmit(e) {
  e.preventDefault();
  const fromId = $('#transfer-from').value;
  const toId = $('#transfer-to').value;
  if (fromId === toId) { alert('轉出與轉入戶口不能相同'); return; }
  const editId = $('#transfer-edit-id').value;
  const old = editId ? records.find(r => r.id === editId) : null;
  const record = {
    id: editId || String(Date.now()),
    type: 'transfer',
    category: '內部轉帳',
    amount: Number($('#transfer-from-amount').value),
    currency: $('#transfer-from-currency').value,
    toAmount: Number($('#transfer-to-amount').value),
    toCurrency: $('#transfer-to-currency').value,
    accountId: fromId,
    toAccountId: toId,
    date: $('#transfer-date').value,
    note: $('#transfer-note').value.trim(),
    createdAt: old?.createdAt || new Date().toISOString()
  };
  if (old) reverseRecordEffect(old);
  applyRecordEffect(record);
  const idx = records.findIndex(r => r.id === record.id);
  if (idx >= 0) records[idx] = record; else records.push(record);
  saveJSON(STORAGE_KEY, records);
  closeTransferModal();
  if (currentPage === 'monthly') renderMonthly();
  else if (currentPage === 'accounts') renderAccounts();
  else renderAccounts();
}

/** 日息：開啟 App 時補入自 lastInterestDate 起的利息 */

// ========== 自訂分類加總 ==========
function loadCustomCatSum() {
  return loadJSON(CUSTOM_CAT_SUM_KEY, []);
}
function saveCustomCatSum(cats) {
  saveJSON(CUSTOM_CAT_SUM_KEY, cats);
}
function renderCustomCatSum() {
  const box = $('#custom-cat-sum');
  if (!box) return;
  const byCat = {};
  getMonthRecords().forEach(r => {
    if (isRepayment(r) || isCollectReceivable(r) || isInterest(r) || isTransfer(r)) return;
    if (isAdvance(r)) {
      const selfAmt = Number(r.selfAmount) || 0;
      if (selfAmt <= 0) return;
      const c = r.category || '其他';
      byCat[c] = (byCat[c] || 0) + toMOP(selfAmt, r.currency);
      return;
    }
    if (r.type !== 'expense') return;
    const c = r.category || '其他';
    byCat[c] = (byCat[c] || 0) + toMOP(r.amount, r.currency);
  });
  const selected = new Set(loadCustomCatSum());
  const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  if (!cats.length) {
    box.innerHTML = '<div class="empty-hint">本月尚無支出可加總</div>';
    return;
  }
  let total = 0;
  const chips = cats.map(c => {
    const on = selected.has(c);
    if (on) total += byCat[c];
    return `<label class="cat-sum-chip${on ? ' active' : ''}">
      <input type="checkbox" data-cat="${escapeHtml(c)}" ${on ? 'checked' : ''}>
      <span>${CATEGORY_ICONS[c] || '🏷️'} ${escapeHtml(c)}</span>
      <span class="cat-sum-amt">${formatMoney(byCat[c])}</span>
    </label>`;
  }).join('');
  box.innerHTML = `
    <div class="cat-sum-chips">${chips}</div>
    <div class="cat-sum-total">已選合計：<strong>MOP ${formatMoney(total)}</strong></div>`;
  box.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const next = [...box.querySelectorAll('input[type=checkbox]:checked')].map(x => x.dataset.cat);
      saveCustomCatSum(next);
      renderCustomCatSum();
    });
  });
}

// ========== 代墊 ==========
function openAdvanceModal() {
  if (!accounts.length) { alert('請先新增戶口'); return; }
  let recv = getReceivableAccount();
  if (!recv) {
    // 自動建立唯一應收帳款戶口
    recv = {
      id: 'recv_' + Date.now(),
      name: '應收帳款',
      type: '應收帳款',
      balances: { MOP: 0, HKD: 0, CNY: 0 },
      note: '',
      linkedBankId: '', interestRate: 0, interestPeriod: 'yearly', lastInterestDate: ''
    };
    accounts.push(recv);
    saveJSON(ACCOUNTS_KEY, accounts);
  }
  $('#advance-form').reset();
  $('#advance-date').valueAsDate = new Date();
  $('#advance-self').value = 0;
  $('#advance-recv').value = 0;
  const paySel = $('#advance-pay-account');
  paySel.innerHTML = '';
  accounts.filter(a => a.type !== '應收帳款').forEach(a => {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
    paySel.appendChild(o);
  });
  const catSel = $('#advance-category');
  if (catSel) {
    catSel.innerHTML = CATEGORIES.filter(c => !['信用卡還款','收回應收','代墊','利息收入'].includes(c.name))
      .map(c => `<option value="${c.name}">${c.icon} ${c.name}</option>`).join('');
  }
  $('#advance-modal-overlay').classList.remove('hidden');
}
function closeAdvanceModal() { $('#advance-modal-overlay')?.classList.add('hidden'); }
function handleAdvanceSubmit(e) {
  e.preventDefault();
  const payId = $('#advance-pay-account').value;
  const currency = $('#advance-currency').value;
  const total = Number($('#advance-total').value) || 0;
  const selfAmt = Number($('#advance-self').value) || 0;
  const recvAmt = Number($('#advance-recv').value) || 0;
  if (total <= 0) { alert('請輸入總金額'); return; }
  if (Math.abs(selfAmt + recvAmt - total) > 0.02) { alert('自費 + 應收 應等於總金額'); return; }
  if (recvAmt < 0 || selfAmt < 0) { alert('金額不可為負'); return; }
  const recv = getReceivableAccount();
  if (!recv) { alert('找不到應收帳款戶口'); return; }
  const date = $('#advance-date').value;
  const note = ($('#advance-note').value || '').trim();
  const category = $('#advance-category')?.value || '其他';
  const idBase = String(Date.now());

  // 1) 支付戶口：銀行／現金扣款；信用卡增加欠款
  const payAcc = accounts.find(a => a.id === payId);
  if (payAcc && payAcc.type === '信用卡') {
    applyBalanceDelta(payId, currency, total);   // 欠款＋
  } else {
    applyBalanceDelta(payId, currency, -total);  // 餘額−
  }
  // 2) 應收加應收金額
  if (recvAmt > 0) applyBalanceDelta(recv.id, currency, recvAmt);

  // 紀錄：一筆代墊主紀錄（方便列表顯示）
  const rec = {
    id: idBase,
    type: 'expense',
    amount: total,
    selfAmount: selfAmt,
    recvAmount: recvAmt,
    currency,
    date,
    category: selfAmt > 0 ? category : '代墊',
    accountId: payId,
    recvAccountId: recv.id,
    isAdvance: true,
    note: note || (recvAmt > 0 ? `代墊 ${money(currency, recvAmt)}` : '代墊'),
    createdAt: new Date().toISOString()
  };
  records.push(rec);
  saveJSON(STORAGE_KEY, records);
  saveJSON(ACCOUNTS_KEY, accounts);
  closeAdvanceModal();
  switchPage(currentPage);
}

// ========== 收回應收 ==========
function openCollectModal() {
  const recv = getReceivableAccount();
  if (!recv) { alert('尚無應收帳款戶口，請先記一筆代墊'); return; }
  $('#collect-form').reset();
  $('#collect-date').valueAsDate = new Date();
  const toSel = $('#collect-to-account');
  toSel.innerHTML = '';
  accounts.filter(a => a.type !== '應收帳款' && a.type !== '信用卡' && a.type !== '電子錢包').forEach(a => {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = `${ACCOUNT_TYPE_ICONS[a.type] || ''} ${a.name}`;
    toSel.appendChild(o);
  });
  if (!toSel.options.length) { alert('需要銀行或現金戶口作為收回目標'); return; }
  $('#collect-modal-overlay').classList.remove('hidden');
}
function closeCollectModal() { $('#collect-modal-overlay')?.classList.add('hidden'); }
function handleCollectSubmit(e) {
  e.preventDefault();
  const recv = getReceivableAccount();
  if (!recv) return;
  const toId = $('#collect-to-account').value;
  const currency = $('#collect-currency').value;
  const amount = Number($('#collect-amount').value) || 0;
  if (amount <= 0) { alert('請輸入金額'); return; }
  const date = $('#collect-date').value;
  const note = ($('#collect-note').value || '').trim();

  // 應收減少、目標戶口增加（不計收入）
  applyBalanceDelta(recv.id, currency, -amount);
  applyBalanceDelta(toId, currency, amount);

  const rec = {
    id: String(Date.now()),
    type: 'transfer',
    amount,
    currency,
    toAmount: amount,
    toCurrency: currency,
    date,
    category: '收回應收',
    accountId: recv.id,
    toAccountId: toId,
    isCollectReceivable: true,
    note: note || '收回應收',
    createdAt: new Date().toISOString()
  };
  records.push(rec);
  saveJSON(STORAGE_KEY, records);
  saveJSON(ACCOUNTS_KEY, accounts);
  closeCollectModal();
  switchPage(currentPage);
}

function accrueDailyInterest() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const floorStr = INTEREST_FLOOR; // '2026-08-08'
  let changed = false;

  accounts.forEach(acc => {
    if (acc.type !== '銀行' || !(Number(acc.interestRate) > 0) || acc.interestPeriod !== 'daily') return;

    // 上次已計到哪一天；沒有或早於下限前一天 → 從下限前一天起算（第一筆落在 floor）
    const floorPrev = (() => {
      const d = new Date(floorStr + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    let last = acc.lastInterestDate || '';
    if (!last || last < floorPrev) last = floorPrev;

    const cursor = new Date(last + 'T00:00:00');
    cursor.setDate(cursor.getDate() + 1); // 從「隔天」開始

    const dailyRate = (Number(acc.interestRate) / 100) / 365;
    if (!(dailyRate > 0)) {
      acc.lastInterestDate = todayStr;
      changed = true;
      return;
    }

    while (cursor.getTime() <= today.getTime()) {
      const dateStr = cursor.toISOString().slice(0, 10);
      if (dateStr < floorStr) {
        cursor.setDate(cursor.getDate() + 1);
        continue;
      }

      // 以「計息當日開始前的餘額」計息，再把利息加回（日複利）
      let dayHasInterest = false;
      ['MOP', 'HKD', 'CNY'].forEach(cur => {
        const bal = Number(acc.balances?.[cur]) || 0;
        if (bal <= 0) return;
        const interest = Math.round(bal * dailyRate * 100) / 100;
        if (interest < 0.01) return;

        if (!acc.balances) acc.balances = { MOP: 0, HKD: 0, CNY: 0 };
        acc.balances[cur] = Math.round((bal + interest) * 100) / 100;

        // 只寫入戶口流水：標記 isInterest，不計入本月收入
        const recId = `${acc.id}_${dateStr}_${cur}`;
        const exists = records.some(r => r.id === recId);
        if (!exists) {
          records.push({
            id: recId,
            type: 'income',          // 流水顯示為「＋」
            isInterest: true,        // 摘要排除
            amount: interest,
            currency: cur,
            date: dateStr,
            category: '利息收入',
            accountId: acc.id,
            note: `日息 ${acc.interestRate}%（餘額 ${formatMoney(bal)}）`,
            createdAt: new Date().toISOString()
          });
        }
        dayHasInterest = true;
        changed = true;
      });

      acc.lastInterestDate = dateStr;
      changed = true;
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  if (changed) {
    // 去重（保險）
    const seen = new Set();
    records = records.filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
    saveJSON(STORAGE_KEY, records);
    saveJSON(ACCOUNTS_KEY, accounts);
  }
  return changed;
}

function startInterestAutoAccrue() {
  if (startInterestAutoAccrue._started) return;
  startInterestAutoAccrue._started = true;

  function msUntilNext0001() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(0, 1, 0, 0); // 今天 00:01
    if (now >= next) next.setDate(next.getDate() + 1); // 已過則明天 00:01
    return next.getTime() - now.getTime();
  }

  function scheduleMidnight() {
    const wait = msUntilNext0001();
    clearTimeout(startInterestAutoAccrue._midnightTimer);
    startInterestAutoAccrue._midnightTimer = setTimeout(() => {
      if (accrueDailyInterest()) {
        if (currentPage === 'monthly' || currentPage === 'accounts') switchPage(currentPage);
      }
      scheduleMidnight(); // 排下一次
    }, wait);
  }

  scheduleMidnight();

  // 備用：每 30 分鐘檢查（避免定時器被瀏覽器節流漏掉）
  clearInterval(startInterestAutoAccrue._timer);
  startInterestAutoAccrue._timer = setInterval(() => {
    if (accrueDailyInterest()) {
      if (currentPage === 'monthly' || currentPage === 'accounts') switchPage(currentPage);
    }
  }, 30 * 60 * 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (accrueDailyInterest()) {
        if (currentPage === 'monthly' || currentPage === 'accounts') switchPage(currentPage);
      }
      scheduleMidnight(); // 重新對齊 00:01
    }
  });
}


function openAddLiabilityModal() {
  $('#liability-modal-title').textContent = '新增扣減項';
  $('#liability-form').reset();
  $('#liability-edit-id').value = '';
  $('#liab-bal-mop').value = 0; $('#liab-bal-hkd').value = 0; $('#liab-bal-cny').value = 0;
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
  if (idx >= 0) liabilities[idx] = l; else liabilities.push(l);
  saveJSON(LIABILITIES_KEY, liabilities);
  closeLiabilityModal();
  renderAssets();
}

function mpfCurrency(a) {
  return a?.currency === 'MOP' ? 'MOP' : 'HKD';
}
function mpfToMOP(a) {
  return toMOP(Number(a.balance) || 0, mpfCurrency(a));
}

function renderAssets() {
  let bankMop = 0, otherMop = 0;
  accounts.forEach(a => {
    if (a.type === '電子錢包' || a.type === '信用卡' || a.type === '應收帳款') return; // 信用卡／應收不計入資產頁
    const mop = balancesToMOP(a.balances);
    if (a.type === '銀行') bankMop += mop;
    else otherMop += mop; // 現金、投資、其他
  });
  let mpfTotal = 0;
  (mpfData.accounts || []).forEach(a => { mpfTotal += mpfToMOP(a); });
  const gross = bankMop + otherMop + mpfTotal;
  // 扣減合計：僅手動扣減項，不含信用卡
  let otherLiab = 0;
  liabilities.forEach(l => { otherLiab += balancesToMOP(l.balances); });
  const totalLiab = otherLiab;
  // 總存款 = 總資產 − 扣減 − 強積金
  const deposit = gross - totalLiab - mpfTotal;

  $('#assets-gross').textContent = money('MOP', gross);
  $('#assets-liability').textContent = money('MOP', totalLiab);
  if ($('#assets-deposit')) $('#assets-deposit').textContent = money('MOP', deposit);
  $('#assets-net').textContent = money('MOP', gross - totalLiab);

  // 分布：強積金 / 銀行 / 其他（不含信用卡）
  const chartItems = [
    { label: '🏛️ 強積金', value: mpfTotal },
    { label: '🏦 銀行戶口', value: bankMop },
    { label: '💼 其他資產', value: otherMop }
  ].filter(i => i.value > 0);

  if (!chartItems.length) {
    $('#no-assets-data').style.display = 'block';
    $('#assetsAccountBars').innerHTML = '';
    $('#assetsCurrencyBars').innerHTML = '';
  } else {
    $('#no-assets-data').style.display = 'none';
    renderBarList($('#assetsAccountBars'), chartItems);
    const byCur = { MOP: 0, HKD: 0, CNY: 0 };
    accounts.forEach(a => {
      if (a.type === '電子錢包' || a.type === '信用卡' || a.type === '應收帳款') return;
      byCur.MOP += Number(a.balances?.MOP || 0);
      byCur.HKD += toMOP(a.balances?.HKD || 0, 'HKD');
      byCur.CNY += toMOP(a.balances?.CNY || 0, 'CNY');
    });
    byCur.HKD += mpfTotal;
    renderBarList($('#assetsCurrencyBars'),
      Object.entries(byCur).filter(([, v]) => v > 0).map(([c, v]) => ({ label: c, value: v }))
    );
  }

  const detailEl = $('#assets-detail-list');
  detailEl.innerHTML = '';
  // 依分類列出；點類型才展開戶口（排除信用卡、電子錢包）
  const detailGroups = [
    { key: '銀行', title: '🏦 銀行', list: accounts.filter(a => a.type === '銀行') },
    { key: '現金', title: '💵 現金', list: accounts.filter(a => a.type === '現金') },
    { key: '投資', title: '📈 投資', list: accounts.filter(a => a.type === '投資') },
    { key: '其他', title: '🏷️ 其他', list: accounts.filter(a => a.type === '其他') },
    {
      key: '強積金',
      title: '🏛️ 強積金',
      list: (mpfData.accounts || []).map(m => {
        const cur = mpfCurrency(m);
        const bal = Number(m.balance) || 0;
        return {
          id: m.id, name: m.name, type: '強積金',
          balances: { MOP: cur === 'MOP' ? bal : 0, HKD: cur === 'HKD' ? bal : 0, CNY: 0 },
          isMpf: true
        };
      })
    }
  ];
  let anyGroup = false;
  detailGroups.forEach(g => {
    if (!g.list.length) return;
    anyGroup = true;
    const groupTotal = g.list.reduce((s, a) => s + balancesToMOP(a.balances), 0);
    const open = expandedAssetGroup === g.key;
    const wrap = document.createElement('div');
    wrap.className = 'asset-group' + (open ? ' open' : '');
    wrap.innerHTML = `
      <div class="asset-group-header" data-key="${g.key}">
        <span class="asset-group-title">${g.title} <span class="account-meta">（${g.list.length}）</span></span>
        <span class="asset-group-total">${money('MOP', groupTotal)} ${open ? '▾' : '▸'}</span>
      </div>
      <div class="asset-group-body" style="display:${open ? 'block' : 'none'}"></div>`;
    const body = wrap.querySelector('.asset-group-body');
    if (open) {
      g.list.forEach(a => {
        const mop = balancesToMOP(a.balances);
        const item = document.createElement('div');
        item.className = 'account-item';
        item.style.cursor = 'default';
        item.innerHTML = `<div class="account-item-header">
          <div class="account-name">${escapeHtml(a.name)}</div>
          <div style="text-align:right;font-weight:700;color:var(--primary)">${money('MOP', mop)}</div>
        </div>
        ${currencyChipsHtml(a.balances)}`;
        body.appendChild(item);
      });
    }
    detailEl.appendChild(wrap);
  });
  if (!anyGroup) {
    detailEl.innerHTML = '<div class="empty-hint">尚無資產戶口</div>';
  } else {
    detailEl.querySelectorAll('.asset-group-header').forEach(h => {
      h.addEventListener('click', () => {
        const key = h.dataset.key;
        expandedAssetGroup = expandedAssetGroup === key ? null : key;
        renderAssets();
      });
    });
  }

  const liabEl = $('#liabilities-list');
  liabEl.innerHTML = '';
  // 扣減項僅手動項目，不含信用卡
  if (!liabilities.length) {
    $('#no-liabilities').style.display = 'block';
  } else {
    $('#no-liabilities').style.display = 'none';
    liabilities.forEach(l => {
      const b = l.balances || {};
      const item = document.createElement('div');
      item.className = 'account-item'; item.style.cursor = 'default';
      item.innerHTML = `<div class="account-item-header">
        <div class="account-name">${escapeHtml(l.name)}</div>
        <div class="account-actions">
          <button type="button" class="edit" data-id="${l.id}">編輯</button>
          <button type="button" class="delete" data-id="${l.id}">刪除</button>
        </div></div>
        ${currencyChipsHtml(b)}
        <div class="account-meta" style="margin-top:6px">折合 ${money('MOP', balancesToMOP(b))}</div>`;
      liabEl.appendChild(item);
    });
    liabEl.querySelectorAll('.edit').forEach(btn => btn.addEventListener('click', () => openEditLiabilityModal(btn.dataset.id)));
    liabEl.querySelectorAll('.delete').forEach(btn => btn.addEventListener('click', () => {
      liabilities = liabilities.filter(l => l.id !== btn.dataset.id);
      saveJSON(LIABILITIES_KEY, liabilities);
      renderAssets();
    }));
  }
}

function mpfMonthKey(y, m) {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** 計算指定月份相對上一筆 snapshot 的漲跌合計 */
function calcMpfMonthChange(year, month) {
  const key = mpfMonthKey(year, month);
  let totalDiff = 0;
  (mpfData.accounts || []).forEach(acc => {
    const snaps = [...(acc.snapshots || [])].sort((a, b) => a.month.localeCompare(b.month));
    const idx = snaps.findIndex(s => s.month === key);
    if (idx < 0) return;
    const cur = Number(snaps[idx].balance);
    if (idx === 0) totalDiff += 0; // 無上月可比
    else totalDiff += cur - Number(snaps[idx - 1].balance);
  });
  return totalDiff;
}

function renderMpf() {
  let totalMop = 0;
  (mpfData.accounts || []).forEach(a => { totalMop += mpfToMOP(a); });
  $('#mpf-total').textContent = money('MOP', totalMop);

  // 當月漲跌折合 MOP
  const key = mpfMonthKey(mpfViewYear, mpfViewMonth);
  let changeMop = 0;
  (mpfData.accounts || []).forEach(acc => {
    const cur = mpfCurrency(acc);
    const snaps = [...(acc.snapshots || [])].sort((a, b) => a.month.localeCompare(b.month));
    const idx = snaps.findIndex(s => s.month === key);
    if (idx < 0) return;
    if (idx === 0) return;
    const diff = Number(snaps[idx].balance) - Number(snaps[idx - 1].balance);
    changeMop += toMOP(diff, cur);
  });
  $('#mpf-change-month-label').textContent = `${mpfViewYear}/${mpfViewMonth + 1} 漲跌`;
  const changeEl = $('#mpf-month-change');
  changeEl.textContent = (changeMop >= 0 ? '+' : '') + money('MOP', changeMop);
  changeEl.style.color = changeMop > 0 ? 'var(--income)' : changeMop < 0 ? 'var(--expense)' : '';

  const el = $('#mpf-accounts-list');
  el.innerHTML = '';
  if (!mpfData.accounts?.length) {
    $('#no-mpf-accounts').style.display = 'block';
    return;
  }
  $('#no-mpf-accounts').style.display = 'none';

  mpfData.accounts.forEach(acc => {
    const card = document.createElement('div');
    const expanded = expandedMpfId === acc.id;
    const cur = mpfCurrency(acc);
    card.className = 'mpf-card' + (expanded ? ' expanded' : '');
    card.dataset.id = acc.id;
    const snaps = [...(acc.snapshots || [])].sort((a, b) => b.month.localeCompare(a.month));
    let listHtml = '';
    if (expanded) {
      if (!snaps.length) listHtml = '<div class="ledger-empty">尚無結餘紀錄</div>';
      else {
        listHtml = snaps.map((s, i) => {
          const prev = snaps[i + 1];
          let changeHtml = prev
            ? (() => {
                const diff = Number(s.balance) - Number(prev.balance);
                const up = diff >= 0;
                return `<span class="${up ? 'mpf-change-up' : 'mpf-change-down'}">${up ? '+' : ''}${money(cur, diff)}</span>`;
              })()
            : '<span class="account-meta">—</span>';
          return `<div class="mpf-change-item">
            <span>${s.month} · ${money(cur, s.balance)}${s.note ? ' · ' + escapeHtml(s.note) : ''}</span>
            <span>${changeHtml}
              <button type="button" class="edit-snap" data-acc="${acc.id}" data-id="${s.id}" style="margin-left:6px;font-size:0.7rem;padding:2px 8px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;cursor:pointer">編輯</button>
              <button type="button" class="del-snap" data-acc="${acc.id}" data-id="${s.id}" style="font-size:0.7rem;padding:2px 8px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;cursor:pointer;color:#dc2626">刪</button>
            </span></div>`;
        }).join('');
      }
    }
    card.innerHTML = `
      <div class="mpf-card-header mpf-card-toggle">
        <div>
          <div class="mpf-card-name">${escapeHtml(acc.name)} <span class="account-meta">${cur} ${expanded ? '▾' : '▸'}</span></div>
          ${acc.note ? `<div class="account-meta">${escapeHtml(acc.note)}</div>` : ''}
        </div>
        <div class="mpf-card-balance">${money(cur, acc.balance)}</div>
      </div>
      <div class="account-actions" style="margin-bottom:8px">
        <button type="button" class="add-snap" data-id="${acc.id}">＋ 紀錄結餘</button>
        <button type="button" class="edit-acc" data-id="${acc.id}">編輯</button>
        <button type="button" class="delete del-acc" data-id="${acc.id}">刪除</button>
      </div>
      ${expanded ? `<div class="mpf-changes">
        <div class="mpf-changes-title">每月結餘（自動計算漲跌）</div>
        ${listHtml}
      </div>` : ''}`;
    el.appendChild(card);
  });

  el.querySelectorAll('.mpf-card-toggle').forEach(hdr => {
    hdr.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const card = hdr.closest('.mpf-card');
      const id = card?.dataset.id;
      expandedMpfId = expandedMpfId === id ? null : id;
      renderMpf();
    });
  });
  el.querySelectorAll('.add-snap').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openAddMpfSnapModal(btn.dataset.id); }));
  el.querySelectorAll('.edit-acc').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openEditMpfAccountModal(btn.dataset.id); }));
  el.querySelectorAll('.del-acc').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    mpfData.accounts = mpfData.accounts.filter(a => a.id !== btn.dataset.id);
    saveJSON(MPF_KEY, mpfData); renderMpf();
  }));
  el.querySelectorAll('.edit-snap').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openEditMpfSnapModal(btn.dataset.acc, btn.dataset.id); }));
  el.querySelectorAll('.del-snap').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const acc = mpfData.accounts.find(a => a.id === btn.dataset.acc);
    if (!acc) return;
    acc.snapshots = (acc.snapshots || []).filter(s => s.id !== btn.dataset.id);
    const sorted = [...(acc.snapshots || [])].sort((a, b) => b.month.localeCompare(a.month));
    if (sorted.length) acc.balance = Number(sorted[0].balance);
    saveJSON(MPF_KEY, mpfData); renderMpf();
  }));
}

function openAddMpfAccountModal() {
  $('#mpf-account-modal-title').textContent = '新增強積金戶口';
  $('#mpf-account-form').reset();
  $('#mpf-account-edit-id').value = '';
  $('#mpf-account-balance').value = 0;
  if ($('#mpf-account-currency')) $('#mpf-account-currency').value = 'HKD';
  $('#mpf-account-modal-overlay').classList.remove('hidden');
}
function openEditMpfAccountModal(id) {
  const a = mpfData.accounts.find(x => x.id === id);
  if (!a) return;
  $('#mpf-account-modal-title').textContent = '編輯強積金戶口';
  $('#mpf-account-edit-id').value = a.id;
  $('#mpf-account-name').value = a.name;
  $('#mpf-account-balance').value = a.balance;
  if ($('#mpf-account-currency')) $('#mpf-account-currency').value = mpfCurrency(a);
  $('#mpf-account-note').value = a.note || '';
  $('#mpf-account-modal-overlay').classList.remove('hidden');
}
function closeMpfAccountModal() { $('#mpf-account-modal-overlay').classList.add('hidden'); }
function handleMpfAccountSubmit(e) {
  e.preventDefault();
  const id = $('#mpf-account-edit-id').value || String(Date.now());
  const existing = mpfData.accounts.find(a => a.id === id);
  const acc = {
    id, name: $('#mpf-account-name').value.trim(),
    currency: ($('#mpf-account-currency')?.value === 'MOP') ? 'MOP' : 'HKD',
    balance: Number($('#mpf-account-balance').value) || 0,
    note: $('#mpf-account-note').value.trim(),
    snapshots: existing?.snapshots || []
  };
  const idx = mpfData.accounts.findIndex(a => a.id === id);
  if (idx >= 0) mpfData.accounts[idx] = acc; else mpfData.accounts.push(acc);
  saveJSON(MPF_KEY, mpfData);
  closeMpfAccountModal();
  renderMpf();
}

function openAddMpfSnapModal(accountId) {
  $('#mpf-change-modal-title').textContent = '紀錄結餘';
  $('#mpf-change-form').reset();
  $('#mpf-change-edit-id').value = '';
  $('#mpf-change-account-id').value = accountId;
  const now = new Date();
  $('#mpf-change-month').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const acc = mpfData.accounts.find(a => a.id === accountId);
  if (acc) $('#mpf-change-amount').value = acc.balance;
  $('#mpf-change-modal-overlay').classList.remove('hidden');
}
function openEditMpfSnapModal(accountId, snapId) {
  const acc = mpfData.accounts.find(a => a.id === accountId);
  const s = acc?.snapshots?.find(x => x.id === snapId);
  if (!s) return;
  $('#mpf-change-modal-title').textContent = '編輯結餘';
  $('#mpf-change-edit-id').value = s.id;
  $('#mpf-change-account-id').value = accountId;
  $('#mpf-change-month').value = s.month;
  $('#mpf-change-amount').value = s.balance;
  $('#mpf-change-note').value = s.note || '';
  $('#mpf-change-modal-overlay').classList.remove('hidden');
}
function closeMpfChangeModal() { $('#mpf-change-modal-overlay').classList.add('hidden'); }
function handleMpfChangeSubmit(e) {
  e.preventDefault();
  const accountId = $('#mpf-change-account-id').value;
  const acc = mpfData.accounts.find(a => a.id === accountId);
  if (!acc) return;
  if (!acc.snapshots) acc.snapshots = [];
  const editId = $('#mpf-change-edit-id').value;
  const month = $('#mpf-change-month').value;
  const balance = Number($('#mpf-change-amount').value);
  const note = $('#mpf-change-note').value.trim();
  if (editId) {
    const s = acc.snapshots.find(x => x.id === editId);
    if (s) { s.month = month; s.balance = balance; s.note = note; }
  } else {
    const existing = acc.snapshots.find(x => x.month === month);
    if (existing) { existing.balance = balance; existing.note = note; }
    else acc.snapshots.push({ id: String(Date.now()), month, balance, note });
  }
  const sorted = [...acc.snapshots].sort((a, b) => b.month.localeCompare(a.month));
  if (sorted.length) acc.balance = Number(sorted[0].balance);
  saveJSON(MPF_KEY, mpfData);
  closeMpfChangeModal();
  renderMpf();
}

// ========== Export / Import ==========
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportRecordsCSV() {
  const headers = ['日期','類型','分類','金額','貨幣','戶口','備註'];
  const rows = records.map(r => {
    const acc = accounts.find(a => a.id === (r.displayAccountId || r.accountId));
    return [r.date, r.type === 'income' ? '收入' : '支出', r.category, r.amount, r.currency, acc?.name || '', r.note || ''];
  });
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
  downloadFile(`記帳紀錄_${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv;charset=utf-8');
  $('#export-modal-overlay').classList.add('hidden');
}

function exportAccountsCSV() {
  const headers = ['名稱','類型','MOP','HKD','CNY','備註'];
  const rows = accounts.filter(a => a.type !== '電子錢包').map(a => [
    a.name, a.type, a.balances?.MOP || 0, a.balances?.HKD || 0, a.balances?.CNY || 0, a.note || ''
  ]);
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
  downloadFile(`戶口_${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv;charset=utf-8');
  $('#export-modal-overlay').classList.add('hidden');
}

function exportMpfCSV() {
  const headers = ['戶口','目前結餘(HKD)','月份','該月結餘(HKD)','備註'];
  const rows = [];
  (mpfData.accounts || []).forEach(acc => {
    const snaps = acc.snapshots || [];
    if (!snaps.length) {
      rows.push([acc.name, acc.balance, '', '', acc.note || '']);
    } else {
      snaps.forEach(s => rows.push([acc.name, acc.balance, s.month, s.balance, s.note || '']));
    }
  });
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
  downloadFile(`強積金_${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv;charset=utf-8');
  $('#export-modal-overlay').classList.add('hidden');
}

function exportBackup() {
  const data = {
    version: 3,
    exportedAt: new Date().toISOString(),
    records, accounts, liabilities, mpfData, rates
  };
  downloadFile(`記帳備份_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(data, null, 2), 'application/json');
  $('#export-modal-overlay').classList.add('hidden');
}

function importBackup(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.records && !data.accounts) throw new Error('格式不正確');
      records = data.records || [];
      accounts = data.accounts || [];
      liabilities = data.liabilities || [];
      mpfData = data.mpfData || { accounts: [] };
      rates = data.rates ? { ...DEFAULT_RATES, ...data.rates, MOP: 1 } : rates;
      saveJSON(STORAGE_KEY, records);
      saveJSON(ACCOUNTS_KEY, accounts);
      saveJSON(LIABILITIES_KEY, liabilities);
      saveJSON(MPF_KEY, mpfData);
      saveRatesObj(rates);
      alert('備份已導入（已覆蓋現有資料）');
      $('#export-modal-overlay').classList.add('hidden');
      switchPage(currentPage);
    } catch (err) {
      alert('導入失敗：' + (err.message || '檔案無效'));
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

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
