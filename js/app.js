// 頁面切換核心邏輯
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  
  const targetContent = document.getElementById(`tab-${tabName}-content`);
  const targetBtn = document.getElementById(`btn-tab-${tabName}`);
  
  if (targetContent) targetContent.classList.add('active');
  if (targetBtn) targetBtn.classList.add('active');
}

// 請將原本關於「月度記帳、圖表繪製、新增表單」的 JavaScript 邏輯貼在此處
