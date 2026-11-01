// TikTok Live AI Studio - Dashboard Controller (v3.0.0)
const socket = io();

// State
let appConfig = {};
let productsList = [];
let pinnedProduct = null;
let faqsList = [];

// DOM Elements - Navigation & Status
const inputUsername = document.getElementById('input-username');
const btnConnect = document.getElementById('btn-connect');
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const metricViewers = document.getElementById('metric-viewers');
const metricLikes = document.getElementById('metric-likes');
const metricGifts = document.getElementById('metric-gifts');

// DOM Elements - AI & Audio Settings
const selectPersona = document.getElementById('select-persona');
const selectVoice = document.getElementById('select-voice');
const selectSpeed = document.getElementById('select-speed');
const rangeVolume = document.getElementById('range-volume');
const valVolume = document.getElementById('val-volume');

const toggleWelcome = document.getElementById('toggle-welcome');
const toggleComments = document.getElementById('toggle-comments');
const toggleGifts = document.getElementById('toggle-gifts');
const toggleAutoPitch = document.getElementById('toggle-auto-pitch');
const toggleGemini = document.getElementById('toggle-gemini');

const btnToggleBgm = document.getElementById('btn-toggle-bgm');
const rangeBgmVolume = document.getElementById('range-bgm-volume');
const manualSpeakInput = document.getElementById('manual-speak-input');
const btnManualSpeak = document.getElementById('btn-manual-speak');
const btnStopSpeech = document.getElementById('btn-stop-speech');

// DOM Elements - Center Tabs & Feed
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
const liveFeedContainer = document.getElementById('live-feed-container');
const btnClearFeed = document.getElementById('btn-clear-feed');
const btnManageFaqs = document.getElementById('btn-manage-faqs');
const faqCount = document.getElementById('faq-count');
const obsUrlInput = document.getElementById('obs-url-input');
const btnCopyObs = document.getElementById('btn-copy-obs');
const monitorIframe = document.getElementById('monitor-iframe');

// Script Generator Elements
const genTitle = document.getElementById('gen-title');
const genPrice = document.getElementById('gen-price');
const genPromo = document.getElementById('gen-promo');
const genHighlights = document.getElementById('gen-highlights');
const btnGenerateAiScript = document.getElementById('btn-generate-ai-script');
const generatedScriptsContainer = document.getElementById('generated-scripts-container');
const resultSweet = document.getElementById('result-sweet');
const resultHype = document.getElementById('result-hype');
const resultPro = document.getElementById('result-pro');

// DOM Elements - Right Panel (Pinned & Catalog)
const pinnedTitle = document.getElementById('pinned-title');
const pinnedPrice = document.getElementById('pinned-price');
const pinnedOrig = document.getElementById('pinned-orig');
const pinnedStock = document.getElementById('pinned-stock');
const pinnedPromo = document.getElementById('pinned-promo');
const btnUrgencyAlert = document.getElementById('btn-urgency-alert');
const btnDecrementStock = document.getElementById('btn-decrement-stock');
const productList = document.getElementById('product-list');
const productCount = document.getElementById('product-count');
const btnOpenAddProduct = document.getElementById('btn-open-add-product');

// Modals
const modalFaqs = document.getElementById('modal-faqs');
const btnCloseFaqModal = document.getElementById('btn-close-faq-modal');
const faqRulesList = document.getElementById('faq-rules-list');
const newFaqTitle = document.getElementById('new-faq-title');
const newFaqKeywords = document.getElementById('new-faq-keywords');
const newFaqAnswer = document.getElementById('new-faq-answer');
const btnSaveNewFaq = document.getElementById('btn-save-new-faq');

const modalProduct = document.getElementById('modal-product');
const btnCloseProductModal = document.getElementById('btn-close-product-modal');
const editProductId = document.getElementById('edit-product-id');
const modalProductTitle = document.getElementById('modal-product-title');
const productFormTitle = document.getElementById('product-form-title');
const productFormPrice = document.getElementById('product-form-price');
const productFormOrig = document.getElementById('product-form-orig');
const productFormStock = document.getElementById('product-form-stock');
const productFormPromo = document.getElementById('product-form-promo');
const productFormKeywords = document.getElementById('product-form-keywords');
const productFormScript = document.getElementById('product-form-script');
const btnSaveProduct = document.getElementById('btn-save-product');

// ==========================================
// 1. Initial State & Socket Listeners
// ==========================================
socket.on('init_state', data => {
  if (data.config) {
    appConfig = data.config;
    applyConfigUI(appConfig);
  }
  if (data.products) {
    productsList = data.products;
    renderProductsList();
  }
  if (data.pinnedProduct) {
    pinnedProduct = data.pinnedProduct;
    renderPinnedProduct();
  }
  if (data.faqs) {
    faqsList = data.faqs;
    renderFaqsList();
  }
});

socket.on('tiktok_status', data => {
  if (data.connected) {
    statusBadge.className = 'status-indicator connected';
    statusText.textContent = `สด: @${data.username}`;
    btnConnect.textContent = 'ตัดการเชื่อมต่อ';
    btnConnect.className = 'btn btn-outline-danger';
  } else {
    statusBadge.className = 'status-indicator disconnected';
    statusText.textContent = 'ออฟไลน์ (พร้อมจำลอง)';
    btnConnect.textContent = 'เชื่อมต่อห้องไลฟ์';
    btnConnect.className = 'btn btn-primary';
  }
});

socket.on('chat_message', msg => {
  appendFeedItem('chat', msg.user, msg.comment, msg.timestamp);
});

socket.on('gift_event', gift => {
  appendFeedItem('gift', gift.user, `ส่ง ${gift.giftName} ${gift.repeatCount > 1 ? `x${gift.repeatCount}` : ''} 🎉`, gift.timestamp);
  const cur = parseInt(metricGifts.textContent) || 0;
  metricGifts.textContent = cur + (gift.repeatCount || 1);
});

socket.on('member_join', join => {
  appendFeedItem('join', join.user, 'เข้าร่วมห้องไลฟ์แล้ว 👋', join.timestamp);
});

socket.on('ai_speaking', speech => {
  const isGemini = speech.meta?.type === 'gemini_faq';
  const label = isGemini ? '🤖 แม่ค้า AI (Gemini ตอบ)' : 'แม่ค้า AI (พูดสด)';
  appendFeedItem(isGemini ? 'ai-speech gemini-reply' : 'ai-speech', label, speech.text, speech.timestamp);
});

// ==========================================
// Dashboard Audio Engine (Speech & Voice Output)
// ==========================================
let dashboardSpeechAudio = null;

function playDashboardSpeech(data) {
  if (!data || !data.text) return;
  // If Python audio mixer already played the sound locally on the host machine,
  // do not duplicate playback in the dashboard browser tab.
  if (data.playedLocally) return;

  const currentVol = parseFloat(rangeVolume.value) || 1.0;

  if (data.audioUrl && !data.fallback) {
    try {
      if (dashboardSpeechAudio) {
        dashboardSpeechAudio.pause();
        dashboardSpeechAudio = null;
      }
      dashboardSpeechAudio = new Audio(data.audioUrl);
      dashboardSpeechAudio.volume = Math.min(1.0, Math.max(0.0, currentVol));
      dashboardSpeechAudio.play().catch(err => {
        console.warn('Dashboard audio play failed, using Web Speech fallback:', err);
        speakDashboardWebSpeech(data.text);
      });
      return;
    } catch (e) {
      console.warn('Dashboard audio player error:', e);
    }
  }

  // Fallback to Browser Web Speech API
  speakDashboardWebSpeech(data.text);
}

function speakDashboardWebSpeech(text) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    const voices = window.speechSynthesis.getVoices();
    const thVoice = voices.find(v => v.lang.includes('th') || v.lang.includes('TH'));
    if (!thVoice) {
      console.warn('[WebSpeech] No Thai voice installed in browser/OS. Suppressing speech to prevent English voice intrusion.');
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.voice = thVoice;
    utter.lang = 'th-TH';
    utter.rate = parseFloat(selectSpeed.value) || 1.0;
    window.speechSynthesis.speak(utter);
  } catch (e) {
    console.error('Web Speech error:', e);
  }
}

// Unlock audio context on any user click
document.addEventListener('click', () => {
  if (window.speechSynthesis && window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }
}, { once: false });

socket.on('tts_event', event => {
  if (event.event === 'playing' && event.data) {
    playDashboardSpeech(event.data);
  } else if (event.event === 'finished' || event.event === 'stopped') {
    if (dashboardSpeechAudio) {
      dashboardSpeechAudio.pause();
      dashboardSpeechAudio = null;
    }
  }
});

socket.on('pinned_updated', p => {
  pinnedProduct = p;
  renderPinnedProduct();
  renderProductsList();
});

socket.on('products_updated', list => {
  productsList = list;
  renderProductsList();
  if (pinnedProduct) {
    const updated = list.find(p => p.id === pinnedProduct.id);
    if (updated) {
      pinnedProduct = updated;
      renderPinnedProduct();
    }
  }
});

socket.on('stats_update', stats => {
  if (stats.viewerCount !== undefined) {
    metricViewers.textContent = Number(stats.viewerCount).toLocaleString();
  }
});

socket.on('session_order', (stats) => updateAnalyticsUI(stats));
socket.on('session_started', (stats) => updateAnalyticsUI(stats));

socket.on('faqs_updated', faqs => {
  faqsList = faqs;
  renderFaqsList();
});

// ==========================================
// 2. UI Render Functions
// ==========================================
function applyConfigUI(cfg) {
  if (cfg.persona) selectPersona.value = cfg.persona;
  if (cfg.voice) selectVoice.value = cfg.voice;
  if (cfg.rate) selectSpeed.value = cfg.rate;
  if (cfg.volume !== undefined) {
    rangeVolume.value = cfg.volume;
    valVolume.textContent = `${Math.round(cfg.volume * 100)}%`;
  }
  toggleWelcome.checked = !!cfg.respondToJoins;
  toggleComments.checked = !!cfg.respondToComments;
  toggleGifts.checked = !!cfg.respondToGifts;
  toggleAutoPitch.checked = !!cfg.autoPitch;
  if (toggleGemini && cfg.geminiEnabled !== undefined) {
    toggleGemini.checked = !!cfg.geminiEnabled;
  }

  if (cfg.bgmEnabled) {
    btnToggleBgm.className = 'btn btn-primary';
    btnToggleBgm.textContent = '🔊 กำลังเล่น BGM';
  } else {
    btnToggleBgm.className = 'btn btn-outline-primary';
    btnToggleBgm.textContent = '🎵 เปิดเพลงคลอ BGM';
  }
  if (cfg.bgmVolume !== undefined) {
    rangeBgmVolume.value = cfg.bgmVolume;
  }
}

function appendFeedItem(type, user, message, time = new Date().toLocaleTimeString()) {
  const item = document.createElement('div');
  item.className = `feed-item ${type}`;
  item.innerHTML = `
    <span class="feed-time">${time}</span>
    <div class="feed-content">
      <div class="feed-user">${escapeHtml(user)}</div>
      <div class="feed-message">${escapeHtml(message)}</div>
    </div>
  `;
  liveFeedContainer.prepend(item);

  // Keep max 100 items
  while (liveFeedContainer.children.length > 100) {
    liveFeedContainer.removeChild(liveFeedContainer.lastChild);
  }
}

function renderPinnedProduct() {
  if (!pinnedProduct) {
    pinnedTitle.textContent = 'ยังไม่มีสินค้าปักหมุด';
    pinnedPrice.textContent = '0';
    pinnedOrig.textContent = '';
    pinnedStock.textContent = 'เหลือ 0 ชิ้น';
    pinnedPromo.textContent = '';
    return;
  }

  pinnedTitle.textContent = `ตะกร้าที่ ${pinnedProduct.id}: ${pinnedProduct.title}`;
  pinnedPrice.textContent = pinnedProduct.price;
  pinnedOrig.textContent = pinnedProduct.originalPrice ? `฿${pinnedProduct.originalPrice}` : '';
  pinnedStock.textContent = `เหลือ ${pinnedProduct.stock !== undefined ? pinnedProduct.stock : 50} ชิ้น`;
  pinnedPromo.textContent = pinnedProduct.promotion || 'โปรโมชั่นพิเศษในไลฟ์';
}

function renderProductsList() {
  productList.innerHTML = '';
  productCount.textContent = productsList.length;

  productsList.forEach(p => {
    const isPinned = pinnedProduct && pinnedProduct.id === p.id;
    const item = document.createElement('div');
    item.className = `product-item ${isPinned ? 'pinned' : ''}`;
    item.innerHTML = `
      <div class="item-basket-badge">#${p.id}</div>
      <div class="item-details">
        <div class="item-title" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</div>
        <div class="item-price-row">
          <span class="item-price">฿${p.price}</span>
          <span style="color:#64748b;">(สต็อก: ${p.stock})</span>
        </div>
      </div>
      <div class="item-actions">
        <button class="btn btn-xs ${isPinned ? 'btn-primary' : 'btn-glass'} btn-pin-product" data-id="${p.id}">
          ${isPinned ? '📌 ปักแล้ว' : 'ปักหมุด'}
        </button>
        <button class="btn btn-xs btn-glass btn-edit-product" data-id="${p.id}">✏️</button>
        <button class="btn btn-xs btn-glass btn-delete-product" data-id="${p.id}">🗑️</button>
      </div>
    `;
    productList.appendChild(item);
  });
}

function renderFaqsList() {
  faqCount.textContent = faqsList.length;
  faqRulesList.innerHTML = '';

  faqsList.forEach(f => {
    const card = document.createElement('div');
    card.style.cssText = 'background:rgba(10,14,23,0.7); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:12px; margin-top:10px;';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <strong style="color:#38bdf8; font-size:0.95rem;">${escapeHtml(f.title)}</strong>
        <button class="btn btn-xs btn-glass btn-delete-faq" data-id="${f.id}" style="color:#f87171;">ลบ</button>
      </div>
      <div style="font-size:0.82rem; color:#f59e0b; margin-bottom:6px;">
        🏷️ คำสำคัญ: ${f.keywords.map(k => `<span style="background:rgba(245,158,11,0.15); padding:1px 6px; border-radius:4px; margin-right:4px;">${escapeHtml(k)}</span>`).join('')}
      </div>
      <div style="font-size:0.88rem; color:#e2e8f0; line-height:1.4;">
        🗣️ คำตอบ AI: ${escapeHtml(f.answer)}
      </div>
    `;
    faqRulesList.appendChild(card);
  });
}

// ==========================================
// 3. Action Handlers & Event Listeners
// ==========================================

// Connect / Disconnect
btnConnect.addEventListener('click', async () => {
  const isConnected = statusBadge.classList.contains('connected');
  if (isConnected) {
    await fetch('/api/tiktok/disconnect', { method: 'POST' });
  } else {
    const username = inputUsername.value.trim().replace(/^@/, '');
    if (!username) {
      alert('กรุณาใส่ชื่อบัญชี TikTok ก่อนกดเชื่อมต่อ');
      return;
    }
    btnConnect.textContent = 'กำลังเชื่อมต่อ...';
    await fetch('/api/tiktok/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
  }
});

// Settings Changes
async function updateConfig(patch) {
  Object.assign(appConfig, patch);
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
}

selectPersona.addEventListener('change', () => updateConfig({ persona: selectPersona.value }));
selectVoice.addEventListener('change', () => updateConfig({ voice: selectVoice.value }));
selectSpeed.addEventListener('change', () => updateConfig({ rate: selectSpeed.value }));
rangeVolume.addEventListener('input', () => {
  valVolume.textContent = `${Math.round(rangeVolume.value * 100)}%`;
});
rangeVolume.addEventListener('change', () => updateConfig({ volume: parseFloat(rangeVolume.value) }));

toggleWelcome.addEventListener('change', () => updateConfig({ respondToJoins: toggleWelcome.checked }));
toggleComments.addEventListener('change', () => updateConfig({ respondToComments: toggleComments.checked }));
toggleGifts.addEventListener('change', () => updateConfig({ respondToGifts: toggleGifts.checked }));
toggleAutoPitch.addEventListener('change', () => updateConfig({ autoPitch: toggleAutoPitch.checked }));
if (toggleGemini) {
  toggleGemini.addEventListener('change', () => {
    updateConfig({ geminiEnabled: toggleGemini.checked });
  });
}

// Sound FX Buttons
document.querySelectorAll('.btn-sfx').forEach(btn => {
  btn.addEventListener('click', () => {
    const sfxName = btn.dataset.sfx;
    fetch(`/api/sfx/${sfxName}`, { method: 'POST' });
  });
});

// BGM
btnToggleBgm.addEventListener('click', async () => {
  const res = await fetch('/api/bgm/toggle', { method: 'POST' });
  const data = await res.json();
  if (data.bgmEnabled) {
    btnToggleBgm.className = 'btn btn-primary';
    btnToggleBgm.textContent = '🔊 กำลังเล่น BGM';
  } else {
    btnToggleBgm.className = 'btn btn-outline-primary';
    btnToggleBgm.textContent = '🎵 เปิดเพลงคลอ BGM';
  }
});

rangeBgmVolume.addEventListener('change', () => {
  fetch('/api/bgm/volume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume: parseFloat(rangeBgmVolume.value) })
  });
});

// Manual Speech
btnManualSpeak.addEventListener('click', () => {
  const text = manualSpeakInput.value.trim();
  if (!text) return;
  fetch('/api/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, priority: 2 })
  });
  manualSpeakInput.value = '';
});

manualSpeakInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnManualSpeak.click();
});

btnStopSpeech.addEventListener('click', () => {
  fetch('/api/stop-speech', { method: 'POST' });
});

// Pinned Actions
btnUrgencyAlert.addEventListener('click', () => {
  if (!pinnedProduct) return;
  fetch(`/api/products/${pinnedProduct.id}/urgency`, { method: 'POST' });
});

btnDecrementStock.addEventListener('click', () => {
  if (!pinnedProduct) return;
  fetch(`/api/products/${pinnedProduct.id}/decrement`, { method: 'POST' });
});

// Product List Click Delegation
productList.addEventListener('click', e => {
  const pinBtn = e.target.closest('.btn-pin-product');
  if (pinBtn) {
    const id = pinBtn.dataset.id;
    fetch(`/api/products/${id}/pin`, { method: 'POST' });
    return;
  }

  const editBtn = e.target.closest('.btn-edit-product');
  if (editBtn) {
    const id = editBtn.dataset.id;
    const p = productsList.find(x => x.id === Number(id));
    if (p) openProductModal(p);
    return;
  }

  const delBtn = e.target.closest('.btn-delete-product');
  if (delBtn) {
    const id = delBtn.dataset.id;
    if (confirm('คุณแน่ใจว่าต้องการลบสินค้านี้ออกจากตะกร้าไลฟ์หรือไม่?')) {
      fetch(`/api/products/${id}`, { method: 'DELETE' });
    }
    return;
  }
});

// Tabs Switching
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    tabPanes.forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// Copy OBS URL
btnCopyObs.addEventListener('click', () => {
  navigator.clipboard.writeText(obsUrlInput.value);
  btnCopyObs.textContent = 'คัดลอกแล้ว! ✓';
  setTimeout(() => { btnCopyObs.textContent = 'คัดลอก URL'; }, 2000);
});

// Simulation Buttons
document.getElementById('btn-sim-shipping')?.addEventListener('click', () => {
  fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'chat', user: 'คุณนัท', comment: 'ส่งของวันไหนคะ ค่าส่งเท่าไหร่' })
  });
});

document.getElementById('btn-sim-cod')?.addEventListener('click', () => {
  fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'chat', user: 'คุณบอย', comment: 'มีเก็บเงินปลายทางไหมครับ' })
  });
});

document.getElementById('btn-sim-shirt')?.addEventListener('click', () => {
  fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'chat', user: 'น้องมุก', comment: 'สนใจเสื้อยืดโอเวอร์ไซส์ตะกร้าหนึ่งค่ะ' })
  });
});

document.getElementById('btn-sim-gift')?.addEventListener('click', () => {
  fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'gift', user: 'คุณมาร์ค VIP', giftName: 'ดอกกุหลาบ', repeatCount: 5 })
  });
});

document.getElementById('btn-sim-join')?.addEventListener('click', () => {
  fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'join', user: 'ลูกค้าท่านใหม่' })
  });
});

btnClearFeed.addEventListener('click', () => {
  liveFeedContainer.innerHTML = '';
});

// One-Click AI Script Generator (Inspired by BocaLive)
btnGenerateAiScript.addEventListener('click', async () => {
  const title = genTitle.value.trim();
  if (!title) {
    alert('กรุณาใส่ชื่อสินค้าก่อนสกัดสคริปต์');
    return;
  }
  btnGenerateAiScript.textContent = '⏳ กำลังสกัดสคริปต์ 3 สไตล์...';

  try {
    const res = await fetch('/api/ai/generate-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        price: genPrice.value.trim(),
        promo: genPromo.value.trim(),
        highlights: genHighlights.value.trim()
      })
    });
    const data = await res.json();
    if (data.scripts) {
      resultSweet.textContent = data.scripts.sweet;
      resultHype.textContent = data.scripts.hype;
      resultPro.textContent = data.scripts.pro;
      generatedScriptsContainer.classList.remove('hidden');
    }
  } catch (e) {
    alert('เกิดข้อผิดพลาดในการสร้างสคริปต์');
  } finally {
    btnGenerateAiScript.textContent = '✨ สกัดสคริปต์การขาย 3 สไตล์ทันที';
  }
});

// Click "สั่ง AI พูดบทนี้" from generator
document.querySelectorAll('.btn-use-script').forEach(btn => {
  btn.addEventListener('click', () => {
    const style = btn.dataset.style;
    const elem = document.getElementById(`result-${style}`);
    if (elem && elem.textContent) {
      fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: elem.textContent, priority: 2 })
      });
      alert(`สั่งให้ AI เริ่มพูดสคริปต์ (${style}) เรียบร้อยแล้วค่า!`);
    }
  });
});

// FAQ Modal
btnManageFaqs.addEventListener('click', () => modalFaqs.classList.remove('hidden'));
btnCloseFaqModal.addEventListener('click', () => modalFaqs.classList.add('hidden'));

btnSaveNewFaq.addEventListener('click', async () => {
  const title = newFaqTitle.value.trim();
  const kw = newFaqKeywords.value.split(',').map(s => s.trim()).filter(Boolean);
  const answer = newFaqAnswer.value.trim();

  if (!title || kw.length === 0 || !answer) {
    alert('กรุณากรอกหัวข้อ คำสำคัญ และคำตอบให้ครบถ้วน');
    return;
  }

  await fetch('/api/faqs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, keywords: kw, answer })
  });

  newFaqTitle.value = '';
  newFaqKeywords.value = '';
  newFaqAnswer.value = '';
});

faqRulesList.addEventListener('click', e => {
  const delBtn = e.target.closest('.btn-delete-faq');
  if (delBtn) {
    const id = delBtn.dataset.id;
    if (confirm('คุณแน่ใจว่าต้องการลบกฎคำถามนี้หรือไม่?')) {
      fetch(`/api/faqs/${id}`, { method: 'DELETE' });
    }
  }
});

// Product Modal
btnOpenAddProduct.addEventListener('click', () => openProductModal(null));
btnCloseProductModal.addEventListener('click', () => modalProduct.classList.add('hidden'));

function openProductModal(p) {
  if (p) {
    modalProductTitle.textContent = `✏️ แก้ไขข้อมูลตะกร้าที่ ${p.id}`;
    editProductId.value = p.id;
    productFormTitle.value = p.title;
    productFormPrice.value = p.price;
    productFormOrig.value = p.originalPrice || '';
    productFormStock.value = p.stock || 50;
    productFormPromo.value = p.promotion || '';
    productFormKeywords.value = (p.keywords || []).join(', ');
    productFormScript.value = p.pitchScript || '';
  } else {
    modalProductTitle.textContent = '📦 เพิ่มสินค้าใหม่ในไลฟ์';
    editProductId.value = '';
    productFormTitle.value = '';
    productFormPrice.value = '';
    productFormOrig.value = '';
    productFormStock.value = 50;
    productFormPromo.value = '🔥 ส่งฟรีในไลฟ์';
    productFormKeywords.value = '';
    productFormScript.value = '';
  }
  modalProduct.classList.remove('hidden');
}

btnSaveProduct.addEventListener('click', async () => {
  const id = editProductId.value;
  const payload = {
    title: productFormTitle.value.trim(),
    price: productFormPrice.value.trim(),
    originalPrice: productFormOrig.value.trim(),
    stock: parseInt(productFormStock.value) || 0,
    promotion: productFormPromo.value.trim(),
    keywords: productFormKeywords.value.split(',').map(s => s.trim()).filter(Boolean),
    pitchScript: productFormScript.value.trim()
  };

  if (!payload.title || !payload.price) {
    alert('กรุณาระบุชื่อสินค้าและราคา');
    return;
  }

  if (id) {
    await fetch(`/api/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } else {
    await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
  modalProduct.classList.add('hidden');
});

// Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================
// Session Analytics (Task 3)
// ==========================================
function updateAnalyticsUI(stats) {
  if (!stats) return;
  const ordersEl = document.getElementById('stat-orders');
  const peakEl = document.getElementById('stat-peak');
  const topProductEl = document.getElementById('stat-top-product');
  if (ordersEl) ordersEl.textContent = stats.totalOrders || 0;
  if (peakEl) peakEl.textContent = stats.peakViewers || 0;
  if (topProductEl) topProductEl.textContent = stats.topProductId ? `#${stats.topProductId}` : '-';
}

const btnExportCsv = document.getElementById('btn-export-csv');
if (btnExportCsv) {
  btnExportCsv.addEventListener('click', () => {
    window.open('/api/session/export-csv', '_blank');
  });
}

// Fetch initial session stats
fetch('/api/session/stats')
  .then(res => res.json())
  .then(stats => updateAnalyticsUI(stats))
  .catch(err => console.error('[Analytics] Failed to fetch stats:', err));

// Flash Sale Dashboard Controller
const flashSetupRow = document.getElementById('flash-setup-row');
const flashActiveRow = document.getElementById('flash-active-row');
const flashBadgeStatus = document.getElementById('flash-badge-status');
const flashDashboardTimer = document.getElementById('flash-dashboard-timer');
const btnFlashStart = document.getElementById('btn-flash-start');
const btnFlashStop = document.getElementById('btn-flash-stop');
const selectFlashDuration = document.getElementById('flash-duration');

function updateFlashSaleUI(state) {
  if (!state || !state.active || state.remainingSeconds <= 0) {
    if (flashSetupRow) flashSetupRow.classList.remove('hidden');
    if (flashActiveRow) flashActiveRow.classList.add('hidden');
    if (flashBadgeStatus) {
      flashBadgeStatus.textContent = 'ปิดอยู่';
      flashBadgeStatus.className = 'status-pill-inactive';
    }
  } else {
    if (flashSetupRow) flashSetupRow.classList.add('hidden');
    if (flashActiveRow) flashActiveRow.classList.remove('hidden');
    if (flashBadgeStatus) {
      flashBadgeStatus.textContent = 'กำลังทำงาน 🔥';
      flashBadgeStatus.className = 'status-pill-active';
    }
    if (flashDashboardTimer) {
      const m = Math.floor(state.remainingSeconds / 60).toString().padStart(2, '0');
      const s = (state.remainingSeconds % 60).toString().padStart(2, '0');
      flashDashboardTimer.textContent = `${m}:${s}`;
    }
  }
}

if (btnFlashStart) {
  btnFlashStart.addEventListener('click', () => {
    const mins = selectFlashDuration ? parseInt(selectFlashDuration.value) || 3 : 3;
    const pid = pinnedProduct?.id || 1;
    fetch('/api/flash-sale/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationMinutes: mins, productId: pid })
    })
      .then(r => r.json())
      .then(res => {
        if (res.state) updateFlashSaleUI(res.state);
      })
      .catch(err => console.error('[FlashSale] Failed to start:', err));
  });
}

if (btnFlashStop) {
  btnFlashStop.addEventListener('click', () => {
    fetch('/api/flash-sale/stop', { method: 'POST' })
      .then(r => r.json())
      .then(() => {
        updateFlashSaleUI({ active: false });
      })
      .catch(err => console.error('[FlashSale] Failed to stop:', err));
  });
}

// Socket events for Flash Sale
socket.on('flash_sale_tick', state => updateFlashSaleUI(state));
socket.on('flash_sale_stopped', () => updateFlashSaleUI({ active: false }));

// Initial state check
fetch('/api/flash-sale/state')
  .then(r => r.json())
  .then(state => updateFlashSaleUI(state))
  .catch(err => console.error('[FlashSale] Failed to fetch state:', err));

// ==========================================
// 8. Side Panel Navigation & Quick Action Bar
// ==========================================

// Left Panel Tab Switcher
document.querySelectorAll('[data-left-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-left-tab]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.left-tab-pane').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    const target = document.getElementById(btn.dataset.leftTab);
    if (target) target.classList.remove('hidden');
  });
});

// Right Panel Tab Switcher
document.querySelectorAll('[data-right-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-right-tab]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.right-tab-pane').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    const target = document.getElementById(btn.dataset.rightTab);
    if (target) target.classList.remove('hidden');
  });
});

// Quick Action Bar Handlers (Header)
const quickBtnStop = document.getElementById('quick-btn-stop');
if (quickBtnStop) {
  quickBtnStop.addEventListener('click', () => {
    const stopBtn = document.getElementById('btn-stop-speech');
    if (stopBtn) stopBtn.click();
  });
}

const quickBtnUrgency = document.getElementById('quick-btn-urgency');
if (quickBtnUrgency) {
  quickBtnUrgency.addEventListener('click', () => {
    const urgencyBtn = document.getElementById('btn-urgency-alert');
    if (urgencyBtn) urgencyBtn.click();
  });
}

const quickBtnFlash = document.getElementById('quick-btn-flash');
if (quickBtnFlash) {
  quickBtnFlash.addEventListener('click', () => {
    const flashBox = document.getElementById('flash-sale-box');
    if (flashBox) {
      flashBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      flashBox.classList.add('highlight-pulse');
      setTimeout(() => flashBox.classList.remove('highlight-pulse'), 1500);
    }
  });
}



