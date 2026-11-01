import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

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
const { productManager, faqManager, aiBrain, CONFIG } = serverModule;

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
const replyFaq = aiBrain.processComment('สมชาย', 'ส่งของวันไหนคะ');
assert(replyFaq && replyFaq.includes('สมชาย') && replyFaq.includes('จัดส่งสินค้าทุกวัน'), `AI Brain replied to user with FAQ answer`);

const replyProd = aiBrain.processComment('น้องมุก', 'สนใจเสื้อยืดโอเวอร์ไซส์ค่ะ');
assert(replyProd && replyProd.includes('น้องมุก') && replyProd.includes('เสื้อยืด'), `AI Brain identified product interest and replied about Basket #1`);

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
