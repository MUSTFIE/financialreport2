const firebaseConfig = {
  apiKey: "AIzaSyDARQel_FE1owKu7vcwj5Vb2mQQPHbdJUg",
  authDomain: "budget-tracker-f6987.firebaseapp.com",
  databaseURL: "https://budget-tracker-f6987-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "budget-tracker-f6987",
  storageBucket: "budget-tracker-f6987.firebasestorage.app",
  messagingSenderId: "95285914076",
  appId: "1:95285914076:web:44f6058eedbabc858cc719"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

let dbRef = null;
let dbListener = null;

let cloudData = {
  records: [],
  customBankList: [],
  bankBaseBalances: {
    '澳門螞蟻銀行': { MOP: 0, HKD: 0, CNY: 0 },
    '澳門中國銀行': { MOP: 0, HKD: 0, CNY: 0 },
    '澳門工商銀行': { MOP: 0, HKD: 0, CNY: 0 },
    '澳門發展銀行': { MOP: 0, HKD: 0, CNY: 0 },
    '香港恒生銀行': { MOP: 0, HKD: 0, CNY: 0 }
  },
  creditBaseBalances: {
    '澳門中國銀行(信用卡)': { MOP: 0, HKD: 0, CNY: 0 },
    '香港中國銀行(信用卡)': { MOP: 0, HKD: 0, CNY: 0 },
    'DBS(信用卡)': { MOP: 0, HKD: 0, CNY: 0 },
    'AE(信用卡)': { MOP: 0, HKD: 0, CNY: 0 }
  },
  globalDeductions: [],
  mpfAccounts: [
    { id: '1', name: '宏利強積金主戶口', initialBalance: 0, balance: 50000 },
    { id: '2', name: '匯豐強積金戶口', initialBalance: 0, balance: 20000 }
  ],
  mpfMonthlyRecords: [],
  customCategories: [],
  deletedDefaultCategories: []
};

const EXCHANGE_RATES = { MOP: 1.0, HKD: 1.0314, CNY: 1.13 };
const BINDING_MAP = { 'MPay': '澳門螞蟻銀行', 'BOC Pay': '澳門中國銀行' };
const DEFAULT_BANK_LIST = ['澳門螞蟻銀行', '澳門中國銀行', '澳門工商銀行', '澳門發展銀行', '香港恒生銀行'];
const CREDIT_LIST = ['澳門中國銀行(信用卡)', '香港中國銀行(信用卡)', 'DBS(信用卡)', 'AE(信用卡)'];

function formatMoney(num) {
  if (isNaN(num)) return '0.00';
  return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getBankList() {
  const custom = cloudData.customBankList || [];
  return [...DEFAULT_BANK_LIST, ...custom];
}

function loginWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch((error) => {
    alert("Google 登入失敗：" + error.message);
  });
}

function logout() {
  auth.signOut().then(() => { window.location.reload(); });
}

// 共用導航列產生器
function renderNavTabs(activeTab) {
  const tabs = [
    { id: 'monthly', name: '月度', icon: '📅', url: 'index.html' },
    { id: 'yearly', name: '年度', icon: '📊', url: 'yearly.html' },
    { id: 'bank', name: '銀行', icon: '🏛️', url: 'bank.html' },
    { id: 'credit', name: '信用卡', icon: '💳', url: 'credit.html' },
    { id: 'mpf', name: '強積金', icon: '🛡️', url: 'mpf.html' },
    { id: 'asset', name: '總資產', icon: '💎', url: 'asset.html' }
  ];

  let html = `<div class="nav-tabs">`;
  tabs.forEach(t => {
    const active = t.id === activeTab ? 'active' : '';
    html += `<button class="nav-btn ${active}" onclick="location.href='${t.url}'"><span class="nav-icon">${t.icon}</span>${t.name}</button>`;
  });
  html += `</div>`;
  return html;
}

// 共用 Auth 狀態列
function renderAuthBar() {
  return `
    <div class="auth-bar" id="auth-bar">
      <div class="auth-user-info" id="auth-user-info"><span>🔒 請登入以同步個人雲端資料</span></div>
      <div id="auth-action-container"><button type="button" class="btn-auth" onclick="loginWithGoogle()">Google 登入</button></div>
    </div>
    <div class="sync-status" id="sync-status-badge">☁️ 等待 Firebase 登入驗證...</div>
    <div class="rate-badge">💱 匯率基準：1 HKD = 1.0314 MOP ｜ 1 CNY = 1.13 MOP</div>
  `;
}

function initAuthListener(callback) {
  auth.onAuthStateChanged((user) => {
    const userInfoEl = document.getElementById('auth-user-info');
    const actionContainerEl = document.getElementById('auth-action-container');
    const syncBadge = document.getElementById('sync-status-badge');

    if (dbRef && dbListener) { dbRef.off('value', dbListener); }

    if (user) {
      if (userInfoEl) {
        userInfoEl.innerHTML = `
          <img src="${user.photoURL || ''}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'">
          <span>${user.displayName || user.email}</span>
        `;
      }
      if (actionContainerEl) actionContainerEl.innerHTML = `<button type="button" class="btn-auth logout" onclick="logout()">登出</button>`;
      
      dbRef = db.ref(`users/${user.uid}/cloud_accounting_data`);
      if (syncBadge) syncBadge.textContent = '☁️ 正在連線至你的 Firebase 雲端...';

      dbListener = dbRef.on('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
          cloudData = val;
          if (!cloudData.customBankList) cloudData.customBankList = [];
          if (!cloudData.deletedDefaultCategories) cloudData.deletedDefaultCategories = [];
          if (!cloudData.creditBaseBalances) cloudData.creditBaseBalances = {
            '澳門中國銀行(信用卡)': { MOP: 0, HKD: 0, CNY: 0 },
            '香港中國銀行(信用卡)': { MOP: 0, HKD: 0, CNY: 0 },
            'DBS(信用卡)': { MOP: 0, HKD: 0, CNY: 0 },
            'AE(信用卡)': { MOP: 0, HKD: 0, CNY: 0 }
          };
        } else {
          syncToFirebase();
        }
        if (callback) callback();
      });
    } else {
      if (userInfoEl) userInfoEl.innerHTML = `<span>🔒 請登入以同步個人雲端資料</span>`;
      if (actionContainerEl) actionContainerEl.innerHTML = `<button type="button" class="btn-auth" onclick="loginWithGoogle()">Google 登入</button>`;
      if (syncBadge) syncBadge.textContent = '⚠️ 尚未登入，資料僅暫存於本地';
      
      dbRef = db.ref('cloud_accounting_data_guest');
      dbRef.once('value').then((snapshot) => {
        const val = snapshot.val();
        if (val) {
          cloudData = val;
          if (!cloudData.customBankList) cloudData.customBankList = [];
          if (!cloudData.deletedDefaultCategories) cloudData.deletedDefaultCategories = [];
        }
        if (callback) callback();
      });
    }
  });
}

function syncToFirebase() {
  if (!dbRef) return;
  dbRef.set(cloudData).then(() => {
    const badge = document.getElementById('sync-status-badge');
    if (badge) {
      badge.textContent = '☁️ 雲端同步完成 (實時多機互聯)';
      badge.style.background = '#D1FAE5';
      badge.style.color = '#065F46';
    }
  });
}

function convertToMOP(amount, currency) {
  return amount * (EXCHANGE_RATES[currency] || 1.0);
}

function loadRecords() { return cloudData.records || []; }
function saveRecords(records) { cloudData.records = records; syncToFirebase(); }
function loadBankBaseBalances() { return cloudData.bankBaseBalances; }
function saveBankBaseBalances(data) { cloudData.bankBaseBalances = data; syncToFirebase(); }
function loadCreditBaseBalances() { return cloudData.creditBaseBalances; }
function saveCreditBaseBalances(data) { cloudData.creditBaseBalances = data; syncToFirebase(); }
function getActualAccount(accountName) { return BINDING_MAP[accountName] || accountName; }
