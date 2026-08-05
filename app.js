// 狀態管理
let records = JSON.parse(localStorage.getItem('expenseRecords')) || [];
let chartInstance = null;

// DOM 元素選取
const monthFilter = document.getElementById('monthFilter');
const recordList = document.getElementById('recordList');
const openModalBtn = document.getElementById('openModalBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const recordModal = document.getElementById('recordModal');
const recordForm = document.getElementById('recordForm');
const categorySelect = document.getElementById('category');
const customCategoryInput = document.getElementById('customCategory');

// 初始化
function init() {
    // 設定預設月份為當前月份 (格式: YYYY-MM)
    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    monthFilter.value = currentMonth;
    
    // 設定新增紀錄的預設日期為今天
    document.getElementById('date').value = today.toISOString().split('T')[0];

    updateDashboard();
}

// 監聽月份切換
monthFilter.addEventListener('change', updateDashboard);

// 彈出視窗控制
openModalBtn.addEventListener('click', () => recordModal.classList.remove('hidden'));
closeModalBtn.addEventListener('click', () => recordModal.classList.add('hidden'));

// 點擊視窗外部關閉
window.addEventListener('click', (e) => {
    if (e.target === recordModal) {
        recordModal.classList.add('hidden');
    }
});

// 分類選擇監聽 (處理「其他」選項)
categorySelect.addEventListener('change', (e) => {
    if (e.target.value === '其他') {
        customCategoryInput.classList.remove('hidden');
        customCategoryInput.required = true;
    } else {
        customCategoryInput.classList.add('hidden');
        customCategoryInput.required = false;
        customCategoryInput.value = '';
    }
});

// 提交表單新增紀錄
recordForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const date = document.getElementById('date').value;
    const currency = document.getElementById('currency').value;
    const amount = parseFloat(document.getElementById('amount').value);
    const baseCategory = document.getElementById('category').value;
    const customCategory = document.getElementById('customCategory').value;
    const paymentMethod = document.getElementById('paymentMethod').value;

    const finalCategory = baseCategory === '其他' ? customCategory : baseCategory;

    const newRecord = {
        id: Date.now().toString(),
        date,
        currency,
        amount,
        category: finalCategory,
        paymentMethod
    };

    records.push(newRecord);
    localStorage.setItem('expenseRecords', JSON.stringify(records));
    
    // 重置表單並關閉視窗
    recordForm.reset();
    document.getElementById('date').value = new Date().toISOString().split('T')[0];
    customCategoryInput.classList.add('hidden');
    recordModal.classList.add('hidden');

    updateDashboard();
});

// 更新儀表板 (列表與圖表)
function updateDashboard() {
    const selectedMonth = monthFilter.value; // YYYY-MM
    
    // 過濾出當月的紀錄
    const monthlyRecords = records.filter(record => record.date.startsWith(selectedMonth));
    
    // 依日期排序 (最新的在前面)
    monthlyRecords.sort((a, b) => new Date(b.date) - new Date(a.date));

    renderRecords(monthlyRecords);
    renderChart(monthlyRecords);
}

// 渲染紀錄列表
function renderRecords(monthlyRecords) {
    recordList.innerHTML = '';
    
    if (monthlyRecords.length === 0) {
        recordList.innerHTML = '<li style="text-align:center; padding: 20px; color: #999;">本月尚無紀錄</li>';
        return;
    }

    monthlyRecords.forEach(record => {
        const li = document.createElement('li');
        li.className = 'record-item';
        li.innerHTML = `
            <div class="record-info">
                <span class="record-title">${record.category}</span>
                <span class="record-meta">${record.date} · ${record.paymentMethod}</span>
            </div>
            <div class="record-amount">
                ${record.currency} ${record.amount.toFixed(2)}
            </div>
        `;
        recordList.appendChild(li);
    });
}

// 渲染圖表
function renderChart(monthlyRecords) {
    const ctx = document.getElementById('expenseChart').getContext('2d');
    
    // 計算各分類總和 (為了簡化圖表，這裡暫不處理不同貨幣的匯率轉換，直接將數字相加)
    // 如果需要更精準的報表，建議後續可增加匯率轉換邏輯
    const categoryTotals = {};
    monthlyRecords.forEach(record => {
        if (!categoryTotals[record.category]) {
            categoryTotals[record.category] = 0;
        }
        categoryTotals[record.category] += record.amount;
    });

    const labels = Object.keys(categoryTotals);
    const data = Object.values(categoryTotals);

    // 如果圖表已存在，先銷毀才能重新繪製
    if (chartInstance) {
        chartInstance.destroy();
    }

    if (labels.length === 0) {
        // 沒有資料時不顯示圖表內容，或可自行擴充顯示「無資料」圖片
        return;
    }

    chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right' }
            }
        }
    });
}

// 啟動 App
init();
