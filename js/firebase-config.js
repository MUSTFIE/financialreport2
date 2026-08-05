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
  mpfAccounts: [],
  mpfMonthlyRecords: [],
  customCategories: [],
  deletedDefaultCategories: []
};

const EXCHANGE_RATES = { MOP: 1.0, HKD: 1.0314, CNY: 1.13 };

function formatMoney(num) {
  if (isNaN(num)) return '0.00';
  return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function convertToMOP(amount, currency) {
  return amount * (EXCHANGE_RATES[currency] || 1.0);
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
