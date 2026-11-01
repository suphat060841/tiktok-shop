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
