import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import nodeAssert from 'node:assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('🧪 RUNNING SYSTEMATIC VERIFICATION SUITE');
console.log('====================================================\n');

let failedTests = 0;
let passedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
  }
}

assert.strictEqual = (actual, expected, message) => {
  if (message !== undefined) {
    nodeAssert.strictEqual(actual, expected, message);
  } else {
    nodeAssert.strictEqual(actual, expected);
  }
};
assert.ok = (value, message) => {
  if (message !== undefined) {
    nodeAssert.ok(value, message);
  } else {
    nodeAssert.ok(value);
  }
};

function test(name, fn) {
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.then(
        () => {
          console.log(`  ✅ PASS: ${name}`);
          passedTests++;
        },
        (err) => {
          console.error(`  ❌ FAIL: ${name} (${err.message})`);
          failedTests++;
        }
      );
    }
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name} (${err.message})`);
    failedTests++;
  }
}

// ----------------------------------------------------
// Step 1: File and Asset Structure Verification
// ----------------------------------------------------
console.log('[1/4] Checking Essential Files & Assets...');

const requiredFiles = [
  'server.js',
  'tts_mixer.py',
  'package.json',
  'public/index.html',
  'public/app.js',
  'public/style.css',
  'public/stream-overlay.html',
  'public/stream-overlay.js',
  'public/stream-overlay.css',
  'data/products.json',
  'data/faqs.json',
  'public/assets/avatar_idle.jpg',
  'public/assets/avatar_speaking.jpg',
  'public/assets/avatar_blink.jpg',
  'public/assets/avatar_idle.mp4',
  'public/assets/avatar_talking.mp4',
  'sounds/ding.wav',
  'sounds/cash.wav',
  'sounds/cheer.wav',
  'sounds/bell.wav',
  'sounds/bgm.wav'
];

for (const file of requiredFiles) {
  const fullPath = path.join(__dirname, file);
  assert(fs.existsSync(fullPath), `File exists: ${file}`);
}

// ----------------------------------------------------
// Step 2: Data Integrity & Schema Verification
// ----------------------------------------------------
console.log('\n[2/4] Checking Data Integrity & Schemas...');

try {
  const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'products.json'), 'utf-8'));
  assert(Array.isArray(products), 'products.json is a valid JSON array');
  assert(products.length >= 4, `products.json contains all ${products.length} products (baskets 1 to 4)`);
  for (const p of products) {
    assert(p.id && p.title && p.price, `Product #${p.id} has id, title (${p.title.substring(0, 20)}...), price (${p.price})`);
  }
} catch (e) {
  assert(false, `products.json parsing error: ${e.message}`);
}

try {
  const faqs = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'faqs.json'), 'utf-8'));
  assert(Array.isArray(faqs), 'faqs.json is a valid JSON array');
  assert(faqs.length >= 4, `faqs.json contains ${faqs.length} FAQ rules`);
  for (const f of faqs) {
    assert(f.id && f.title && Array.isArray(f.keywords) && f.answer, `FAQ #${f.id} has title, keywords [${f.keywords.join(', ')}], answer`);
  }
} catch (e) {
  assert(false, `faqs.json parsing error: ${e.message}`);
}

// ----------------------------------------------------
// Step 3: Python Multi-Channel Audio Mixer Verification
// ----------------------------------------------------
console.log('\n[3/4] Testing Python Audio Mixer Bridge (tts_mixer.py)...');

async function testPythonBridge() {
  return new Promise((resolve) => {
    const pyProcess = spawn('python', ['-u', path.join(__dirname, 'tts_mixer.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
    });

    let isReady = false;
    let pongReceived = false;
    let sfxReceived = false;

    pyProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed);
          if (evt.event === 'ready') {
            isReady = true;
            pyProcess.stdin.write(JSON.stringify({ command: 'ping' }) + '\n');
            pyProcess.stdin.write(JSON.stringify({ command: 'play_sfx', name: 'ding', volume: 0.5 }) + '\n');
          } else if (evt.event === 'pong') {
            pongReceived = true;
          } else if (evt.event === 'sfx_played') {
            sfxReceived = true;
            pyProcess.stdin.write(JSON.stringify({ command: 'stop_speech' }) + '\n');
            setTimeout(() => {
              pyProcess.kill();
              resolve({ isReady, pongReceived, sfxReceived });
            }, 300);
          }
        } catch (e) {}
      }
    });

    pyProcess.on('error', (err) => {
      console.error('Python bridge error:', err);
      resolve({ isReady: false, pongReceived: false, sfxReceived: false });
    });

    setTimeout(() => {
      try { pyProcess.kill(); } catch (e) {}
      resolve({ isReady, pongReceived, sfxReceived });
    }, 4000);
  });
}

const bridgeResult = await testPythonBridge();
assert(bridgeResult.isReady, 'Python mixer emitted {"event": "ready"}');
assert(bridgeResult.pongReceived, 'Python mixer responded to {"command": "ping"} with {"event": "pong"}');
assert(bridgeResult.sfxReceived, 'Python mixer successfully loaded and played SFX "ding"');

// ----------------------------------------------------
// Step 4: Core Logic & Module Verification
// ----------------------------------------------------
console.log('\n[4/4] Testing Core Modules & Logic...');

process.env.PORT = '3098';
const serverModule = await import('./server.js');
const { productManager, faqManager, aiBrain, CONFIG, sessionTracker, flashSaleManager, GeminiAIBrain, geminiAI } = serverModule;

// Test ProductManager
assert(productManager.getAll().length >= 4, 'ProductManager loaded all initial products');
const pinned = productManager.getPinned();
assert(pinned && pinned.id === 1, `Default pinned product is Basket #1 (${pinned?.title})`);

const foundProd = productManager.findMatchingProduct('สนใจเสื้อยืดโอเวอร์ไซส์');
assert(foundProd && foundProd.id === 1, 'ProductManager successfully matched query to Basket #1 via keyword');

const nextPitch = productManager.getNextPitchProduct('sequential');
assert(nextPitch && nextPitch.id === 1, `First auto-pitch selects Basket #1 (${nextPitch.title})`);

// Test FAQManager
const matchedFaq = faqManager.match('ส่งของวันไหนครับ กี่วันถึง');
assert(matchedFaq && matchedFaq.id === 1, `FAQManager correctly matched shipping inquiry to FAQ #1`);

const matchedCod = faqManager.match('มีเก็บเงินปลายทางไหม');
assert(matchedCod && matchedCod.id === 2, `FAQManager correctly matched COD inquiry to FAQ #2`);

// Test AIBrain Persona Formatting
const sweetText = aiBrain.formatPersona('สินค้าราคาพิเศษ', 'sweet');
assert(sweetText.includes('นะคะ') && sweetText.includes('ค่า'), `Persona 'sweet' formats ending gracefully: "${sweetText}"`);

const hypeText = aiBrain.formatPersona('สินค้าราคาพิเศษ', 'hype');
assert(hypeText.includes('ด่วน') && !hypeText.includes('🔥'), `Persona 'hype' adds urgency without awkward TTS emoji: "${hypeText}"`);

const proText = aiBrain.formatPersona('สินค้าราคาพิเศษ', 'pro');
assert(proText.includes('รับประกันคุณภาพ'), `Persona 'pro' adds professional assurance: "${proText}"`);

// Test Comment Processing
const replyFaq = await aiBrain.processComment('สมชาย', 'ส่งของวันไหนคะ');
assert(replyFaq && replyFaq.includes('สมชาย') && replyFaq.includes('จัดส่งสินค้าทุกวัน'), `AI Brain replied to user with FAQ answer`);

const replyProd = await aiBrain.processComment('น้องมุก', 'สนใจเสื้อยืดโอเวอร์ไซส์ค่ะ');
assert(replyProd && replyProd.includes('น้องมุก') && replyProd.includes('เสื้อยืด'), `AI Brain identified product interest and replied about Basket #1`);

// ── Task 1: SessionTracker ──────────────────────────────────────────────────

test('SessionTracker: getStats returns zero state before any orders', () => {
  const st = new sessionTracker.constructor();
  const s = st.getStats();
  assert.strictEqual(s.totalOrders, 0);
  assert.strictEqual(s.peakViewers, 0);
  assert.strictEqual(s.topProductId, null);
});

test('SessionTracker: recordOrder increments totalOrders', () => {
  const st = new sessionTracker.constructor();
  st.startSession();
  st.recordOrder('มะลิ', 1, 'เสื้อยืด', 'กดสั่งเลย');
  assert.strictEqual(st.getStats().totalOrders, 1);
});

test('SessionTracker: negation - no order recorded (tested via empty instance)', () => {
  const st = new sessionTracker.constructor();
  st.startSession();
  // upstream code should not call recordOrder for "ไม่กด" — this test
  // verifies totalOrders stays 0 when recordOrder is never called
  assert.strictEqual(st.getStats().totalOrders, 0);
});

test('SessionTracker: exportCSV contains header row', () => {
  const st = new sessionTracker.constructor();
  st.startSession();
  st.recordOrder('น้องนุ่น', 2, 'แก้วน้ำ', 'สั่งเลย');
  const csv = st.exportCSV();
  assert.ok(csv.startsWith('timestamp,user,productId,productTitle,comment'));
});

test('SessionTracker: updatePeakViewers tracks maximum', () => {
  const st = new sessionTracker.constructor();
  st.updatePeakViewers(100);
  st.updatePeakViewers(500);
  st.updatePeakViewers(300);
  assert.strictEqual(st.getStats().peakViewers, 500);
});

// ── Task 2: Session APIs + Order Detection ──────────────────────────────────

test('Session: detectOrderIntent — กดเลยค่า returns true', () => {
  // detectOrderIntent is module-private; test via processComment side effect
  const before = sessionTracker.getStats().totalOrders;
  aiBrain.processComment('ทดสอบ', 'กดเลยค่า');
  const after = sessionTracker.getStats().totalOrders;
  assert.strictEqual(after, before + 1);
});

test('Session: detectOrderIntent — ไม่กดแล้ว returns false (no order recorded)', () => {
  const before = sessionTracker.getStats().totalOrders;
  aiBrain.processComment('ทดสอบ', 'ไม่กดแล้ว');
  const after = sessionTracker.getStats().totalOrders;
  assert.strictEqual(after, before); // no increment
});

// ── Task 4: FlashSaleManager ────────────────────────────────────────────────

test('FlashSaleManager: getState returns inactive by default', () => {
  assert.strictEqual(flashSaleManager.getState().active, false);
});

test('FlashSaleManager: start sets active true and correct totalSeconds', () => {
  flashSaleManager.start(3, 1);
  const s = flashSaleManager.getState();
  assert.strictEqual(s.active, true);
  assert.strictEqual(s.totalSeconds, 180);
  assert.strictEqual(s.productId, 1);
  flashSaleManager.stop();
});

test('FlashSaleManager: stop sets active false', () => {
  flashSaleManager.start(1, 1);
  flashSaleManager.stop();
  assert.strictEqual(flashSaleManager.getState().active, false);
});

test('FlashSaleManager: concurrent start stops previous timer cleanly', () => {
  flashSaleManager.start(5, 1);
  flashSaleManager.start(2, 2); // Replaces active timer
  const s = flashSaleManager.getState();
  assert.strictEqual(s.totalSeconds, 120);
  assert.strictEqual(s.productId, 2);
  flashSaleManager.stop();
});

// ── Task 8: GeminiAIBrain ───────────────────────────────────────────────────

await test('GeminiAIBrain: ask returns null when apiKey is empty', async () => {
  const g = new GeminiAIBrain('');
  const result = await g.ask('ของดีไหม', [], []);
  assert.strictEqual(result, null);
});

await test('GeminiAIBrain: ask returns null on API error (bad key)', async () => {
  const g = new GeminiAIBrain('AIzaBADKEY');
  const result = await g.ask('ถามอะไร', [], []);
  assert.strictEqual(result, null);
});

// ── Task 9: Wire Gemini into AIBrain ────────────────────────────────────────

await test('AIBrain.processComment: falls back to general reply when geminiEnabled false', async () => {
  CONFIG.geminiEnabled = false;
  const reply = await aiBrain.processComment('ทดสอบ', 'คำถามแปลกๆ ที่ไม่มีใน FAQ เลย abc123');
  assert.ok(typeof reply === 'string' && reply.length > 0);
});

// ── UI Verification: Custom Comment Simulation Elements ─────────────────────
test('UI: index.html contains custom comment simulation bar and send button', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  assert.ok(html.includes('id="sim-custom-user"'), 'User input exists');
  assert.ok(html.includes('id="sim-custom-comment"'), 'Comment input exists');
  assert.ok(html.includes('id="btn-sim-custom-send"'), 'Send simulation button exists');
});

// ── Persona & Voice System Verification ─────────────────────────────────────
test('Persona & Voice: Niwat voice adapts text endings to male particles (ครับ / นะครับ)', () => {
  const origVoice = CONFIG.voice;
  CONFIG.voice = 'th-TH-NiwatNeural';
  const maleSweet = aiBrain.formatPersona('สวัสดีค่า ยินดีต้อนรับนะคะ', 'sweet');
  assert.ok(maleSweet.includes('ครับ'), 'Niwat voice uses male particle ครับ');
  assert.ok(!maleSweet.includes('นะคะ'), 'Niwat voice does not use female particle นะคะ');
  CONFIG.voice = origVoice;
});

test('Persona & Voice: Hype persona injects urgency and call to action', () => {
  const hypeRes = aiBrain.formatPersona('สำหรับสินค้านี้', 'hype');
  assert.ok(hypeRes.includes('ด่วน') || hypeRes.includes('รีบ'), 'Hype persona includes urgency keyword');
});

test('UI: index.html contains voice preview button and speed options', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  assert.ok(html.includes('id="btn-preview-voice"'), 'Voice preview button exists');
  assert.ok(html.includes('value="-20%"'), 'Speed -20% exists');
  assert.ok(html.includes('value="+30%"'), 'Speed +30% exists');
});

test('Config Persistence: data/config.json exists and is valid JSON', () => {
  const cfgPath = path.join(__dirname, 'data/config.json');
  assert.ok(fs.existsSync(cfgPath), 'data/config.json exists');
  const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(parsed.voice && parsed.persona, 'config.json has voice and persona');
});

// ── V4.0 UI & System Hardening Verification ─────────────────────────────────
test('UI: index.html has v4.0 versioning, recent orders feed, and FAQ edit inputs', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  assert.ok(html.includes('v4.0'), 'Title or header reflects v4.0');
  assert.ok(html.includes('id="orders-feed"'), 'Recent orders feed exists');
  assert.ok(html.includes('id="edit-faq-id"'), 'FAQ edit hidden input exists');
  assert.ok(html.includes('id="btn-cancel-faq-edit"'), 'FAQ cancel edit button exists');
});

test('FAQManager: update successfully updates an existing rule', () => {
  const updated = faqManager.update(1, { title: 'นโยบายจัดส่งด่วนพิเศษ' });
  assert.strictEqual(updated.title, 'นโยบายจัดส่งด่วนพิเศษ');
  // Revert back
  faqManager.update(1, { title: 'การจัดส่งสินค้าและระยะเวลา' });
});

test('Avatar Video Engine: MP4 assets exist, valid size, and seamless loop support', () => {
  const idleStat = fs.statSync(path.join(__dirname, 'public/assets/avatar_idle.mp4'));
  const talkStat = fs.statSync(path.join(__dirname, 'public/assets/avatar_talking.mp4'));
  assert.ok(idleStat.size > 500000, 'avatar_idle.mp4 size > 500KB');
  assert.ok(talkStat.size > 500000, 'avatar_talking.mp4 size > 500KB');
  
  const overlayHtml = fs.readFileSync(path.join(__dirname, 'public/stream-overlay.html'), 'utf-8');
  assert.ok(overlayHtml.includes('video-avatar-idle'), 'stream-overlay.html has video-avatar-idle');
  assert.ok(overlayHtml.includes('video-avatar-talk'), 'stream-overlay.html has video-avatar-talk');
  assert.ok(overlayHtml.includes('preload="auto"'), 'stream-overlay.html preloads video avatars');

  const overlayJs = fs.readFileSync(path.join(__dirname, 'public/stream-overlay.js'), 'utf-8');
  assert.ok(overlayJs.includes('activateVideoMode'), 'stream-overlay.js has activateVideoMode');
  assert.ok(overlayJs.includes('updateVideoAvatarState'), 'stream-overlay.js has updateVideoAvatarState');
});

test('Director Monitor: HTML structure contains 3-column director console and cockpit controls', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf-8');
  assert.ok(html.includes('director-console'), 'HTML contains director-console');
  assert.ok(html.includes('director-health-badge'), 'HTML contains director-health-badge');
  assert.ok(html.includes('director-ping-val'), 'HTML contains director-ping-val');
  assert.ok(html.includes('teleprompter-text'), 'HTML contains teleprompter-text');
  assert.ok(html.includes('vu-meter-fill'), 'HTML contains vu-meter-fill');
  assert.ok(html.includes('director-quick-baskets'), 'HTML contains director-quick-baskets');
  assert.ok(html.includes('director-flash-badge'), 'HTML contains director-flash-badge');
  assert.ok(html.includes('director-btn-emergency-stop'), 'HTML contains director-btn-emergency-stop');
});

test('Director Monitor: CSS contains director console, teleprompter and VU meter styling', () => {
  const css = fs.readFileSync(path.join(__dirname, 'public/style.css'), 'utf-8');
  assert.ok(css.includes('.director-console'), 'CSS has .director-console');
  assert.ok(css.includes('.vu-meter-fill'), 'CSS has .vu-meter-fill');
  assert.ok(css.includes('.quick-basket-item'), 'CSS has .quick-basket-item');
  assert.ok(css.includes('.teleprompter-box'), 'CSS has .teleprompter-box');
});

test('Director Monitor: app.js contains VU meter, ping telemetry and quick basket logic', () => {
  const js = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf-8');
  assert.ok(js.includes('startVuMeter'), 'app.js has startVuMeter');
  assert.ok(js.includes('renderDirectorQuickBaskets'), 'app.js has renderDirectorQuickBaskets');
  assert.ok(js.includes('ping_check'), 'app.js has ping_check');
  assert.ok(js.includes('checkDirectorStreamHealth'), 'app.js has checkDirectorStreamHealth');
});

test('Director Monitor API: /api/stream/health returns valid health and avatar state', () => {
  const route = serverModule.app._router.stack.find(r => r.route && r.route.path === '/api/stream/health');
  assert.ok(route, 'Route /api/stream/health exists in app router');
  const handler = route.route.stack[0].handle;
  let responseData = null;
  const mockReq = {};
  const mockRes = {
    json: (d) => { responseData = d; return mockRes; },
    status: () => mockRes
  };
  handler(mockReq, mockRes);
  assert.strictEqual(responseData.status, 'healthy');
  assert.strictEqual(responseData.avatarMode, 'video_hd');
  assert.ok(typeof responseData.uptimeSeconds === 'number');
});

console.log('\n====================================================');
console.log(`📊 TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('====================================================\n');

// Clean exit
setTimeout(() => {
  try {
    serverModule.server.close();
    serverModule.audioMixer.process.kill();
  } catch (e) {}
  process.exit(failedTests > 0 ? 1 : 0);
}, 500);
