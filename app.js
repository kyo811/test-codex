(() => {
  const { BrowserQRCodeReader, IScannerControls } = ZXingBrowser;

  const elements = {
    video: document.getElementById('video'),
    overlay: document.getElementById('overlay'),
    startScan: document.getElementById('startScan'),
    stopScan: document.getElementById('stopScan'),
    switchCamera: document.getElementById('switchCamera'),
    reworkType: document.getElementById('reworkType'),
    productName: document.getElementById('productName'),
    productList: document.getElementById('productList'),
    expiryDate: document.getElementById('expiryDate'),
    batchNumber: document.getElementById('batchNumber'),
    qrText: document.getElementById('qrText'),
    recordForm: document.getElementById('recordForm'),
    status: document.getElementById('status'),
    gasUrl: document.getElementById('gasUrl'),
    pingService: document.getElementById('pingService'),
    pingResult: document.getElementById('pingResult'),
    previewContainer: document.getElementById('preview-container'),
  };

  /**
   * Local storage keys
   */
  const LS_KEYS = {
    GAS_URL: 'gas_url',
    MASTER: 'master_csv_cache_v1',
    MASTER_UPDATED_AT: 'master_csv_updated_at',
  };

  /**
   * State
   */
  let qrReader = null;
  /** @type {IScannerControls | null} */
  let controls = null;
  let videoDevices = [];
  let currentDeviceIndex = 0;
  let masterIndex = null; // Map key: productName||expiry -> batchNumber
  let productNames = new Set();

  // 產品分類資料
  const PRODUCT_CATEGORIES = {
    "廠內重工": ["纖纖飲", "肽纖飲-可可", "厚焙奶茶", "水光錠", "水光面膜", "雪聚露", "婕肌零", "身體油", "護手霜", "玻尿酸", "洗髮露", "養髮液", "葉黃素EX飲", "葉黃素果凍", "正冠茶"],
    "廠外重工": ["纖飄錠", "爆纖錠", "纖酵宿", "紫纖飲", "益生菌", "固樂纖"]
  };

  function setStatus(message, type = 'info') {
    elements.status.textContent = message || '';
    elements.status.className = `status ${type}`;
  }

  function setPing(message, type = 'info') {
    elements.pingResult.textContent = message || '';
    elements.pingResult.className = `status ${type}`;
  }

  function buildMasterKey(productName, expiryDate) {
    return `${(productName||'').trim()}||${(expiryDate||'').trim()}`;
  }

  function updateProductOptions() {
    const reworkType = elements.reworkType ? elements.reworkType.value : '';
    const productSelect = elements.productName;
    
    if (!productSelect) {
      console.error('productName element not found');
      return;
    }
    
    console.log('updateProductOptions called with reworkType:', reworkType);
    
    // 清空現有選項
    productSelect.innerHTML = '';
    
    if (!reworkType) {
      productSelect.innerHTML = '<option value="">請先選擇重工地點</option>';
      productSelect.disabled = true;
      return;
    }
    
    // 啟用產品選擇
    productSelect.disabled = false;
    productSelect.innerHTML = '<option value="">請選擇產品</option>';
    
    // 加入該類別的產品
    const products = PRODUCT_CATEGORIES[reworkType] || [];
    console.log('Updating products for:', reworkType, products);
    
    products.forEach(product => {
      const option = document.createElement('option');
      option.value = product;
      option.textContent = product;
      productSelect.appendChild(option);
    });
    
    console.log('Product options updated, total options:', productSelect.options.length);
  }

  async function tryAutoFillBatch() {
    const name = elements.productName.value;
    const expiry = elements.expiryDate.value; // yyyy-mm-dd from input type=date
    if (!name || !expiry) return;
    // 1) Try local master index first
    if (masterIndex) {
      const key = buildMasterKey(name, expiry);
      const batch = masterIndex.get(key);
      if (batch) {
        elements.batchNumber.value = batch;
        return;
      }
    }
    // 2) Fallback to GAS lookup if configured
    const url = (elements.gasUrl.value || '').trim();
    if (!url) return;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lookupBatch', data: { productName: name, expiryDate: expiry } }),
      });
      const data = await res.json();
      if (data && data.ok && data.batch) {
        elements.batchNumber.value = data.batch;
      }
    } catch (e) {
      // silent fallback
    }
  }

  async function listVideoDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoDevices = devices.filter(d => d.kind === 'videoinput');
    // Prefer back camera on iPhone if available
    const backIndex = videoDevices.findIndex(d => /back|rear|環境|後/.test((d.label||'').toLowerCase()));
    if (backIndex >= 0) currentDeviceIndex = backIndex; else currentDeviceIndex = 0;
    elements.switchCamera.disabled = videoDevices.length <= 1;
  }

  async function startScanner() {
    if (!qrReader) {
      qrReader = new BrowserQRCodeReader();
    }
    await listVideoDevices();
    if (videoDevices.length === 0) {
      setStatus('找不到相機裝置，請確認瀏覽器權限。', 'error');
      return;
    }
    stopScanner();
    const deviceId = videoDevices[currentDeviceIndex].deviceId;
    try {
      controls = await qrReader.decodeFromVideoDevice(deviceId, elements.video, (result, err, controls_) => {
        if (result) {
          elements.qrText.value = result.getText();
          setStatus('已掃描到 QR 碼。', 'success');
          // Optional: stop after first scan
          stopScanner();
        }
      });
      elements.startScan.disabled = true;
      elements.stopScan.disabled = false;
    } catch (e) {
      console.error(e);
      setStatus('開啟相機失敗，請確認權限或改用 Safari。', 'error');
    }
  }

  function stopScanner() {
    if (controls) {
      try { controls.stop(); } catch (e) {}
      controls = null;
    }
    elements.startScan.disabled = false;
    elements.stopScan.disabled = true;
  }

  async function switchCamera() {
    if (videoDevices.length <= 1) return;
    currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
    await startScanner();
  }

  function parseCsv(text) {
    // Expected headers: productName,expiryDate,batchNumber
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];
    const header = lines[0].split(',').map(s => s.trim());
    const rows = lines.slice(1).map(line => {
      const cols = line.split(',').map(s => s.trim());
      const obj = {};
      header.forEach((h, i) => { obj[h] = cols[i] || ''; });
      return obj;
    });
    return rows;
  }

  function buildMasterIndex(rows) {
    const index = new Map();
    productNames = new Set();
    rows.forEach(r => {
      const name = (r.productName || r.產品名稱 || '').trim();
      const expiry = (r.expiryDate || r.效期 || '').trim();
      const batch = (r.batchNumber || r.批號 || '').trim();
      if (!name || !expiry || !batch) return;
      productNames.add(name);
      const key = buildMasterKey(name, expiry);
      index.set(key, batch);
    });
    applyProductNamesToDatalist();
    return index;
  }

  function loadMasterFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LS_KEYS.MASTER);
      if (!raw) return;
      const data = JSON.parse(raw);
      masterIndex = buildMasterIndex(data.rows || []);
      const updatedAt = localStorage.getItem(LS_KEYS.MASTER_UPDATED_AT);
      if (updatedAt) {
        setStatus(`已載入主檔（${new Date(parseInt(updatedAt,10)).toLocaleString()}）`);
      }
    } catch (e) {
      console.warn('Failed to parse master from localStorage', e);
    }
  }

  function saveMasterToLocalStorage(rows) {
    localStorage.setItem(LS_KEYS.MASTER, JSON.stringify({ rows }));
    localStorage.setItem(LS_KEYS.MASTER_UPDATED_AT, String(Date.now()));
  }

  function restoreGasUrl() {
    const url = localStorage.getItem(LS_KEYS.GAS_URL) || '';
    elements.gasUrl.value = url;
  }

  function saveGasUrl(url) {
    localStorage.setItem(LS_KEYS.GAS_URL, url || '');
  }

  async function handleMasterFile(file) {
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    masterIndex = buildMasterIndex(rows);
    saveMasterToLocalStorage(rows);
    setStatus(`主檔已載入，共 ${rows.length} 筆。`, 'success');
    tryAutoFillBatch();
  }

  async function pingService() {
    const url = (elements.gasUrl.value || '').trim();
    if (!url) { setPing('請先輸入 Apps Script 網址', 'error'); return; }
    setPing('連線中…');
    try {
      const res = await fetch(`${url}?action=ping`, { method: 'GET' });
      const data = await res.json();
      if (data && data.ok) setPing('連線成功', 'success'); else setPing('連線失敗', 'error');
      saveGasUrl(url);
    } catch (e) {
      setPing('無法連線，請確認部署權限與網址。', 'error');
    }
  }

  async function submitRecord(evt) {
    evt.preventDefault();
    const url = (elements.gasUrl.value || '').trim();
    if (!url) { setStatus('請先設定 Apps Script 服務網址', 'error'); return; }
    const payload = {
      productName: elements.productName.value.trim(),
      expiryDate: elements.expiryDate.value.trim(),
      batchNumber: elements.batchNumber.value.trim(),
      qrText: elements.qrText.value.trim(),
      timestamp: new Date().toISOString(),
    };
    if (!payload.productName || !payload.expiryDate || !payload.batchNumber || !payload.qrText) {
      setStatus('請完整填寫表單與掃描 QR', 'error');
      return;
    }
    setStatus('送出中…');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'append', data: payload }),
      });
      const data = await res.json();
      if (data && data.ok) {
        setStatus('已寫入試算表', 'success');
        elements.recordForm.reset();
        elements.qrText.value = '';
      } else {
        setStatus(`寫入失敗：${(data && data.error) || '未知錯誤'}`, 'error');
      }
    } catch (e) {
      setStatus('連線失敗，請確認網路或服務部署。', 'error');
    }
  }

  function bindEvents() {
    elements.startScan.addEventListener('click', startScanner);
    elements.stopScan.addEventListener('click', stopScanner);
    elements.switchCamera.addEventListener('click', switchCamera);
    elements.gasUrl.addEventListener('change', () => saveGasUrl(elements.gasUrl.value));
    elements.pingService.addEventListener('click', pingService);
    elements.recordForm.addEventListener('submit', submitRecord);
    
    // 重工類型變更時更新產品選項
    if (elements.reworkType) {
      elements.reworkType.addEventListener('change', function() {
        console.log('Rework type changed to:', this.value);
        updateProductOptions();
        if (elements.batchNumber) elements.batchNumber.value = ''; // 清空批號
      });
    }
    
    // 產品名稱或效期變更時自動查詢批號
    elements.productName.addEventListener('change', tryAutoFillBatch);
    elements.expiryDate.addEventListener('change', tryAutoFillBatch);
  }

  function initCanvasOverlay() {
    const canvas = elements.overlay;
    const video = elements.video;
    const draw = () => {
      const w = video.clientWidth || video.videoWidth;
      const h = video.clientHeight || video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(0, 200, 255, 0.8)';
      ctx.lineWidth = 2;
      const size = Math.min(w, h) * 0.6;
      const x = (w - size) / 2;
      const y = (h - size) / 2;
      ctx.strokeRect(x, y, size, size);
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  function init() {
    bindEvents();
    restoreGasUrl();
    initCanvasOverlay();
    updateProductOptions(); // 初始化產品選項
  }

  document.addEventListener('DOMContentLoaded', init);
})();


