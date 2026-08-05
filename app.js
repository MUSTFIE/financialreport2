// ========== 資料管理 ==========
const STORAGE_KEY = 'accounting_records_v1';
const RATES_STORAGE_KEY = 'accounting_rates_v1';

// 預設匯率（轉成 MOP）— 約略參考 2026-08 匯率
// HKD 官方掛鉤 1 HKD = 1.03 MOP
// 1 CNY ≈ 1.196 MOP
const DEFAULT_RATES = {
  MOP: 1,
  HKD: 1.03,
  CNY: 1.196
};

// 分類圖示
const CATEGORY_ICONS = {
  '餐飲': '🍔',
  '交通': '🚗',
  '購物': '🛍️',
  '娛樂': '🎮',
  '居住': '🏠',
  '母嬰': '👶',
  '保險費': '🛡️',
  '學貸': '🎓',
  '生活費': '💵',
  '薪資': '💼',
  '電話費': '📞',
  '電費': '⚡',
  '淘寶': '🛒',
  '上網費': '🌐',
  '醫療': '🏥',
  '其他': '🏷️'
};

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
  const rate = ratesToMOP[currency] || 1;
  return Number(amount) * rate;
}

function loadRecords() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

// ========== 狀態 ==========
let records = loadRecords();
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-11
let currentType = 'expense'; // form 用
let categoryChart = null;

// ========== DOM ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const monthLabel = $('#current-month-label');
const recordsList = $('#records-list');
const noRecords = $('#no-records');
const modalOverlay = $('#modal-overlay');
const form = $('#record-form');
const categorySelect = $('#category');
const customCategoryRow = $('#custom-category-row');
const customCategoryInput = $('#custom-category');

// ========== 初始化 ==========
function init() {
  // 設定今天日期為預設
  $('#date').valueAsDate = new Date();

  // 事件綁定
  $('#btn-add').addEventListener('click', openAddModal);
  $('#btn-close-modal').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  $('#btn-prev-month').addEventListener('click', () => changeMonth(-1));
  $('#btn-next-month').addEventListener('click', () => changeMonth(1));
  form.addEventListener('submit', handleSubmit);
  categorySelect.addEventListener('change', toggleCustomCategory);

  // 匯率設定
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

  // 點擊遮罩關閉
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  render();
}

// ========== 匯率設定 ==========
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
  if (hkd <= 0 || cny <= 0) {
    alert('匯率必須大於 0');
    return;
  }
  ratesToMOP = { MOP: 1, HKD: hkd, CNY: cny };
  saveRates(ratesToMOP);
  closeRatesModal();
  render(); // 重新計算摘要與圖表
}

function resetRates() {
  ratesToMOP = { ...DEFAULT_RATES };
  saveRates(ratesToMOP);
  $('#rate-hkd').value = ratesToMOP.HKD;
  $('#rate-cny').value = ratesToMOP.CNY;
}

// ========== 月份 ==========
function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  } else if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
  }
  render();
}

function updateMonthLabel() {
  monthLabel.textContent = `${currentYear}年${currentMonth + 1}月`;
}

// ========== 過濾當月紀錄 ==========
function getMonthRecords() {
  return records.filter(r => {
    const d = new Date(r.date);
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  }).sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);
}

// ========== 渲染 ==========
function render() {
  updateMonthLabel();
  renderSummary();
  renderChart();
  renderRecords();
}

function renderSummary() {
  const monthRecords = getMonthRecords();
  let income = 0;
  let expense = 0;

  monthRecords.forEach(r => {
    const amtMOP = toMOP(r.amount, r.currency);
    if (r.type === 'income') income += amtMOP;
    else expense += amtMOP;
  });

  const balance = income - expense;

  $('#summary-income').textContent = 'MOP ' + formatMoney(income);
  $('#summary-expense').textContent = 'MOP ' + formatMoney(expense);
  $('#summary-balance').textContent = 'MOP ' + formatMoney(balance);
}

function formatMoney(n) {
  return Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function renderRecords() {
  const monthRecords = getMonthRecords();
  recordsList.innerHTML = '';

  if (monthRecords.length === 0) {
    noRecords.style.display = 'block';
    return;
  }
  noRecords.style.display = 'none';

  monthRecords.forEach(r => {
    const icon = CATEGORY_ICONS[r.category] || '🏷️';
    const item = document.createElement('div');
    item.className = 'record-item';
    item.innerHTML = `
      <div class="record-left">
        <div class="record-category">${icon} ${escapeHtml(r.category)}</div>
        <div class="record-meta">
          ${r.date} · ${escapeHtml(r.payment)}${r.note ? ' · ' + escapeHtml(r.note) : ''}
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
    recordsList.appendChild(item);
  });

  // 綁定編輯 / 刪除
  recordsList.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(btn.dataset.id);
    });
  });
  recordsList.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('確定要刪除此筆紀錄嗎？')) {
        deleteRecord(btn.dataset.id);
      }
    });
  });
}

function renderChart() {
  const monthRecords = getMonthRecords().filter(r => r.type === 'expense');
  const noChartData = $('#no-chart-data');
  const canvas = $('#categoryChart');

  if (monthRecords.length === 0) {
    if (categoryChart) {
      categoryChart.destroy();
      categoryChart = null;
    }
    canvas.style.display = 'none';
    noChartData.style.display = 'block';
    return;
  }

  canvas.style.display = 'block';
  noChartData.style.display = 'none';

  // 依分類加總（轉換為 MOP）
  const byCategory = {};
  monthRecords.forEach(r => {
    const cat = r.category || '其他';
    byCategory[cat] = (byCategory[cat] || 0) + toMOP(r.amount, r.currency);
  });

  // 依金額由高到低排序
  const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([cat]) => {
    const icon = CATEGORY_ICONS[cat] || '🏷️';
    return `${icon} ${cat}`;
  });
  const data = sorted.map(([, amt]) => amt);

  const colors = [
    '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
    '#3b82f6', '#8b5cf6', '#ec4899', '#64748b', '#0ea5e9',
    '#a855f7', '#06b6d4', '#84cc16', '#f43f5e', '#6366f1'
  ];

  if (categoryChart) {
    categoryChart.destroy();
    categoryChart = null;
  }

  categoryChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '支出 (MOP)',
        data,
        backgroundColor: colors.slice(0, labels.length),
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y', // 水平棒形圖，分類名稱較好閱讀
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              return `MOP ${formatMoney(ctx.raw)}`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            callback: (val) => formatMoney(val)
          },
          grid: { color: '#f3f4f6' }
        },
        y: {
          grid: { display: false }
        }
      }
    }
  });
}

// ========== Modal ==========
function openAddModal() {
  $('#modal-title').textContent = '新增紀錄';
  form.reset();
  $('#edit-id').value = '';
  $('#date').valueAsDate = new Date();
  currentType = 'expense';
  $$('.type-btn').forEach(b => b.classList.remove('active'));
  $('.type-btn[data-type="expense"]').classList.add('active');
  customCategoryRow.classList.add('hidden');
  customCategoryInput.value = '';
  customCategoryInput.required = false;
  modalOverlay.classList.remove('hidden');
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

  // 處理分類
  const presetCategories = Array.from(categorySelect.options).map(o => o.value);
  if (presetCategories.includes(record.category)) {
    categorySelect.value = record.category;
    customCategoryRow.classList.add('hidden');
    customCategoryInput.value = '';
    customCategoryInput.required = false;
  } else {
    categorySelect.value = '其他';
    customCategoryRow.classList.remove('hidden');
    customCategoryInput.value = record.category;
    customCategoryInput.required = true;
  }

  modalOverlay.classList.remove('hidden');
}

function closeModal() {
  modalOverlay.classList.add('hidden');
}

function toggleCustomCategory() {
  if (categorySelect.value === '其他') {
    customCategoryRow.classList.remove('hidden');
    customCategoryInput.required = true;
    customCategoryInput.focus();
  } else {
    customCategoryRow.classList.add('hidden');
    customCategoryInput.required = false;
    customCategoryInput.value = '';
  }
}

// ========== CRUD ==========
function handleSubmit(e) {
  e.preventDefault();

  let category = categorySelect.value;
  if (category === '其他') {
    category = customCategoryInput.value.trim();
    if (!category) {
      alert('請輸入自訂分類名稱');
      return;
    }
  }

  const record = {
    id: $('#edit-id').value || String(Date.now()),
    type: currentType,
    amount: Number($('#amount').value),
    currency: $('#currency').value,
    date: $('#date').value,
    category,
    payment: $('#payment').value,
    note: $('#note').value.trim(),
    createdAt: new Date().toISOString()
  };

  const existingIdx = records.findIndex(r => r.id === record.id);
  if (existingIdx >= 0) {
    records[existingIdx] = { ...records[existingIdx], ...record };
  } else {
    records.push(record);
  }

  saveRecords(records);
  closeModal();
  render();
}

function deleteRecord(id) {
  records = records.filter(r => r.id !== id);
  saveRecords(records);
  render();
}

// ========== 工具 ==========
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========== 啟動 ==========
init();
