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

function formatMoney(num) {
  if (isNaN(num)) return '0.00';
  return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getBankList() {
  const custom = cloudData.customBankList || [];
  return [...DEFAULT_BANK_LIST, ...custom];
}

const CREDIT_LIST = ['澳門中國銀行(信用卡)', '香港中國銀行(信用卡)', 'DBS(信用卡)', 'AE(信用卡)'];

function loginWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch((error) => {
    alert("Google 登入失敗：" + error.message);
  });
}

function logout() {
  auth.signOut().then(() => { window.location.reload(); });
}

auth.onAuthStateChanged((user) => {
  const userInfoEl = document.getElementById('auth-user-info');
  const actionContainerEl = document.getElementById('auth-action-container');
  const syncBadge = document.getElementById('sync-status-badge');

  if (dbRef && dbListener) { dbRef.off('value', dbListener); }

  if (user) {
    userInfoEl.innerHTML = `
      <img src="${user.photoURL || ''}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'">
      <span>${user.displayName || user.email}</span>
    `;
    actionContainerEl.innerHTML = `<button type="button" class="btn-auth logout" onclick="logout()">登出</button>`;
    
    dbRef = db.ref(`users/${user.uid}/cloud_accounting_data`);
    syncBadge.textContent = '☁️ 正在連線至你的 Firebase 雲端...';

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
      renderApp();
    });

  } else {
    userInfoEl.innerHTML = `<span>🔒 請登入以同步個人雲端資料</span>`;
    actionContainerEl.innerHTML = `<button type="button" class="btn-auth" onclick="loginWithGoogle()">Google 登入</button>`;
    syncBadge.textContent = '⚠️ 尚未登入，資料僅暫存於本地';
    
    dbRef = db.ref('cloud_accounting_data_guest');
    dbRef.once('value').then((snapshot) => {
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
      }
      renderApp();
    });
  }
});

function convertToMOP(amount, currency) {
  return amount * (EXCHANGE_RATES[currency] || 1.0);
}

function loadRecords() { return cloudData.records || []; }
function loadCustomCategories() { return cloudData.customCategories || []; }
function loadDeletedDefaultCategories() { return cloudData.deletedDefaultCategories || []; }
function loadBankBaseBalances() { return cloudData.bankBaseBalances; }
function loadCreditBaseBalances() { return cloudData.creditBaseBalances; }
function loadGlobalDeductions() { return cloudData.globalDeductions || []; }
function loadMPFAccountsData() { return cloudData.mpfAccounts || []; }
function loadMPFMonthlyRecordsData() { return cloudData.mpfMonthlyRecords || []; }

function syncToFirebase() {
  if (!dbRef) return;
  dbRef.set(cloudData).then(() => {
    const badge = document.getElementById('sync-status-badge');
    badge.textContent = '☁️ 雲端同步完成 (實時多機互聯)';
    badge.style.background = '#D1FAE5';
    badge.style.color = '#065F46';
  });
}

function saveRecords(records) { cloudData.records = records; syncToFirebase(); }
function saveCustomCategories(cats) { cloudData.customCategories = cats; syncToFirebase(); renderCategoryGrid(); }
function saveDeletedDefaultCategories(delCats) { cloudData.deletedDefaultCategories = delCats; syncToFirebase(); renderCategoryGrid(); }
function saveBankBaseBalances(data) { cloudData.bankBaseBalances = data; syncToFirebase(); }
function saveCreditBaseBalances(data) { cloudData.creditBaseBalances = data; syncToFirebase(); }
function saveGlobalDeductions(data) { cloudData.globalDeductions = data; syncToFirebase(); }
function saveMPFAccountsData(data) { cloudData.mpfAccounts = data; syncToFirebase(); }
function saveMPFMonthlyRecordsData(data) { cloudData.mpfMonthlyRecords = data; syncToFirebase(); }

function getActualAccount(accountName) { return BINDING_MAP[accountName] || accountName; }

function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(ct => ct.classList.remove('active'));
  document.getElementById(`btn-tab-${tab}`).classList.add('active');
  document.getElementById(`tab-${tab}-content`).classList.add('active');
  if (tab === 'yearly') renderYearlySummary();
  if (tab === 'bank') renderBankSummary();
  if (tab === 'credit') renderCreditSection();
  if (tab === 'mpf') renderMPFSection();
  if (tab === 'asset') renderAssetSection();
}

const dateInput = document.getElementById('date');
const today = new Date();
dateInput.value = today.toISOString().split('T')[0];
const filterMonthInput = document.getElementById('filter-month');
const currentYear = today.getFullYear();
const currentMonthStr = String(today.getMonth() + 1).padStart(2, '0');
filterMonthInput.value = `${currentYear}-${currentMonthStr}`;
document.getElementById('bank-flow-month').value = `${currentYear}-${currentMonthStr}`;
document.getElementById('mpf-rec-month').value = `${currentYear}-${currentMonthStr}`;

function checkAccountAutoBind() {
  const acc = document.getElementById('account').value;
  const tipBox = document.getElementById('bind-tip-box');
  if (BINDING_MAP[acc]) {
    tipBox.style.display = 'block';
    tipBox.textContent = `💡 提示：使用 ${acc} 支出將自動從「${BINDING_MAP[acc]}」扣除！`;
  } else {
    tipBox.style.display = 'none';
  }
}

function autoCalculateTransferToAmount() {
  if (currentType !== 'transfer') return;
  const fromCurr = document.getElementById('currency').value;
  const fromAmt = parseFloat(document.getElementById('amount').value);
  const toCurr = document.getElementById('to-currency').value;
  const toAmtInput = document.getElementById('to-amount');

  if (!isNaN(fromAmt) && fromAmt > 0) {
    const mopVal = convertToMOP(fromAmt, fromCurr);
    const calculatedToVal = mopVal / EXCHANGE_RATES[toCurr];
    toAmtInput.value = parseFloat(calculatedToVal.toFixed(2));
  }
}

let selectedCategoryValue = '';
const customCategoryInput = document.getElementById('custom-category-input');

function renderCategoryGrid() {
  const grid = document.getElementById('category-grid');
  const baseDefaultCategories = [
    { name: '餐飲', icon: '🍔' }, { name: '交通', icon: '🚗' }, { name: '購物', icon: '🛍️' },
    { name: '娛樂', icon: '🎮' }, { name: '居住', icon: '🏠' }, { name: '母嬰', icon: '👶' },
    { name: '保險費', icon: '🛡️' }, { name: '學貸', icon: '🎓' }, { name: '生活費', icon: '💵' },
    { name: '薪資', icon: '💼' }, { name: '其他', icon: '🏷️' }
  ];
  const deletedCats = loadDeletedDefaultCategories();
  const customCats = loadCustomCategories();
  
  let html = '';
  baseDefaultCategories.forEach(cat => {
    if (!deletedCats.includes(cat.name)) {
      const isActive = selectedCategoryValue === cat.name ? 'active' : '';
      const showDelete = cat.name !== '其他';
      let deleteBtnHtml = showDelete ? `<button type="button" class="cat-delete-btn" onclick="deleteCategory(event, '${cat.name}', true)">×</button>` : '';
      html += `<div class="cat-block ${isActive}" data-value="${cat.name}"><span class="cat-icon">${cat.icon}</span><span class="cat-label">${cat.name}</span>${deleteBtnHtml}</div>`;
    }
  });

  customCats.forEach(catName => {
    const isActive = selectedCategoryValue === catName ? 'active' : '';
    html += `<div class="cat-block ${isActive}" data-value="${catName}"><span class="cat-icon">📌</span><span class="cat-label">${catName}</span><button type="button" class="cat-delete-btn" onclick="deleteCategory(event, '${catName}', false)">×</button></div>`;
  });

  grid.innerHTML = html;
  
  document.querySelectorAll('.cat-block').forEach(block => {
    block.addEventListener('click', (e) => {
      if (e.target.classList.contains('cat-delete-btn')) return;
      document.querySelectorAll('.cat-block').forEach(b => b.classList.remove('active'));
      block.classList.add('active');
      selectedCategoryValue = block.getAttribute('data-value');
      if (selectedCategoryValue === 'other' || selectedCategoryValue === '其他') {
        customCategoryInput.style.display = 'block';
        customCategoryInput.required = true;
      } else {
        customCategoryInput.style.display = 'none';
        customCategoryInput.required = false;
        customCategoryInput.value = '';
      }
    });
  });
}

function deleteCategory(event, catName, isDefault) {
  event.stopPropagation();
  if (!confirm(`確定要刪除支付分類「${catName}」嗎？`)) return;
  if (selectedCategoryValue === catName) {
    selectedCategoryValue = '';
    customCategoryInput.style.display = 'none';
    customCategoryInput.required = false;
  }
  if (isDefault) {
    let deletedCats = loadDeletedDefaultCategories();
    if (!deletedCats.includes(catName)) {
      deletedCats.push(catName);
      saveDeletedDefaultCategories(deletedCats);
    }
  } else {
    let customCats = loadCustomCategories().filter(c => c !== catName);
    saveCustomCategories(customCats);
  }
}

let currentType = 'expense';
const btnExpense = document.getElementById('btn-expense');
const btnIncome = document.getElementById('btn-income');
const btnTransfer = document.getElementById('btn-transfer');
const rowSingleAccount = document.getElementById('row-single-account');
const rowTransferAccounts = document.getElementById('row-transfer-accounts');
const rowTransferTarget = document.getElementById('row-transfer-target');
const rowCategory = document.getElementById('row-category');

btnExpense.addEventListener('click', () => setType('expense'));
btnIncome.addEventListener('click', () => setType('income'));
btnTransfer.addEventListener('click', () => setType('transfer'));

function setType(type) {
  currentType = type;
  btnExpense.classList.toggle('active', type === 'expense');
  btnIncome.classList.toggle('active', type === 'income');
  btnTransfer.classList.toggle('active', type === 'transfer');
  if (type === 'transfer') {
    rowSingleAccount.style.display = 'none';
    rowTransferAccounts.style.display = 'flex';
    rowTransferTarget.style.display = 'flex';
    rowCategory.style.display = 'none';
    customCategoryInput.style.display = 'none';
    document.getElementById('bind-tip-box').style.display = 'none';
    document.getElementById('account').required = false;
    document.getElementById('from-account').required = true;
    document.getElementById('to-account').required = true;
    document.getElementById('amount').placeholder = "轉出金額";
    autoCalculateTransferToAmount();
  } else {
    rowSingleAccount.style.display = 'flex';
    rowTransferAccounts.style.display = 'none';
    rowTransferTarget.style.display = 'none';
    rowCategory.style.display = 'flex';
    document.getElementById('account').required = true;
    document.getElementById('from-account').required = false;
    document.getElementById('to-account').required = false;
    document.getElementById('amount').placeholder = "金額";
    checkAccountAutoBind();
  }
}

filterMonthInput.addEventListener('change', renderApp);
document.getElementById('sort-order').addEventListener('change', renderApp);

document.getElementById('transaction-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const recordDate = dateInput.value;
  const currency = document.getElementById('currency').value;
  const amount = parseFloat(parseFloat(document.getElementById('amount').value).toFixed(2));
  const note = document.getElementById('note').value.trim();
  const editId = document.getElementById('edit-record-id').value;

  if (!recordDate || isNaN(amount) || amount <= 0) {
    alert('請輸入有效的日期與金額！');
    return;
  }

  let accountVal = '', fromAccountVal = '', toAccountVal = '', finalCategory = '';
  let fromCurr = currency, fromAmt = amount, toCurr = currency, toAmt = amount;

  if (currentType === 'transfer') {
    fromAccountVal = document.getElementById('from-account').value;
    toAccountVal = document.getElementById('to-account').value;
    if (!fromAccountVal || !toAccountVal || fromAccountVal === toAccountVal) {
      alert('請選擇正確且不同的轉出與轉入帳戶！');
      return;
    }
    toCurr = document.getElementById('to-currency').value;
    toAmt = parseFloat(parseFloat(document.getElementById('to-amount').value).toFixed(2));
    if (isNaN(toAmt) || toAmt <= 0) {
      alert('請輸入有效的轉入金額！');
      return;
    }
    finalCategory = '⇄ 內部轉帳/還款';
  } else {
    accountVal = document.getElementById('account').value;
    if (!accountVal || !selectedCategoryValue) {
      alert('請選擇帳戶與類別！');
      return;
    }
    if (selectedCategoryValue === 'other' || selectedCategoryValue === '其他') {
      const customVal = customCategoryInput.value.trim();
      if (customVal) {
        finalCategory = `🏷️ ${customVal}`;
        let customCats = loadCustomCategories();
        if (!customCats.includes(customVal)) {
          customCats.push(customVal);
          saveCustomCategories(customCats);
        }
      } else {
        finalCategory = '🏷️ 其他';
      }
    } else {
      finalCategory = selectedCategoryValue;
    }
  }

  const records = loadRecords();

  if (editId) {
    const index = records.findIndex(item => item.id === editId);
    if (index !== -1) {
      records[index] = {
        ...records[index],
        type: currentType,
        date: recordDate,
        currency: currency,
        amount: amount,
        fromCurrency: fromCurr,
        fromAmount: fromAmt,
        toCurrency: toCurr,
        toAmount: toAmt,
        account: accountVal,
        actualAccount: getActualAccount(accountVal),
        fromAccount: fromAccountVal,
        actualFromAccount: getActualAccount(fromAccountVal),
        toAccount: toAccountVal,
        actualToAccount: getActualAccount(toAccountVal),
        category: finalCategory,
        note: note
      };
    }
    cancelEditRecord();
  } else {
    const newRecord = {
      id: Date.now().toString(),
      type: currentType,
      date: recordDate,
      currency: currency,
      amount: amount,
      fromCurrency: fromCurr,
      fromAmount: fromAmt,
      toCurrency: toCurr,
      toAmount: toAmt,
      account: accountVal,
      actualAccount: getActualAccount(accountVal),
      fromAccount: fromAccountVal,
      actualFromAccount: getActualAccount(fromAccountVal),
      toAccount: toAccountVal,
      actualToAccount: getActualAccount(toAccountVal),
      category: finalCategory,
      note: note,
      timestamp: Date.now()
    };
    records.push(newRecord);
    document.getElementById('amount').value = '';
    document.getElementById('to-amount').value = '';
    document.getElementById('note').value = '';
    customCategoryInput.value = '';
    customCategoryInput.style.display = 'none';
    selectedCategoryValue = '';
    renderCategoryGrid();
  }

  saveRecords(records);
  renderApp(); 
});

function editRecord(id) {
  const records = loadRecords();
  const item = records.find(r => r.id === id);
  if (!item) return;

  document.getElementById('edit-record-id').value = item.id;
  document.getElementById('form-card-title').innerHTML = '✏️ 修改記帳紀錄';
  document.getElementById('btn-submit-record').textContent = '確認修改';
  document.getElementById('btn-cancel-edit').style.display = 'block';

  setType(item.type || 'expense');
  dateInput.value = item.date || today.toISOString().split('T')[0];
  
  const curr = item.currency || item.fromCurrency || 'MOP';
  document.getElementById('currency').value = curr;
  document.getElementById('amount').value = item.fromAmount !== undefined ? item.fromAmount : item.amount;
  document.getElementById('note').value = item.note || '';

  if (item.type === 'transfer') {
    document.getElementById('from-account').value = item.fromAccount || '';
    document.getElementById('to-account').value = item.toAccount || '';
    document.getElementById('to-currency').value = item.toCurrency || curr;
    document.getElementById('to-amount').value = item.toAmount !== undefined ? item.toAmount : item.amount;
  } else {
    document.getElementById('account').value = item.account || '';
    checkAccountAutoBind();
    
    let catClean = item.category ? item.category.replace(/^[^\w\u4e00-\u9fa5]+/, '').trim() : '';
    selectedCategoryValue = catClean;
    
    const defaultCategories = ['餐飲', '交通', '購物', '娛樂', '居住', '母嬰', '保險費', '學貸', '生活費', '薪資', '其他'];
    if (!defaultCategories.includes(catClean) && catClean !== '其他') {
      let customCats = loadCustomCategories();
      if (!customCats.includes(catClean)) {
        customCats.push(catClean);
        saveCustomCategories(customCats);
      }
      selectedCategoryValue = catClean;
      customCategoryInput.style.display = 'block';
      customCategoryInput.value = catClean;
    } else {
      customCategoryInput.style.display = 'none';
      customCategoryInput.value = '';
    }
    renderCategoryGrid();
  }

  document.getElementById('transaction-form').scrollIntoView({ behavior: 'smooth' });
}

function cancelEditRecord() {
  document.getElementById('edit-record-id').value = '';
  document.getElementById('form-card-title').innerHTML = '✏️ 新增記帳';
  document.getElementById('btn-submit-record').textContent = '儲存紀錄';
  document.getElementById('btn-cancel-edit').style.display = 'none';
  document.getElementById('transaction-form').reset();
  dateInput.value = today.toISOString().split('T')[0];
  setType('expense');
  selectedCategoryValue = '';
  customCategoryInput.style.display = 'none';
  renderCategoryGrid();
}

function deleteRecord(id) {
  const records = loadRecords().filter(item => item.id !== id);
  saveRecords(records);
}

function calculateAntBankInterestDailyDetails(baseBalances, records) {
  let initialMop = baseBalances['澳門螞蟻銀行'] ? (baseBalances['澳門螞蟻銀行']['MOP'] || 0) : 0;
  let sortedRecords = [...records].sort((a, b) => new Date(a.date) - new Date(b.date) || a.timestamp - b.timestamp);
  
  let interestStartDate = new Date('2026-07-30');
  interestStartDate.setHours(0, 0, 0, 0);

  let firstRecordDate = sortedRecords.length > 0 ? new Date(sortedRecords[0].date) : new Date();
  firstRecordDate.setHours(0, 0, 0, 0);

  let startDate = firstRecordDate < interestStartDate ? interestStartDate : firstRecordDate;
  let todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  if (startDate > todayDate) return { totalInterest: 0, dailyDetails: [] };
  
  let currentMop = initialMop, totalInterest = 0, dailyChanges = {};
  
  records.forEach(item => {
    if (item.actualAccount === '澳門螞蟻銀行' || item.actualFromAccount === '澳門螞蟻銀行' || item.actualToAccount === '澳門螞蟻銀行') {
      let d = item.date;
      if (!dailyChanges[d]) dailyChanges[d] = { income: 0, expense: 0, transferIn: 0, transferOut: 0 };
      
      let mopValFrom = convertToMOP(item.fromAmount !== undefined ? item.fromAmount : item.amount, item.fromCurrency || item.currency);
      let mopValTo = convertToMOP(item.toAmount !== undefined ? item.toAmount : item.amount, item.toCurrency || item.currency);

      if (item.type === 'income' && item.actualAccount === '澳門螞蟻銀行') dailyChanges[d].income += mopValFrom;
      if ((item.type === 'expense' || !item.type) && item.actualAccount === '澳門螞蟻銀行') dailyChanges[d].expense += mopValFrom;
      if (item.type === 'transfer') {
        if (item.actualFromAccount === '澳門螞蟻銀行') dailyChanges[d].transferOut += mopValFrom;
        if (item.actualToAccount === '澳門螞蟻銀行') dailyChanges[d].transferIn += mopValTo;
      }
    }
  });

  let iterDate = new Date(firstRecordDate);
  while (iterDate < startDate) {
    let dStr = iterDate.toISOString().split('T')[0];
    if (dailyChanges[dStr]) {
      currentMop += dailyChanges[dStr].income + dailyChanges[dStr].transferIn - dailyChanges[dStr].expense - dailyChanges[dStr].transferOut;
    }
    iterDate.setDate(iterDate.getDate() + 1);
  }
  
  let dailyDetails = [];
  iterDate = new Date(startDate);
  while (iterDate <= todayDate) {
    let dStr = iterDate.toISOString().split('T')[0];
    
    if (dailyChanges[dStr]) {
      currentMop += dailyChanges[dStr].income + dailyChanges[dStr].transferIn - dailyChanges[dStr].expense - dailyChanges[dStr].transferOut;
    }

    if (currentMop > 0) {
      let dailyInterest = currentMop * (0.02 / 365);
      if (dailyInterest > 0) {
        totalInterest += dailyInterest;
        dailyDetails.push({
          id: `interest-${dStr}`,
          type: 'income',
          date: dStr,
          currency: 'MOP',
          amount: parseFloat(dailyInterest.toFixed(2)),
          category: '💰 存款利息收入 (2%)',
          note: `昨天結餘 MOP$ ${formatMoney(currentMop)} × 2% / 365`,
          timestamp: new Date(dStr).getTime() + 99999
        });
        currentMop += dailyInterest;
      }
    }
    iterDate.setDate(iterDate.getDate() + 1);
  }
  totalInterest = parseFloat(totalInterest.toFixed(2));
  return { totalInterest, dailyDetails };
}

function calculateBankBalancesFromRecords() {
  const records = loadRecords();
  const baseBalances = loadBankBaseBalances();
  const calculated = JSON.parse(JSON.stringify(baseBalances));
  const bankList = getBankList();
  
  records.forEach(item => {
    const fromCurr = item.fromCurrency || item.currency;
    const fromAmt = item.fromAmount !== undefined ? item.fromAmount : item.amount;
    const toCurr = item.toCurrency || item.currency;
    const toAmt = item.toAmount !== undefined ? item.toAmount : item.amount;

    if (item.type === 'income') {
      const b = item.actualAccount;
      if (bankList.includes(b)) {
        if (!calculated[b]) calculated[b] = { MOP: 0, HKD: 0, CNY: 0 };
        calculated[b][fromCurr] = parseFloat(((calculated[b][fromCurr] || 0) + fromAmt).toFixed(2));
      }
    } else if (item.type === 'expense' || !item.type) {
      const b = item.actualAccount;
      if (bankList.includes(b)) {
        if (!calculated[b]) calculated[b] = { MOP: 0, HKD: 0, CNY: 0 };
        calculated[b][fromCurr] = parseFloat(((calculated[b][fromCurr] || 0) - fromAmt).toFixed(2));
      }
    } else if (item.type === 'transfer') {
      const fromB = item.actualFromAccount, toB = item.actualToAccount;
      if (bankList.includes(fromB)) {
        if (!calculated[fromB]) calculated[fromB] = { MOP: 0, HKD: 0, CNY: 0 };
        calculated[fromB][fromCurr] = parseFloat(((calculated[fromB][fromCurr] || 0) - fromAmt).toFixed(2));
      }
      if (bankList.includes(toB)) {
        if (!calculated[toB]) calculated[toB] = { MOP: 0, HKD: 0, CNY: 0 };
        calculated[toB][toCurr] = parseFloat(((calculated[toB][toCurr] || 0) + toAmt).toFixed(2));
      }
    }
  });

  const antInterestData = calculateAntBankInterestDailyDetails(baseBalances, records);
  if (!calculated['澳門螞蟻銀行']) calculated['澳門螞蟻銀行'] = { MOP: 0, HKD: 0, CNY: 0 };
  calculated['澳門螞蟻銀行']['MOP'] = parseFloat(((calculated['澳門螞蟻銀行']['MOP'] || 0) + antInterestData.totalInterest).toFixed(2));
  calculated['澳門螞蟻銀行']._accruedInterest = antInterestData.totalInterest;
  return calculated;
}

function calculateCreditBalancesFromRecords() {
  const records = loadRecords();
  const baseBalances = loadCreditBaseBalances();
  const calculated = JSON.parse(JSON.stringify(baseBalances));

  records.forEach(item => {
    const fromCurr = item.fromCurrency || item.currency;
    const fromAmt = item.fromAmount !== undefined ? item.fromAmount : item.amount;
    const toCurr = item.toCurrency || item.currency;
    const toAmt = item.toAmount !== undefined ? item.toAmount : item.amount;

    if ((item.type === 'expense' || !item.type)) {
      const cr = item.actualAccount;
      if (CREDIT_LIST.includes(cr)) {
        if (!calculated[cr]) calculated[cr] = { MOP: 0, HKD: 0, CNY: 0 };
        calculated[cr][fromCurr] = parseFloat(((calculated[cr][fromCurr] || 0) + fromAmt).toFixed(2));
      }
    } else if (item.type === 'transfer') {
      const toCr = item.actualToAccount;
      if (CREDIT_LIST.includes(toCr)) {
        if (!calculated[toCr]) calculated[toCr] = { MOP: 0, HKD: 0, CNY: 0 };
        calculated[toCr][toCurr] = parseFloat(((calculated[toCr][toCurr] || 0) - toAmt).toFixed(2));
      }
      const fromCr = item.actualFromAccount;
      if (CREDIT_LIST.includes(fromCr)) {
        if (!calculated[fromCr]) calculated[fromCr] = { MOP: 0, HKD: 0, CNY: 0 };
        calculated[fromCr][fromCurr] = parseFloat(((calculated[fromCr][fromCurr] || 0) + fromAmt).toFixed(2));
      }
    }
  });
  return calculated;
}

function renderApp() {
  const records = loadRecords();
  renderCategoryGrid();
  updateFilterCategoryDropdown(records);
  updateBankDropdowns();
  renderMonthlySection(records);
  populateYearDropdown(records);
  renderYearlySummary();
  renderBankSummary();
  renderCreditSection();
  renderMPFSection();
  renderAssetSection();
}

function updateBankDropdowns() {
  const bankList = getBankList();
  const bankOptGroup = document.getElementById('account-bank-options');
  if (bankOptGroup) {
    let html = '';
    bankList.forEach(b => html += `<option value="${b}">${b}</option>`);
    bankOptGroup.innerHTML = html;
  }

  ['from-account', 'to-account', 'filter-account-monthly', 'bank-flow-select'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const currentVal = el.value;
    
    if (id === 'bank-flow-select') {
      let html = '';
      bankList.forEach(b => html += `<option value="${b}">${b.replace('澳門', '').replace('香港', '')}</option>`);
      el.innerHTML = html;
      if (bankList.includes(currentVal)) el.value = currentVal;
    } else if (id === 'filter-account-monthly') {
      let html = `<option value="ALL">全部支出戶口</option><option value="MPay">MPay</option><option value="BOC Pay">BOC Pay</option>`;
      bankList.forEach(b => html += `<option value="${b}">${b}</option>`);
      CREDIT_LIST.forEach(c => html += `<option value="${c}">${c}</option>`);
      el.innerHTML = html;
      el.value = currentVal;
    } else {
      let html = `<option value="" disabled selected>${id === 'from-account' ? '轉出戶口' : '轉入戶口'}</option><option value="MPay">MPay</option><option value="BOC Pay">BOC Pay</option>`;
      bankList.forEach(b => html += `<option value="${b}">${b.replace('澳門', '').replace('香港', '')}</option>`);
      CREDIT_LIST.forEach(c => html += `<option value="${c}">${c}</option>`);
      el.innerHTML = html;
      el.value = currentVal;
    }
  });
}

function updateFilterCategoryDropdown(records) {
  const filterCatSelect = document.getElementById('filter-category');
  const currentVal = filterCatSelect.value;
  const defaultCats = ['餐飲', '交通', '購物', '娛樂', '居住', '母嬰', '保險費', '學貸', '生活費', '薪資', '其他'];
  const customCats = loadCustomCategories();
  const setOfCats = new Set(defaultCats);
  customCats.forEach(c => setOfCats.add(c));
  records.forEach(r => {
    if (r.category) {
      let cleanCat = r.category.replace(/^[^\w\u4e00-\u9fa5]+/, '').trim();
      if (cleanCat) setOfCats.add(cleanCat);
      setOfCats.add(r.category);
    }
  });

  let html = '<option value="ALL">全部類別</option>';
  Array.from(setOfCats).sort().forEach(c => html += `<option value="${c}">${c}</option>`);
  filterCatSelect.innerHTML = html;
  if (currentVal && Array.from(setOfCats).includes(currentVal)) { filterCatSelect.value = currentVal; }
}

function renderMonthlySection(records) {
  const listContainer = document.getElementById('transaction-list');
  const sortOrder = document.getElementById('sort-order').value;
  const selectedMonthVal = filterMonthInput.value;
  const filterCatVal = document.getElementById('filter-category').value;
  const filterAccVal = document.getElementById('filter-account-monthly').value;

  let filteredRecords = records;
  if (selectedMonthVal) {
    const [sYear, sMonth] = selectedMonthVal.split('-').map(Number);
    filteredRecords = records.filter(item => {
      if (!item.date) return false;
      const [iYear, iMonth] = item.date.split('-').map(Number);
      return iYear === sYear && iMonth === sMonth;
    });
  }

  if (filterCatVal && filterCatVal !== 'ALL') {
    filteredRecords = filteredRecords.filter(item => {
      if (!item.category) return false;
      let cleanCat = item.category.replace(/^[^\w\u4e00-\u9fa5]+/, '').trim();
      return item.category === filterCatVal || cleanCat === filterCatVal;
    });
  }

  if (filterAccVal && filterAccVal !== 'ALL') {
    filteredRecords = filteredRecords.filter(item => {
      if (item.type === 'transfer') {
        return item.fromAccount === filterAccVal || item.toAccount === filterAccVal || item.actualFromAccount === filterAccVal || item.actualToAccount === filterAccVal;
      } else {
        return item.account === filterAccVal || item.actualAccount === filterAccVal;
      }
    });
  }

  const items = [...filteredRecords].sort((a, b) => {
    const dateA = new Date(a.date), dateB = new Date(b.date);
    return sortOrder === 'asc' ? (dateA - dateB || a.timestamp - b.timestamp) : (dateB - dateA || b.timestamp - a.timestamp);
  });

  if (items.length === 0) {
    listContainer.innerHTML = '<div class="empty-state">當月尚無符合條件的紀錄</div>';
    document.getElementById('record-count').textContent = '0 筆';
  } else {
    let html = '';
    items.forEach(item => {
      const fromCurr = item.fromCurrency || item.currency;
      const fromAmt = item.fromAmount !== undefined ? item.fromAmount : item.amount;
      const toCurr = item.toCurrency || item.currency;
      const toAmt = item.toAmount !== undefined ? item.toAmount : item.amount;

      const mopValue = convertToMOP(fromAmt, fromCurr);
      const mopConvertedText = fromCurr !== 'MOP' ? `<div class="mop-converted">(≈ MOP$ ${formatMoney(mopValue)})</div>` : '';
      let typeClass = item.type || 'expense';
      let amountPrefix = item.type === 'income' ? '+' : (item.type === 'transfer' ? '⇄ ' : '-');
      
      let accountSubTag = `<span class="tag">💳 ${item.account}</span>`;
      if (BINDING_MAP[item.account]) accountSubTag += ` <span class="tag bank-deduct">🏛️ 扣: ${BINDING_MAP[item.account]}</span>`;
      if (CREDIT_LIST.includes(item.account)) accountSubTag = `<span class="tag credit-tag">💳 信用卡: ${item.account}</span>`;
      if (typeClass === 'transfer') accountSubTag = `<span class="tag transfer-tag">💳 ${item.fromAccount} ➔ ${item.toAccount}</span>`;
      
      let displayAmtStr = `${amountPrefix}${fromCurr} $${formatMoney(fromAmt)}`;
      if (typeClass === 'transfer' && (fromCurr !== toCurr || fromAmt !== toAmt)) {
        displayAmtStr = `${fromCurr} $${formatMoney(fromAmt)} ➔ ${toCurr} $${formatMoney(toAmt)}`;
      }

      html += `
        <div class="item ${typeClass}">
          <div class="item-info">
            <div class="title">${item.category} ${item.note ? `<span>(${item.note})</span>` : ''}</div>
            <div class="sub"><span>📅 ${item.date}</span> ${accountSubTag}</div>
          </div>
          <div class="item-amount">
            <div class="item-amount-row">
              <span class="amount-text">${displayAmtStr}</span>
              <button class="btn-edit" onclick="editRecord('${item.id}')" title="修改">✎</button>
              <button class="btn-delete" onclick="deleteRecord('${item.id}')" title="刪除">✕</button>
            </div>
            ${mopConvertedText}
          </div>
        </div>
      `;
    });
    listContainer.innerHTML = html;
    document.getElementById('record-count').textContent = `${items.length} 筆`;
  }
  renderMonthSummary(records);
  renderCategoryAnalysis(records, selectedMonthVal);
}

function renderMonthSummary(items) {
  const selectedMonthVal = filterMonthInput.value;
  if (!selectedMonthVal) return;
  const [sYear, sMonth] = selectedMonthVal.split('-').map(Number);
  let monthIncomeMOP = 0, monthExpenseMOP = 0;
  
  let monthActualIncomeMOP = 0;
  let monthActualExpenseMOP = 0;
  let monthCreditRepayMOP = 0;

  items.forEach(item => {
    if (!item.date) return;
    const [iYear, iMonth] = item.date.split('-').map(Number);
    if (iYear === sYear && iMonth === sMonth) {
      const fromCurr = item.fromCurrency || item.currency;
      const fromAmt = item.fromAmount !== undefined ? item.fromAmount : item.amount;
      const mopValue = convertToMOP(fromAmt, fromCurr);

      if (item.type === 'income') {
        monthIncomeMOP += mopValue;
        monthActualIncomeMOP += mopValue;
      }
      if (item.type === 'expense' || !item.type) {
        monthExpenseMOP += mopValue;
        monthActualExpenseMOP += mopValue;
      }

      if (item.type === 'transfer' && CREDIT_LIST.includes(item.actualToAccount)) {
        const toCurr = item.toCurrency || item.currency;
        const toAmt = item.toAmount !== undefined ? item.toAmount : item.amount;
        const transferToMop = convertToMOP(toAmt, toCurr);
        monthCreditRepayMOP += transferToMop;
      }
    }
  });

  monthActualExpenseMOP = monthExpenseMOP + monthCreditRepayMOP;

  const monthBalanceMOP = monthIncomeMOP - monthExpenseMOP;
  document.getElementById('month-net-balance').textContent = `MOP$ ${formatMoney(monthBalanceMOP)}`;
  document.getElementById('month-income').textContent = `+MOP$ ${formatMoney(monthIncomeMOP)}`;
  document.getElementById('month-expense').textContent = `-MOP$ ${formatMoney(monthExpenseMOP)}`;
  
  const daysInMonth = new Date(sYear, sMonth, 0).getDate();
  document.getElementById('month-daily-avg').textContent = `MOP$ ${formatMoney(monthExpenseMOP / daysInMonth)}/日`;

  const monthActualNetBalance = monthActualIncomeMOP - monthActualExpenseMOP;
  document.getElementById('month-actual-net-balance').textContent = `MOP$ ${formatMoney(monthActualNetBalance)}`;
  document.getElementById('month-actual-income').textContent = `+MOP$ ${formatMoney(monthActualIncomeMOP)}`;
  document.getElementById('month-actual-expense').textContent = `-MOP$ ${formatMoney(monthActualExpenseMOP)}`;
  document.getElementById('month-actual-repay').textContent = `-MOP$ ${formatMoney(monthCreditRepayMOP)}`;
}

function renderCategoryAnalysis(records, selectedMonthVal) {
  const container = document.getElementById('category-analysis-list');
  if (!selectedMonthVal) { container.innerHTML = '<div class="empty-state">請選擇月份</div>'; return; }
  const [sYear, sMonth] = selectedMonthVal.split('-').map(Number);
  let categoryMap = {}, totalExpenseMOP = 0;
  records.forEach(item => {
    if (!item.date) return;
    const [iYear, iMonth] = item.date.split('-').map(Number);
    if (iYear === sYear && iMonth === sMonth && (item.type === 'expense' || !item.type)) {
      const cat = item.category || '🏷️ 其他';
      const mopValue = convertToMOP(item.fromAmount !== undefined ? item.fromAmount : item.amount, item.fromCurrency || item.currency);
      categoryMap[cat] = (categoryMap[cat] || 0) + mopValue;
      totalExpenseMOP += mopValue;
    }
  });
  const sortedCats = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
  if (sortedCats.length === 0) { container.innerHTML = '<div class="empty-state">該月份尚無支出紀錄</div>'; return; }
  let html = '';
  sortedCats.forEach(([cat, amt]) => {
    const percentage = totalExpenseMOP > 0 ? ((amt / totalExpenseMOP) * 100).toFixed(2) : '0.00';
    html += `
      <div class="cat-progress-item">
        <div class="cat-progress-info"><span>${cat}</span><span>MOP$ ${formatMoney(amt)} (${percentage}%)</span></div>
        <div class="cat-progress-bar-bg"><div class="cat-progress-bar-fill" style="width: ${percentage}%;"></div></div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function populateYearDropdown(records) {
  const yearSelect = document.getElementById('filter-year');
  const existingVal = yearSelect.value;
  const yearsSet = new Set([currentYear]);
  records.forEach(item => { if (item.date) yearsSet.add(parseInt(item.date.split('-')[0], 10)); });
  yearSelect.innerHTML = '';
  Array.from(yearsSet).sort((a, b) => b - a).forEach(yr => {
    const opt = document.createElement('option');
    opt.value = yr; opt.textContent = `${yr} 年`;
    yearSelect.appendChild(opt);
  });
  if (existingVal && yearsSet.has(parseInt(existingVal, 10))) yearSelect.value = existingVal;
}

function renderYearlySummary() {
  const selectedYear = parseInt(document.getElementById('filter-year').value, 10) || currentYear;
  const records = loadRecords();
  let yearlyIncome = 0, yearlyExpense = 0, monthlyDataMap = {}, yearlyCategoryMap = {};
  for (let m = 1; m <= 12; m++) {
    monthlyDataMap[`${selectedYear}-${String(m).padStart(2, '0')}`] = { income: 0, expense: 0 };
  }
  records.forEach(item => {
    if (!item.date) return;
    const [iYear, iMonth] = item.date.split('-').map(Number);
    if (iYear === selectedYear) {
      const mopValue = convertToMOP(item.fromAmount !== undefined ? item.fromAmount : item.amount, item.fromCurrency || item.currency);
      const mKey = `${iYear}-${String(iMonth).padStart(2, '0')}`;
      if (!monthlyDataMap[mKey]) monthlyDataMap[mKey] = { income: 0, expense: 0 };
      if (item.type === 'income') { yearlyIncome += mopValue; monthlyDataMap[mKey].income += mopValue; }
      if (item.type === 'expense' || !item.type) {
        yearlyExpense += mopValue; monthlyDataMap[mKey].expense += mopValue;
        const cat = item.category || '🏷️ 其他';
        yearlyCategoryMap[cat] = (yearlyCategoryMap[cat] || 0) + mopValue;
      }
    }
  });
  const yearlyNet = yearlyIncome - yearlyExpense;
  document.getElementById('year-net-balance').textContent = `MOP$ ${formatMoney(yearlyNet)}`;
  document.getElementById('year-income').textContent = `+MOP$ ${formatMoney(yearlyIncome)}`;
  document.getElementById('year-expense').textContent = `-MOP$ ${formatMoney(yearlyExpense)}`;
  document.getElementById('year-monthly-avg-expense').textContent = `MOP$ ${formatMoney(yearlyExpense / 12)}/月`;
  const savingsRate = yearlyIncome > 0 ? (((yearlyIncome - yearlyExpense) / yearlyIncome) * 100).toFixed(2) : '0.00';
  document.getElementById('year-savings-rate').textContent = `${savingsRate}%`;
  
  let monthsHtml = '';
  Object.keys(monthlyDataMap).sort().forEach(mKey => {
    const mData = monthlyDataMap[mKey], mNet = mData.income - mData.expense;
    monthsHtml += `
      <tr>
        <td>${mKey}</td>
        <td style="color:var(--income);">+${formatMoney(mData.income)}</td>
        <td style="color:var(--expense);">-${formatMoney(mData.expense)}</td>
        <td><span class="${mNet >= 0 ? 'mpf-diff-positive' : 'mpf-diff-negative'}">${formatMoney(mNet)}</span></td>
      </tr>
    `;
  });
  document.getElementById('yearly-months-tbody').innerHTML = monthsHtml;
  
  const yearlyCatContainer = document.getElementById('yearly-category-analysis-list');
  const sortedYearlyCats = Object.entries(yearlyCategoryMap).sort((a, b) => b[1] - a[1]);
  if (sortedYearlyCats.length === 0) {
    yearlyCatContainer.innerHTML = '<div class="empty-state">該年度尚無支出紀錄</div>';
  } else {
    let catHtml = '';
    sortedYearlyCats.forEach(([cat, amt]) => {
      const percentage = yearlyExpense > 0 ? ((amt / yearlyExpense) * 100).toFixed(2) : '0.00';
      catHtml += `
        <div class="cat-progress-item">
          <div class="cat-progress-info"><span>${cat}</span><span>MOP$ ${formatMoney(amt)} (${percentage}%)</span></div>
          <div class="cat-progress-bar-bg"><div class="cat-progress-bar-fill" style="width: ${percentage}%;"></div></div>
        </div>
      `;
    });
    yearlyCatContainer.innerHTML = catHtml;
  }
}

function addNewBankAccount() {
  const inputEl = document.getElementById('new-bank-name');
  const name = inputEl.value.trim();
  if (!name) { alert('請輸入銀行名稱'); return; }
  if (!cloudData.customBankList) cloudData.customBankList = [];
  if (getBankList().includes(name)) { alert('該銀行名稱已存在！'); return; }
  
  cloudData.customBankList.push(name);
  if (!cloudData.bankBaseBalances[name]) {
    cloudData.bankBaseBalances[name] = { MOP: 0, HKD: 0, CNY: 0 };
  }
  syncToFirebase();
  inputEl.value = '';
  renderApp();
}

function deleteBankAccount(bankName) {
  if (!confirm(`確定要刪除銀行戶口「${bankName}」嗎？`)) return;
  cloudData.customBankList = (cloudData.customBankList || []).filter(b => b !== bankName);
  if (cloudData.bankBaseBalances[bankName]) { delete cloudData.bankBaseBalances[bankName]; }
  syncToFirebase();
  renderApp();
}

function renderBankSummary() {
  const calculatedBanks = calculateBankBalancesFromRecords();
  let grandTotalMOP = 0;
  let totalMopAll = 0, totalHkdAll = 0, totalCnyAll = 0;
  let editorHtml = '';
  const bankList = getBankList();

  bankList.forEach(bankName => {
    const currMap = calculatedBanks[bankName] || { MOP: 0, HKD: 0, CNY: 0 };
    let bankMopSum = 0, currGridHtml = '';
    
    totalMopAll += (currMap['MOP'] || 0);
    totalHkdAll += (currMap['HKD'] || 0);
    totalCnyAll += (currMap['CNY'] || 0);

    ['MOP', 'HKD', 'CNY'].forEach(c => {
      const val = currMap[c] || 0;
      bankMopSum += convertToMOP(val, c);
      currGridHtml += `<div class="curr-item"><span class="curr-name">${c}</span><span class="curr-val">${formatMoney(val)}</span></div>`;
    });
    grandTotalMOP += bankMopSum;
    let extraInfoHtml = (bankName === '澳門螞蟻銀行' && currMap._accruedInterest > 0) ? `<div class="interest-note">✨ 2%日計利息 (由2026-07-30起算) (≈ MOP$ ${formatMoney(currMap._accruedInterest)})</div>` : '';
    
    const isCustom = !DEFAULT_BANK_LIST.includes(bankName);
    const deleteBtnHtml = isCustom ? `<button class="btn-delete" onclick="deleteBankAccount('${bankName}')">✕</button>` : '';

    editorHtml += `
      <div class="bank-card">
        <div class="bank-card-title">
          <span>🏛️ ${bankName}</span>
          <div style="display:flex; align-items:center; gap:6px;">
            <span>總值: MOP$ ${formatMoney(bankMopSum)}</span>
            ${deleteBtnHtml}
          </div>
        </div>
        <div class="bank-currency-grid">${currGridHtml}</div>
        ${extraInfoHtml}
        <div class="bank-edit-group">
          <div class="bank-edit-row">
            <select id="bank-edit-curr-${bankName}"><option value="MOP">MOP</option><option value="HKD">HKD</option><option value="CNY">CNY</option></select>
            <input type="number" id="bank-edit-amt-${bankName}" placeholder="金額" step="0.01">
            <button type="button" class="btn-sm-save" onclick="updateBankBalance('${bankName}')">設定</button>
            <button type="button" class="btn-sm-add" onclick="adjustBankBalance('${bankName}', true)">增加</button>
            <button type="button" class="btn-sm-sub" onclick="adjustBankBalance('${bankName}', false)">扣減</button>
          </div>
        </div>
      </div>
    `;
  });

  document.getElementById('bank-total-balance').textContent = `MOP$ ${formatMoney(grandTotalMOP)}`;
  document.getElementById('bank-total-mop').textContent = `MOP$ ${formatMoney(totalMopAll)}`;
  document.getElementById('bank-total-hkd').textContent = `HK$ ${formatMoney(totalHkdAll)}`;
  document.getElementById('bank-total-cny').textContent = `CN¥ ${formatMoney(totalCnyAll)}`;
  document.getElementById('bank-accounts-editor-container').innerHTML = editorHtml;
  renderBankFlowList();
}

function updateBankBalance(bankName) {
  const curr = document.getElementById(`bank-edit-curr-${bankName}`).value;
  const inputVal = parseFloat(document.getElementById(`bank-edit-amt-${bankName}`).value);
  if (isNaN(inputVal)) { alert('請輸入有效金額'); return; }
  const baseBalances = loadBankBaseBalances();
  if (!baseBalances[bankName]) baseBalances[bankName] = { MOP: 0, HKD: 0, CNY: 0 };
  
  if (bankName === '澳門螞蟻銀行') {
    const currentCalculated = calculateBankBalancesFromRecords();
    const rawUserBase = inputVal - (currentCalculated._accruedInterest || 0);
    baseBalances[bankName][curr] = parseFloat(rawUserBase.toFixed(2));
  } else {
    baseBalances[bankName][curr] = parseFloat(inputVal.toFixed(2));
  }
  
  saveBankBaseBalances(baseBalances);
  renderApp();
}

function adjustBankBalance(bankName, isAdd) {
  const curr = document.getElementById(`bank-edit-curr-${bankName}`).value;
  const inputVal = parseFloat(document.getElementById(`bank-edit-amt-${bankName}`).value);
  if (isNaN(inputVal) || inputVal <= 0) { alert('請輸入有效金額'); return; }
  const baseBalances = loadBankBaseBalances();
  if (!baseBalances[bankName]) baseBalances[bankName] = { MOP: 0, HKD: 0, CNY: 0 };
  const currentVal = baseBalances[bankName][curr] || 0;
  baseBalances[bankName][curr] = parseFloat((currentVal + (isAdd ? inputVal : -inputVal)).toFixed(2));
  saveBankBaseBalances(baseBalances);
  renderApp();
}

function renderBankFlowList() {
  const container = document.getElementById('bank-transaction-list');
  const selectedBank = document.getElementById('bank-flow-select').value;
  const selectedCurr = document.getElementById('bank-flow-curr').value;
  const selectedMonth = document.getElementById('bank-flow-month').value;
  const records = loadRecords();
  const baseBalances = loadBankBaseBalances();
  const antInterestData = calculateAntBankInterestDailyDetails(baseBalances, records);

  let allFlows = [...records];
  if (selectedBank === '澳門螞蟻銀行') {
    allFlows = allFlows.concat(antInterestData.dailyDetails);
  }

  let filtered = allFlows.filter(item => {
    const matchesBank = item.account === selectedBank || item.actualAccount === selectedBank || 
                        item.fromAccount === selectedBank || item.actualFromAccount === selectedBank || 
                        item.toAccount === selectedBank || item.actualToAccount === selectedBank;
    if (!matchesBank) return false;

    if (selectedCurr !== 'ALL') {
      const itemCurr = item.currency || item.fromCurrency;
      if (itemCurr !== selectedCurr) return false;
    }

    if (selectedMonth && item.date) {
      const [iYear, iMonth] = item.date.split('-').map(Number);
      const [sYear, sMonth] = selectedMonth.split('-').map(Number);
      if (iYear !== sYear || iMonth !== sMonth) return false;
    }
    return true;
  }).sort((a, b) => new Date(b.date) - new Date(a.date) || b.timestamp - a.timestamp);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">該過濾條件下尚無銀行流水紀錄</div>';
    return;
  }

  let html = '';
  filtered.forEach(item => {
    const curr = item.currency || item.fromCurrency || 'MOP';
    const amt = item.fromAmount !== undefined ? item.fromAmount : item.amount;
    let prefix = item.type === 'income' ? '+' : '-';
    if (item.type === 'transfer') prefix = '⇄ ';
    
    html += `
      <div class="item ${item.type || 'expense'}">
        <div class="item-info">
          <div class="title">${item.category} ${item.note ? `<span>(${item.note})</span>` : ''}</div>
          <div class="sub"><span>📅 ${item.date}</span> <span class="tag">🏛️ ${selectedBank}</span></div>
        </div>
        <div class="item-amount">
          <span class="amount-text">${prefix}${curr} $${formatMoney(amt)}</span>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function renderCreditSection() {
  const calculatedCredits = calculateCreditBalancesFromRecords();
  let grandTotalMOP = 0, currentMonthSpendMOP = 0;
  let editorHtml = '';
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;

  CREDIT_LIST.forEach(cardName => {
    const currMap = calculatedCredits[cardName] || { MOP: 0, HKD: 0, CNY: 0 };
    let cardMopSum = 0, currGridHtml = '';
    ['MOP', 'HKD', 'CNY'].forEach(c => {
      const val = currMap[c] || 0;
      cardMopSum += convertToMOP(val, c);
      currGridHtml += `<div class="curr-item"><span class="curr-name">${c}</span><span class="curr-val">${formatMoney(val)}</span></div>`;
    });
    grandTotalMOP += cardMopSum;

    editorHtml += `
      <div class="bank-card" style="border-color: #FBCFE8;">
        <div class="credit-card-title">
          <span>💳 ${cardName}</span>
          <span>未清帳款: MOP$ ${formatMoney(cardMopSum)}</span>
        </div>
        <div class="bank-currency-grid">${currGridHtml}</div>
        <div class="bank-edit-group">
          <div class="bank-edit-row">
            <select id="credit-edit-curr-${cardName}"><option value="MOP">MOP</option><option value="HKD">HKD</option><option value="CNY">CNY</option></select>
            <input type="number" id="credit-edit-amt-${cardName}" placeholder="設定/修正結餘" step="0.01">
            <button type="button" class="btn-sm-save" style="background: var(--credit);" onclick="updateCreditBalance('${cardName}')">設定</button>
          </div>
        </div>
      </div>
    `;
  });

  const records = loadRecords();
  records.forEach(item => {
    if (!item.date) return;
    const [iY, iM] = item.date.split('-').map(Number);
    if (iY === curY && iM === curM && (item.type === 'expense' || !item.type) && CREDIT_LIST.includes(item.actualAccount)) {
      currentMonthSpendMOP += convertToMOP(item.fromAmount !== undefined ? item.fromAmount : item.amount, item.fromCurrency || item.currency);
    }
  });

  document.getElementById('credit-total-balance').textContent = `MOP$ ${formatMoney(grandTotalMOP)}`;
  document.getElementById('credit-month-spend').textContent = `MOP$ ${formatMoney(currentMonthSpendMOP)}`;
  document.getElementById('credit-cards-editor-container').innerHTML = editorHtml;
  renderCreditFlowList();
}

function updateCreditBalance(cardName) {
  const curr = document.getElementById(`credit-edit-curr-${cardName}`).value;
  const inputVal = parseFloat(document.getElementById(`credit-edit-amt-${cardName}`).value);
  if (isNaN(inputVal)) { alert('請輸入有效金額'); return; }
  const baseBalances = loadCreditBaseBalances();
  if (!baseBalances[cardName]) baseBalances[cardName] = { MOP: 0, HKD: 0, CNY: 0 };
  baseBalances[cardName][curr] = parseFloat(inputVal.toFixed(2));
  saveCreditBaseBalances(baseBalances);
  renderApp();
}

function renderCreditFlowList() {
  const container = document.getElementById('credit-transaction-list');
  const selectedCard = document.getElementById('credit-flow-select').value;
  const records = loadRecords();
  let filtered = records.filter(item => {
    const matchCard = selectedCard === 'ALL' ? CREDIT_LIST.includes(item.actualAccount) || CREDIT_LIST.includes(item.actualToAccount) : (item.actualAccount === selectedCard || item.actualToAccount === selectedCard);
    return matchCard;
  }).sort((a, b) => new Date(b.date) - new Date(a.date) || b.timestamp - a.timestamp);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">尚無信用卡消費或還款紀錄</div>';
    return;
  }

  let html = '';
  filtered.forEach(item => {
    const curr = item.currency || item.fromCurrency || 'MOP';
    const amt = item.fromAmount !== undefined ? item.fromAmount : item.amount;
    html += `
      <div class="item ${item.type || 'expense'}">
        <div class="item-info">
          <div class="title">${item.category} ${item.note ? `<span>(${item.note})</span>` : ''}</div>
          <div class="sub"><span>📅 ${item.date}</span> <span class="tag credit-tag">💳 ${item.account || item.toAccount}</span></div>
        </div>
        <div class="item-amount">
          <span class="amount-text">${item.type === 'transfer' ? '⇄ 還款' : '-'}${curr} $${formatMoney(amt)}</span>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function addMPFAccount() {
  const nameInput = document.getElementById('new-mpf-acc-name');
  const balInput = document.getElementById('new-mpf-acc-balance');
  const name = nameInput.value.trim();
  const balance = parseFloat(balInput.value);
  if (!name || isNaN(balance)) { alert('請輸入帳戶名稱與初始餘額'); return; }
  
  let accounts = loadMPFAccountsData();
  accounts.push({ id: Date.now().toString(), name: name, initialBalance: balance, balance: balance });
  saveMPFAccountsData(accounts);
  nameInput.value = ''; balInput.value = '';
  renderMPFSection();
}

function deleteMPFAccount(id) {
  if (!confirm('確定刪除此 MPF 帳戶嗎？')) return;
  let accounts = loadMPFAccountsData().filter(acc => acc.id !== id);
  saveMPFAccountsData(accounts);
  renderMPFSection();
}

function saveMPFMonthlyRecord() {
  const month = document.getElementById('mpf-rec-month').value;
  const accId = document.getElementById('mpf-rec-account').value;
  const balance = parseFloat(document.getElementById('mpf-rec-balance').value);
  const contrib = parseFloat(document.getElementById('mpf-rec-contrib').value) || 0;
  if (!month || !accId || isNaN(balance)) { alert('請填寫完整 MPF 月度結餘資訊'); return; }

  let records = loadMPFMonthlyRecordsData();
  records = records.filter(r => !(r.month === month && r.accountId === accId));
  records.push({ id: Date.now().toString(), month, accountId: accId, balance, contrib });
  saveMPFMonthlyRecordsData(records);
  document.getElementById('mpf-rec-balance').value = '';
  document.getElementById('mpf-rec-contrib').value = '';
  renderMPFSection();
}

function deleteMPFMonthlyRecord(id) {
  let records = loadMPFMonthlyRecordsData().filter(r => r.id !== id);
  saveMPFMonthlyRecordsData(records);
  renderMPFSection();
}

function renderMPFSection() {
  const accounts = loadMPFAccountsData();
  const monthlyRecords = loadMPFMonthlyRecordsData();
  
  let accSelectHtml = '<option value="" disabled selected>選擇 MPF 帳戶</option>';
  let accountsHtml = '';
  let totalMPFBal = 0;

  accounts.forEach(acc => {
    accSelectHtml += `<option value="${acc.id}">${acc.name}</option>`;
    totalMPFBal += acc.balance;
    accountsHtml += `
      <div class="item income">
        <div class="item-info">
          <div class="title">🛡️ ${acc.name}</div>
          <div class="sub"><span>初始/當前餘額</span></div>
        </div>
        <div class="item-amount" style="flex-direction:row; align-items:center; gap:6px;">
          <span class="amount-text">HK$ ${formatMoney(acc.balance)}</span>
          <button class="btn-delete" onclick="deleteMPFAccount('${acc.id}')">✕</button>
        </div>
      </div>
    `;
  });

  document.getElementById('mpf-rec-account').innerHTML = accSelectHtml;
  document.getElementById('mpf-accounts-container').innerHTML = accountsHtml || '<div class="empty-state">尚無 MPF 帳戶</div>';
  document.getElementById('mpf-account-count').textContent = `${accounts.length} 個`;
  document.getElementById('mpf-total-balance').textContent = `HK$ ${formatMoney(totalMPFBal)}`;

  let sortedRecords = [...monthlyRecords].sort((a, b) => a.month.localeCompare(b.month));
  let tableHtml = '';
  let latestGrowth = 0;
  let latestMonthLabel = '-';

  if (sortedRecords.length > 0) {
    latestMonthLabel = sortedRecords[sortedRecords.length - 1].month;
    sortedRecords.forEach((rec, idx) => {
      const acc = accounts.find(a => a.id === rec.accountId);
      const accName = acc ? acc.name : '未知帳戶';
      
      let prevRec = sortedRecords.slice(0, idx).reverse().find(r => r.accountId === rec.accountId);
      let diff = prevRec ? (rec.balance - prevRec.balance - rec.contrib) : 0;
      if (!prevRec) diff = rec.balance - (acc ? acc.initialBalance : 0);
      
      if (idx === sortedRecords.length - 1) latestGrowth = diff;

      tableHtml += `
        <tr>
          <td>${rec.month}</td>
          <td>${accName}</td>
          <td>HK$ ${formatMoney(rec.balance)}</td>
          <td>HK$ ${formatMoney(rec.contrib)}</td>
          <td><span class="${diff >= 0 ? 'mpf-diff-positive' : 'mpf-diff-negative'}">${diff >= 0 ? '+' : ''}${formatMoney(diff)}</span></td>
          <td><button class="btn-delete" onclick="deleteMPFMonthlyRecord('${rec.id}')">✕</button></td>
        </tr>
      `;
    });
  } else {
    tableHtml = '<tr><td colspan="6" class="empty-state">尚無變動紀錄</td></tr>';
  }

  document.getElementById('mpf-comparison-tbody').innerHTML = tableHtml;
  document.getElementById('mpf-month-growth').textContent = `HK$ ${formatMoney(latestGrowth)}`;
  document.getElementById('mpf-latest-month-label').textContent = latestMonthLabel;
}

function executeGlobalAssetDeduct() {
  const curr = document.getElementById('asset-deduct-curr').value;
  const amt = parseFloat(document.getElementById('asset-deduct-amt').value);
  const note = document.getElementById('asset-deduct-note').value.trim();
  if (isNaN(amt) || amt <= 0) { alert('請輸入有效扣減金額'); return; }

  let deductions = loadGlobalDeductions();
  deductions.push({ id: Date.now().toString(), date: today.toISOString().split('T')[0], currency: curr, amount: amt, note: note || '總資產扣減' });
  saveGlobalDeductions(deductions);
  document.getElementById('asset-deduct-amt').value = '';
  document.getElementById('asset-deduct-note').value = '';
  renderAssetSection();
}

function deleteGlobalDeduction(id) {
  let deductions = loadGlobalDeductions().filter(d => d.id !== id);
  saveGlobalDeductions(deductions);
  renderAssetSection();
}

function renderAssetSection() {
  const calculatedBanks = calculateBankBalancesFromRecords();
  let totalBankMOP = 0;
  
  let currencyTotals = { MOP: 0, HKD: 0, CNY: 0 };

  Object.keys(calculatedBanks).forEach(b => {
    const currMap = calculatedBanks[b];
    ['MOP', 'HKD', 'CNY'].forEach(c => {
      const val = currMap[c] || 0;
      currencyTotals[c] += val;
      totalBankMOP += convertToMOP(val, c);
    });
  });

  const mpfAccounts = loadMPFAccountsData();
  let totalMPFHKD = 0;
  mpfAccounts.forEach(acc => totalMPFHKD += acc.balance);
  const totalMPFMOP = convertToMOP(totalMPFHKD, 'HKD');
  
  currencyTotals['HKD'] += totalMPFHKD;

  let totalDeductionsMOP = 0;
  const deductions = loadGlobalDeductions();
  let deductHtml = '';
  deductions.forEach(d => {
    const mopVal = convertToMOP(d.amount, d.currency);
    totalDeductionsMOP += mopVal;
    currencyTotals[d.currency] -= d.amount;
    deductHtml += `
      <div class="item expense">
        <div class="item-info">
          <div class="title">📉 ${d.note}</div>
          <div class="sub"><span>📅 ${d.date}</span></div>
        </div>
        <div class="item-amount" style="flex-direction:row; align-items:center; gap:6px;">
          <span class="amount-text">-${d.currency} $${formatMoney(d.amount)}</span>
          <button class="btn-delete" onclick="deleteGlobalDeduction('${d.id}')">✕</button>
        </div>
      </div>
    `;
  });
  document.getElementById('asset-deductions-list').innerHTML = deductHtml || '<div class="empty-state">尚無扣減紀錄</div>';

  const grandTotalAssetMOP = totalBankMOP + totalMPFMOP - totalDeductionsMOP;

  document.getElementById('asset-grand-total').textContent = `MOP$ ${formatMoney(grandTotalAssetMOP)}`;
  document.getElementById('asset-bank-val').textContent = `MOP$ ${formatMoney(totalBankMOP)}`;
  document.getElementById('asset-mpf-val').textContent = `MOP$ ${formatMoney(totalMPFMOP)}`;

  let breakdownHtml = `
    <div class="cat-progress-item"><div class="cat-progress-info"><span>🏛️ 銀行存款總計</span><span>MOP$ ${formatMoney(totalBankMOP)}</span></div></div>
    <div class="cat-progress-item"><div class="cat-progress-info"><span>🛡️ 強積金總計 (折合)</span><span>MOP$ ${formatMoney(totalMPFMOP)}</span></div></div>
  `;
  document.getElementById('asset-breakdown-list').innerHTML = breakdownHtml;

  let ratioHtml = `
    <div class="cat-progress-item">
      <div class="cat-progress-info"><span>🏛️ 銀行存款佔比</span><span>${grandTotalAssetMOP > 0 ? ((totalBankMOP / grandTotalAssetMOP) * 100).toFixed(2) : 0}%</span></div>
      <div class="cat-progress-bar-bg"><div class="cat-progress-bar-fill" style="width: ${grandTotalAssetMOP > 0 ? (totalBankMOP / grandTotalAssetMOP) * 100 : 0}%;"></div></div>
    </div>
    <div class="cat-progress-item">
      <div class="cat-progress-info"><span>🛡️ 強積金佔比</span><span>${grandTotalAssetMOP > 0 ? ((totalMPFMOP / grandTotalAssetMOP) * 100).toFixed(2) : 0}%</span></div>
      <div class="cat-progress-bar-bg"><div class="cat-progress-bar-fill" style="background:var(--mpf); width: ${grandTotalAssetMOP > 0 ? (totalMPFMOP / grandTotalAssetMOP) * 100 : 0}%;"></div></div>
    </div>
  `;
  document.getElementById('asset-ratio-list').innerHTML = ratioHtml;

  let currDistHtml = '';
  let totalDistMOP = convertToMOP(currencyTotals['MOP'], 'MOP') + convertToMOP(currencyTotals['HKD'], 'HKD') + convertToMOP(currencyTotals['CNY'], 'CNY');
  ['MOP', 'HKD', 'CNY'].forEach(c => {
    let curMopVal = convertToMOP(currencyTotals[c], c);
    let pct = totalDistMOP > 0 ? ((curMopVal / totalDistMOP) * 100).toFixed(2) : '0.00';
    currDistHtml += `
      <div class="cat-progress-item">
        <div class="cat-progress-info"><span>${c} 總幣別 (${formatMoney(currencyTotals[c])})</span><span>MOP$ ${formatMoney(curMopVal)} (${pct}%)</span></div>
        <div class="cat-progress-bar-bg"><div class="cat-progress-bar-fill" style="background:var(--bank); width: ${pct}%;"></div></div>
      </div>
    `;
  });
  document.getElementById('asset-currency-distribution-list').innerHTML = currDistHtml;
}

function exportMonthCSV() {
  const selectedMonthVal = filterMonthInput.value;
  if (!selectedMonthVal) { alert('請選擇月份'); return; }
  const [sYear, sMonth] = selectedMonthVal.split('-').map(Number);
  const records = loadRecords();
  const filtered = records.filter(item => {
    if (!item.date) return false;
    const [iY, iM] = item.date.split('-').map(Number);
    return iY === sYear && iM === sMonth;
  });

  let csvContent = "\uFEFF日期,類型,分類,帳戶,金額,幣別,備註\n";
  filtered.forEach(r => {
    let tStr = r.type === 'income' ? '收入' : (r.type === 'transfer' ? '轉帳' : '支出');
    let accStr = r.type === 'transfer' ? `${r.fromAccount} -> ${r.toAccount}` : r.account;
    let amt = r.fromAmount !== undefined ? r.fromAmount : r.amount;
    let curr = r.fromCurrency || r.currency;
    csvContent += `"${r.date}","${tStr}","${r.category}","${accStr}","${amt}","${curr}","${r.note || ''}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `budget_${selectedMonthVal}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportYearCSV() {
  const selectedYear = parseInt(document.getElementById('filter-year').value, 10) || currentYear;
  const records = loadRecords();
  const filtered = records.filter(item => {
    if (!item.date) return false;
    return parseInt(item.date.split('-')[0], 10) === selectedYear;
  });

  let csvContent = "\uFEFF日期,類型,分類,帳戶,金額,幣別,備註\n";
  filtered.forEach(r => {
    let tStr = r.type === 'income' ? '收入' : (r.type === 'transfer' ? '轉帳' : '支出');
    let accStr = r.type === 'transfer' ? `${r.fromAccount} -> ${r.toAccount}` : r.account;
    let amt = r.fromAmount !== undefined ? r.fromAmount : r.amount;
    let curr = r.fromCurrency || r.currency;
    csvContent += `"${r.date}","${tStr}","${r.category}","${accStr}","${amt}","${curr}","${r.note || ''}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `budget_year_${selectedYear}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportJSONBackup() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cloudData, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `budget_backup_${today.toISOString().split('T')[0]}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function importJSONBackup(event) {
  const fileReader = new FileReader();
  if (event.target.files[0]) {
    fileReader.readAsText(event.target.files[0], "UTF-8");
    fileReader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (parsed && parsed.records) {
          if (confirm('確定要匯入此備份檔案嗎？這將覆蓋您當前的資料！')) {
            cloudData = parsed;
            syncToFirebase();
            renderApp();
            alert('備份匯入成功！');
          }
        } else {
          alert('檔案格式錯誤，無法識別記帳資料！');
        }
      } catch (err) {
        alert('解析 JSON 檔案失敗：' + err.message);
      }
    };
  }
}
