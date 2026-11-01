import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { WebcastPushConnection } from 'tiktok-live-connector/legacy';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.chdir(__dirname);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next(err);
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/cache', express.static(path.join(__dirname, 'cache')));
app.use('/sounds', express.static(path.join(__dirname, 'sounds')));

// Configuration
const CONFIG = {
  port: parseInt(process.env.PORT) || 3000,
  voice: process.env.TTS_VOICE || 'th-TH-PremwadeeNeural',
  persona: 'sweet', // 'sweet', 'hype', 'pro'
  loopMode: 'sequential', // 'sequential', 'hero_focus', 'shuffle'
  autoPitch: true,
  autoPitchIntervalSeconds: 35,
  respondToComments: true,
  respondToGifts: true,
  respondToJoins: true,
  volume: 1.0,
  rate: '+0%',
  bgmEnabled: false,
  bgmVolume: 0.25,
  autoSfxOnGift: true,
  autoSfxOnPin: true,
  geminiEnabled: false,
  geminiModel: 'gemini-2.0-flash'
};

// ----------------------------------------------------
// 1. Product Manager
// ----------------------------------------------------
class ProductManager {
  constructor() {
    this.filePath = path.join(__dirname, 'data', 'products.json');
    this.products = [];
    this.pinnedId = 1;
    this.lastPitchIndex = -1;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.products = JSON.parse(raw);
        if (this.products.length > 0) {
          this.pinnedId = this.products[0].id;
        }
      }
    } catch (e) {
      console.error('[ProductManager] Failed to load products:', e.message);
      this.products = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.products, null, 2), 'utf-8');
    } catch (e) {
      console.error('[ProductManager] Failed to save products:', e.message);
    }
  }

  getAll() {
    return this.products;
  }

  getById(id) {
    return this.products.find(p => p.id === Number(id));
  }

  getPinned() {
    return this.getById(this.pinnedId) || this.products[0] || null;
  }

  pin(id) {
    const p = this.getById(id);
    if (p) {
      this.pinnedId = p.id;
      return p;
    }
    return null;
  }

  decrementStock(id, count = 1) {
    const p = this.getById(id);
    if (p) {
      p.stock = Math.max(0, (p.stock || 0) - count);
      this.save();
      return p.stock;
    }
    return null;
  }

  addProduct(data) {
    const nextId = this.products.length > 0 ? Math.max(...this.products.map(p => p.id)) + 1 : 1;
    const newP = {
      id: nextId,
      title: String(data.title || '').trim(),
      price: String(data.price || '').trim(),
      originalPrice: String(data.originalPrice || '').trim(),
      stock: parseInt(data.stock) || 50,
      promotion: String(data.promotion || 'โปรโมชั่นพิเศษในไลฟ์').trim(),
      pitchScript: String(data.pitchScript || '').trim(),
      keywords: Array.isArray(data.keywords) ? data.keywords : []
    };
    this.products.push(newP);
    this.save();
    return newP;
  }

  updateProduct(id, data) {
    const p = this.getById(id);
    if (!p) return null;
    if (data.title !== undefined) p.title = String(data.title).trim();
    if (data.price !== undefined) p.price = String(data.price).trim();
    if (data.originalPrice !== undefined) p.originalPrice = String(data.originalPrice).trim();
    if (data.stock !== undefined) p.stock = parseInt(data.stock) || 0;
    if (data.promotion !== undefined) p.promotion = String(data.promotion).trim();
    if (data.pitchScript !== undefined) p.pitchScript = String(data.pitchScript).trim();
    if (data.keywords !== undefined && Array.isArray(data.keywords)) p.keywords = data.keywords;
    this.save();
    return p;
  }

  deleteProduct(id) {
    const idx = this.products.findIndex(p => p.id === Number(id));
    if (idx !== -1) {
      this.products.splice(idx, 1);
      if (this.pinnedId === Number(id)) {
        this.pinnedId = this.products.length > 0 ? this.products[0].id : null;
      }
      this.save();
      return true;
    }
    return false;
  }

  getNextPitchProduct(mode = 'sequential') {
    if (this.products.length === 0) return null;
    if (mode === 'hero_focus') {
      return this.getPinned();
    } else if (mode === 'shuffle') {
      const idx = Math.floor(Math.random() * this.products.length);
      return this.products[idx];
    } else {
      // sequential
      this.lastPitchIndex = (this.lastPitchIndex + 1) % this.products.length;
      return this.products[this.lastPitchIndex];
    }
  }

  findMatchingProduct(query) {
    const q = String(query).toLowerCase();
    for (const p of this.products) {
      if (p.title.toLowerCase().includes(q)) return p;
      if (p.keywords && p.keywords.some(k => q.includes(k.toLowerCase()))) return p;
    }
    return null;
  }
}

// ----------------------------------------------------
// 2. FAQ Manager (Smart Director Keyword Matching)
// ----------------------------------------------------
class FAQManager {
  constructor() {
    this.filePath = path.join(__dirname, 'data', 'faqs.json');
    this.faqs = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.faqs = JSON.parse(raw);
      }
    } catch (e) {
      console.error('[FAQManager] Failed to load faqs:', e.message);
      this.faqs = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.faqs, null, 2), 'utf-8');
    } catch (e) {
      console.error('[FAQManager] Failed to save faqs:', e.message);
    }
  }

  getAll() {
    return this.faqs;
  }

  match(comment) {
    const c = String(comment).toLowerCase();
    for (const faq of this.faqs) {
      if (faq.keywords && faq.keywords.some(k => c.includes(k.toLowerCase()))) {
        return faq;
      }
    }
    return null;
  }

  add(data) {
    const nextId = this.faqs.length > 0 ? Math.max(...this.faqs.map(f => f.id)) + 1 : 1;
    const item = {
      id: nextId,
      title: String(data.title || '').trim(),
      keywords: Array.isArray(data.keywords) ? data.keywords : [],
      answer: String(data.answer || '').trim()
    };
    this.faqs.push(item);
    this.save();
    return item;
  }

  update(id, data) {
    const item = this.faqs.find(f => f.id === Number(id));
    if (!item) return null;
    if (data.title !== undefined) item.title = String(data.title).trim();
    if (data.keywords !== undefined && Array.isArray(data.keywords)) item.keywords = data.keywords;
    if (data.answer !== undefined) item.answer = String(data.answer).trim();
    this.save();
    return item;
  }

  delete(id) {
    const idx = this.faqs.findIndex(f => f.id === Number(id));
    if (idx !== -1) {
      this.faqs.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }
}

// ----------------------------------------------------
// 2.2. Gemini AI Brain
// ----------------------------------------------------
class GeminiAIBrain {
  constructor(apiKey) {
    this.apiKey = (apiKey || '').trim();
    this.ai = null;
    if (this.apiKey) {
      try {
        this.ai = new GoogleGenAI({ apiKey: this.apiKey });
      } catch (err) {
        console.warn('[GeminiAI] Initialization warning:', err.message);
      }
    }
  }

  async ask(comment, products = [], faqs = []) {
    if (!this.ai || !this.apiKey) return null;
    try {
      const productList = products.map(p => `- ตะกร้าที่ ${p.id}: ${p.title} (ราคา ${p.price} บาท)`).join('\n');
      const faqList = faqs.map(f => `- ${f.title}: ${f.answer}`).join('\n');
      const systemPrompt = `คุณคือแม่ค้าสาวไทยใจดีชื่อ "น้องAI" ขายสินค้าในไลฟ์สด TikTok Shop\nสินค้าที่ขายอยู่:\n${productList}\nFAQ ที่รู้:\n${faqList}\nกฎการตอบ: ตอบแบบสั้น กระชับ ภาษาไทย ไม่เกิน 2 ประโยค ห้ามใช้ emoji ห้ามใช้ Markdown`;

      const response = await this.ai.models.generateContent({
        model: CONFIG.geminiModel || 'gemini-2.0-flash',
        contents: comment,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 200
        }
      });
      return response.text?.trim() || null;
    } catch (e) {
      console.warn('[GeminiAI] API call failed (safe fallback):', e.message);
      return null;
    }
  }
}

// ----------------------------------------------------
// 2.5. Session Tracker & Analytics
// ----------------------------------------------------
class SessionTracker {
  constructor() {
    this.orders = [];
    this.peakViewers = 0;
    this.startTime = null;
    this.sessionsDir = path.join(__dirname, 'data', 'sessions');
    try {
      if (!fs.existsSync(this.sessionsDir)) {
        fs.mkdirSync(this.sessionsDir, { recursive: true });
      }
    } catch (err) {
      console.error('Error creating sessions directory:', err);
    }
  }

  startSession() {
    this.orders = [];
    this.peakViewers = 0;
    this.startTime = Date.now();
  }

  recordOrder(user, productId, productTitle, comment) {
    if (comment === undefined && typeof productTitle === 'string') {
      comment = productTitle;
      productTitle = '';
    }
    this.orders.push({
      user,
      productId,
      productTitle: productTitle || '',
      comment: comment || '',
      timestamp: new Date().toISOString()
    });
  }

  updatePeakViewers(count) {
    const num = Number(count) || 0;
    this.peakViewers = Math.max(this.peakViewers, num);
  }

  getStats() {
    let topProductId = null;
    if (this.orders.length > 0) {
      const counts = {};
      let maxCount = 0;
      for (const order of this.orders) {
        const pid = order.productId;
        counts[pid] = (counts[pid] || 0) + 1;
        if (counts[pid] > maxCount) {
          maxCount = counts[pid];
          topProductId = pid;
        }
      }
    }

    return {
      orders: this.orders,
      totalOrders: this.orders.length,
      topProductId,
      peakViewers: this.peakViewers,
      durationMs: this.startTime ? Date.now() - this.startTime : 0,
      startTime: this.startTime
    };
  }

  exportCSV() {
    const header = 'timestamp,user,productId,productTitle,comment';
    if (this.orders.length === 0) {
      return header;
    }
    const rows = this.orders.map(o => `${o.timestamp},${o.user},${o.productId},${o.productTitle},${o.comment}`);
    return [header, ...rows].join('\n');
  }

  saveSession() {
    try {
      if (!fs.existsSync(this.sessionsDir)) {
        fs.mkdirSync(this.sessionsDir, { recursive: true });
      }
      const d = new Date(this.startTime || Date.now());
      const pad = (n) => String(n).padStart(2, '0');
      const filename = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
      const filePath = path.join(this.sessionsDir, filename);
      const data = {
        ...this.getStats(),
        savedAt: new Date().toISOString()
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving session:', err);
    }
  }
}

class FlashSaleManager {
  constructor() {
    this.active = false;
    this.remainingSeconds = 0;
    this.totalSeconds = 0;
    this.productId = null;
    this.halfAlertTriggered = false;
    this.oneMinAlertTriggered = false;
    this._interval = null;
  }

  start(durationMinutes = 5, productId = null) {
    this.stop(); // Stop any existing running timer cleanly

    this.active = true;
    this.productId = productId !== null ? Number(productId) : null;
    this.totalSeconds = Math.max(10, Math.round(Number(durationMinutes) * 60));
    this.remainingSeconds = this.totalSeconds;
    this.halfAlertTriggered = false;
    this.oneMinAlertTriggered = false;

    // Determine product title for alert
    let prodTitle = 'สินค้าโปรพิเศษ';
    if (this.productId && typeof productManager !== 'undefined') {
      const p = productManager.getById(this.productId);
      if (p) prodTitle = p.title || `ตะกร้าที่ ${p.id}`;
    }

    // Start Alert: AI Speech (Priority 1, no emoji)
    if (typeof aiBrain !== 'undefined') {
      const mins = Math.round(this.totalSeconds / 60);
      const startSpeech = `ทุกคนคะ Flash Sale เริ่มแล้ว! ${prodTitle} ราคาพิเศษใน ${mins} นาทีเท่านั้นนะคะ รีบกดสั่งได้เลยค่า!`;
      aiBrain.enqueue(startSpeech, 1, { type: 'flash_sale', event: 'start', productId: this.productId });
    }

    if (typeof io !== 'undefined') {
      io.emit('flash_sale_tick', this.getState());
    }

    const halfPoint = Math.floor(this.totalSeconds / 2);

    this._interval = setInterval(() => {
      if (!this.active) {
        clearInterval(this._interval);
        this._interval = null;
        return;
      }

      this.remainingSeconds--;

      // Half-way alert
      if (!this.halfAlertTriggered && this.remainingSeconds <= halfPoint && this.remainingSeconds > 60) {
        this.halfAlertTriggered = true;
        if (typeof aiBrain !== 'undefined') {
          aiBrain.enqueue('ทุกคนคะ เวลา Flash Sale เหลือครึ่งทางแล้วนะคะ ใครยังไม่ได้กดรีบเลยค่า!', 1, { type: 'flash_sale', event: 'half' });
        }
      }

      // 60-second remaining alert
      if (!this.oneMinAlertTriggered && this.remainingSeconds <= 60 && this.remainingSeconds > 0 && this.totalSeconds > 60) {
        this.oneMinAlertTriggered = true;
        if (typeof aiBrain !== 'undefined') {
          aiBrain.enqueue('เหลือเวลาอีกแค่ 1 นาทีเท่านั้นนะคะ โปรหมดแล้วหมดเลยจ้า!', 1, { type: 'flash_sale', event: '1min' });
        }
      }

      // End alert
      if (this.remainingSeconds <= 0) {
        this.stop();
        if (typeof aiBrain !== 'undefined') {
          aiBrain.enqueue('หมดเวลา Flash Sale แล้วนะคะ ขอบคุณทุกคนที่ร่วมสนุกกันค่า!', 1, { type: 'flash_sale', event: 'end' });
        }
        return;
      }

      if (typeof io !== 'undefined') {
        io.emit('flash_sale_tick', this.getState());
      }
    }, 1000);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    const wasActive = this.active;
    this.active = false;
    this.remainingSeconds = 0;
    if (wasActive && typeof io !== 'undefined') {
      io.emit('flash_sale_stopped', {});
    }
  }

  getState() {
    return {
      active: this.active,
      remainingSeconds: this.remainingSeconds,
      totalSeconds: this.totalSeconds,
      productId: this.productId
    };
  }
}

// ----------------------------------------------------
// 3. Audio Mixer Child Process Bridge
// ----------------------------------------------------
class AudioMixerBridge {
  constructor() {
    this.process = null;
    this.isReady = false;
    this.currentSpeechId = null;
    this.init();
  }

  init() {
    const scriptPath = path.join(__dirname, 'tts_mixer.py');
    this.process = spawn('python', ['-u', scriptPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1'
      }
    });

    this.process.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed);
          this.handleEvent(evt);
        } catch (e) {
          // not json
        }
      }
    });

    this.process.on('close', (code) => {
      console.warn(`[AudioMixer] Python process exited with code ${code}. Restarting...`);
      this.isReady = false;
      setTimeout(() => this.init(), 2000);
    });
  }

  send(cmdObj) {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write(JSON.stringify(cmdObj) + '\n');
    }
  }

  handleEvent(evt) {
    if (evt.event === 'ready') {
      this.isReady = true;
      console.log('[AudioMixer] Python Multi-Channel Audio Mixer Ready!');
    } else if (evt.event === 'speech_started') {
      this.currentSpeechId = evt.id;
      io.emit('tts_event', { 
        event: 'playing', 
        data: { 
          id: evt.id, 
          text: evt.text, 
          audioUrl: evt.audio_url || null,
          fallback: false 
        } 
      });
    } else if (evt.event === 'speech_fallback') {
      console.warn('[AudioMixer] Speech synthesis fallback for:', evt.text);
      this.currentSpeechId = evt.id;
      io.emit('tts_event', { 
        event: 'playing', 
        data: { 
          id: evt.id, 
          text: evt.text, 
          audioUrl: null,
          fallback: true 
        } 
      });
      // Safety auto-finish after calculated speaking duration
      const durationMs = Math.min(12000, Math.max(2500, (evt.text || '').length * 130));
      setTimeout(() => {
        if (this.currentSpeechId === evt.id) {
          this.currentSpeechId = null;
          io.emit('tts_event', { event: 'finished', data: { id: evt.id } });
          if (this.onSpeechFinished) this.onSpeechFinished();
        }
      }, durationMs);
    } else if (evt.event === 'speech_finished') {
      this.currentSpeechId = null;
      io.emit('tts_event', { event: 'finished', data: { id: evt.id } });
      if (this.onSpeechFinished) this.onSpeechFinished();
    } else if (evt.event === 'speech_stopped') {
      this.currentSpeechId = null;
      io.emit('tts_event', { event: 'stopped' });
      if (this.onSpeechFinished) this.onSpeechFinished();
    } else if (evt.event === 'error') {
      console.error('[AudioMixer] Error:', evt.message);
      io.emit('tts_event', { event: 'error', error: evt.message });
      if (this.onSpeechFinished) this.onSpeechFinished();
    }
  }

  speak(text, options = {}) {
    const speechId = `spk_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.send({
      command: 'speak',
      text,
      id: speechId,
      voice: options.voice || CONFIG.voice,
      rate: options.rate || CONFIG.rate
    });
    return speechId;
  }

  stopSpeech() {
    this.send({ command: 'stop_speech' });
  }

  playSfx(name, volume = 0.8) {
    this.send({ command: 'play_sfx', name, volume });
  }

  setBgm(enabled, volume = CONFIG.bgmVolume) {
    this.send({ command: 'set_bgm', enabled, volume });
  }

  setBgmVolume(volume) {
    this.send({ command: 'set_bgm_volume', volume });
  }
}

const ORDER_KEYWORDS = ['กด','สั่ง','โอน','ซื้อ','จ่าย','จอง','เอา','ขอ','1ชิ้น','2ชิ้น','3ชิ้น'];
const NEGATION_PREFIXES = ['ไม่','ยัง','ยังไม่'];

function detectOrderIntent(comment) {
  const c = String(comment).toLowerCase();
  if (NEGATION_PREFIXES.some(n => c.startsWith(n))) return false;
  return ORDER_KEYWORDS.some(k => c.includes(k));
}

// ----------------------------------------------------
// 4. AI Brain (Smart Director Logic)
// ----------------------------------------------------
class AIBrain {
  constructor(productMgr, faqMgr, mixer) {
    this.products = productMgr;
    this.faqs = faqMgr;
    this.mixer = mixer;
    this.speechQueue = [];
    this.isSpeaking = false;
    this.lastSpeechTime = Date.now();
  }

  enqueue(text, priority = 3, meta = {}) {
    // Priorities: 1 = urgent/gift, 2 = comment reply, 3 = pitch/welcome
    let finalText = text;
    if (meta.type === 'chat' || meta.type === 'faq') {
      finalText = this.formatPersona(text);
    }
    const item = { text: finalText, priority, meta, time: Date.now() };
    if (priority === 1) {
      // High priority jumps to front of queue
      this.speechQueue.unshift(item);
    } else {
      this.speechQueue.push(item);
    }
    this.processQueue();
  }

  processQueue() {
    if (this.isSpeaking || this.speechQueue.length === 0) return;
    const next = this.speechQueue.shift();
    this.isSpeaking = true;
    this.lastSpeechTime = Date.now();

    // Safety watchdog: Automatically unfreeze if stuck in speaking state for > 15 seconds
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      if (this.isSpeaking) {
        console.warn('[AIBrain] Speech timeout watchdog fired. Resetting queue.');
        this.onSpeechFinished();
      }
    }, 15000);

    this.mixer.speak(next.text, {
      voice: CONFIG.voice,
      rate: CONFIG.rate
    });

    io.emit('ai_speaking', {
      text: next.text,
      meta: next.meta,
      timestamp: new Date().toLocaleTimeString()
    });
  }

  onSpeechFinished() {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.isSpeaking = false;
    this.lastSpeechTime = Date.now();
    setTimeout(() => this.processQueue(), 400); // 400ms natural breath pause between sentences
  }

  formatPersona(text, persona = CONFIG.persona) {
    if (!text) return text;
    if (persona === 'sweet') {
      if (!text.endsWith('นะคะ') && !text.endsWith('ค่ะ') && !text.endsWith('ค่า') && !text.endsWith('จ้ะ')) {
        return text + ' นะคะ ยินดีต้อนรับค่า';
      }
    } else if (persona === 'hype') {
      if (!text.includes('ด่วน') && !text.includes('รีบ')) {
        return text + ' ด่วนๆ เลยค่า กดสั่งตอนนี้รับส่วนลดทันที ช้าหมดอดนะจ๊ะ!';
      }
    } else if (persona === 'pro') {
      if (!text.endsWith('ครับ') && !text.endsWith('ค่ะ')) {
        return text + ' ทางร้านรับประกันคุณภาพ มั่นใจได้ร้อยเปอร์เซ็นต์ครับ';
      }
    }
    return text;
  }

  async processComment(user, comment) {
    // Order intent detection (DO NOT REMOVE)
    if (detectOrderIntent(comment)) {
      const pinned = this.products.getPinned();
      sessionTracker.recordOrder(user, pinned?.id ?? null, pinned?.title ?? '', comment);
      io.emit('session_order', sessionTracker.getStats());
    }

    // 1. Check FAQ Rules
    const faq = this.faqs.match(comment);
    if (faq) {
      const resp = `คุณ ${user} คะ ${faq.answer}`;
      this.enqueue(resp, 2, { type: 'faq', user, comment });
      return resp;
    }

    // 2. Check Product match
    const prod = this.products.findMatchingProduct(comment);
    if (prod) {
      this.products.pin(prod.id);
      io.emit('pinned_updated', prod);
      if (CONFIG.autoSfxOnPin) this.mixer.playSfx('ding', 0.8);
      const resp = `สำหรับคุณ ${user} สนใจ ${prod.title} ในตะกร้าที่ ${prod.id} นะคะ วันนี้ราคาพิเศษเพียง ${prod.price} บาทเท่านั้น รีบกดตะกร้าซ้ายล่างได้เลยค่า`;
      this.enqueue(resp, 2, { type: 'product', user, comment, product: prod });
      return resp;
    }

    // 3. Gemini AI Smart FAQ Fallback (when enabled)
    if (CONFIG.geminiEnabled && typeof geminiAI !== 'undefined' && geminiAI) {
      try {
        const aiReply = await geminiAI.ask(
          `ลูกค้าชื่อ ${user} ถามว่า: ${comment}`,
          this.products.getAll(),
          this.faqs.getAll()
        );
        if (aiReply) {
          this.enqueue(aiReply, 2, { type: 'gemini_faq', user, comment });
          return aiReply;
        }
      } catch (err) {
        console.warn('[AIBrain] Gemini call error, falling back to general reply:', err.message);
      }
    }

    // 4. General engaging reply
    const generalReplies = [
      `สวัสดีคุณ ${user} นะคะ ขอบคุณที่แวะเข้ามาทักทายกันในไลฟ์ค่า สนใจชิ้นไหนจิ้มตะกร้าได้เลยน้า`,
      `ขอบคุณคอมเมนต์จากคุณ ${user} มากๆ นะคะ สินค้าพร้อมส่งทุกตะกร้าเลยค่า สอบถามเพิ่มเติมได้เลยนะคะ`,
      `คุณ ${user} แวะมาดูสินค้าคุณภาพ ราคาพิเศษวันนี้ได้เลยค่า สั่งในไลฟ์ส่งฟรีทุกออเดอร์นะคะ`
    ];
    const pick = generalReplies[Math.floor(Math.random() * generalReplies.length)];
    this.enqueue(pick, 3, { type: 'chat', user, comment });
    return pick;
  }

  processGift(user, giftName, repeatCount = 1) {
    if (CONFIG.autoSfxOnGift) {
      this.mixer.playSfx('cheer', 0.9);
    }
    const thankMsg = `ขอบคุณคุณ ${user} มากๆ เลยนะคะ สำหรับ ${giftName} ${repeatCount > 1 ? `จำนวน ${repeatCount} ชิ้น` : ''} ขอให้เฮงๆ รวยๆ สุขภาพแข็งแรงนะคะ ขอบคุณค่า!`;
    this.enqueue(thankMsg, 1, { type: 'gift', user, giftName, repeatCount });
  }

  processJoin(user) {
    if (!CONFIG.respondToJoins) return;
    const welcomes = [
      `สวัสดีค่าคุณ ${user} ยินดีต้อนรับเข้าสู่ไลฟ์สดนะคะ เข้ามาแล้วอย่าลืมกดติดตามและกดดูตะกร้าได้เลยค่า`,
      `ยินดีต้อนรับคุณ ${user} นะคะ วันนี้มีโปรพิเศษส่งฟรีในไลฟ์ จิ้มดูตะกร้าซ้ายล่างได้เลยน้า`
    ];
    const w = welcomes[Math.floor(Math.random() * welcomes.length)];
    this.enqueue(w, 3, { type: 'join', user });
  }

  triggerAutoPitch() {
    if (this.isSpeaking || this.speechQueue.length > 0) return;
    const prod = this.products.getNextPitchProduct(CONFIG.loopMode);
    if (!prod) return;

    this.products.pin(prod.id);
    io.emit('pinned_updated', prod);
    if (CONFIG.autoSfxOnPin) this.mixer.playSfx('ding', 0.6);

    const pitch = prod.pitchScript || `ตอนนี้กำลังปักหมุดตะกร้าที่ ${prod.id} ${prod.title} ราคาพิเศษ ${prod.price} บาทนะคะ สินค้ามีจำนวนจำกัด กดสั่งได้เลยค่า`;
    this.enqueue(pitch, 3, { type: 'pitch', product: prod });
  }

  generateUrgencySpeech(prod) {
    return `ทุกคนคะ ตะกร้าที่ ${prod.id} ${prod.title} ตอนนี้เหลือสต็อกเพียง ${prod.stock} ชิ้นสุดท้ายแล้วนะคะ ใครที่เล็งไว้อยู่ รีบกดสั่งและชำระเงินด่วนเลยค่า หมดแล้วหมดเลยนะคะ!`;
  }
}

// ----------------------------------------------------
// 5. Initialize Managers
// ----------------------------------------------------
const productManager = new ProductManager();
const faqManager = new FAQManager();
const audioMixer = new AudioMixerBridge();
const aiBrain = new AIBrain(productManager, faqManager, audioMixer);
const sessionTracker = new SessionTracker();
const flashSaleManager = new FlashSaleManager();
const geminiAI = new GeminiAIBrain(process.env.GEMINI_API_KEY || '');

// Forward mixer speech finished callback to AI Brain queue
audioMixer.onSpeechFinished = () => {
  aiBrain.onSpeechFinished();
};

// Forward mixer speech events to AI Brain queue
io.on('connection', (socket) => {
  socket.emit('init_state', {
    config: CONFIG,
    products: productManager.getAll(),
    pinnedProduct: productManager.getPinned(),
    faqs: faqManager.getAll()
  });
});

// Watch speech finish to trigger queue
let previousTtsStatus = null;
app.post('/api/internal/tts-hook', (req, res) => {
  res.json({ ok: true });
});

// Socket event from internal mixer
audioMixer.process.stdout.on('data', () => {
  // checked in bridge
});

// Periodic Quiet Room Detector (Smart Director Auto-Pitch)
setInterval(() => {
  if (CONFIG.autoPitch) {
    const elapsed = Date.now() - aiBrain.lastSpeechTime;
    if (elapsed > CONFIG.autoPitchIntervalSeconds * 1000) {
      aiBrain.triggerAutoPitch();
    }
  }
}, 5000);

// ----------------------------------------------------
// 6. TikTok Live Connector
// ----------------------------------------------------
let tiktokConnection = null;
let currentTikTokUsername = '';

function connectTikTok(username) {
  if (tiktokConnection) {
    try { tiktokConnection.disconnect(); } catch (e) {}
  }

  currentTikTokUsername = username;
  tiktokConnection = new WebcastPushConnection(username, {
    processInitialData: false,
    enableExtendedGiftInfo: true,
    clientParams: {
      app_language: 'th-TH',
      webcast_language: 'th-TH'
    }
  });

  tiktokConnection.connect()
    .then(state => {
      console.log(`[TikTok] Connected to @${username} (Room ID: ${state.roomId})`);
      io.emit('tiktok_status', { connected: true, username, roomId: state.roomId });
      sessionTracker.startSession();
    })
    .catch(err => {
      console.error(`[TikTok] Connection error:`, err.message);
      io.emit('tiktok_status', { connected: false, error: err.message, username });
    });

  tiktokConnection.on('chat', async data => {
    const chatMsg = {
      user: data.nickname || data.uniqueId,
      comment: data.comment,
      timestamp: new Date().toLocaleTimeString()
    };
    io.emit('chat_message', chatMsg);
    if (CONFIG.respondToComments) {
      await aiBrain.processComment(chatMsg.user, chatMsg.comment);
    }
  });

  tiktokConnection.on('gift', data => {
    const giftMsg = {
      user: data.nickname || data.uniqueId,
      giftName: data.giftName,
      repeatCount: data.repeatCount || 1,
      diamonds: data.diamondCount || 0,
      timestamp: new Date().toLocaleTimeString()
    };
    io.emit('gift_event', giftMsg);
    if (CONFIG.respondToGifts) {
      aiBrain.processGift(giftMsg.user, giftMsg.giftName, giftMsg.repeatCount);
    }
  });

  tiktokConnection.on('member', data => {
    const joinMsg = {
      user: data.nickname || data.uniqueId,
      timestamp: new Date().toLocaleTimeString()
    };
    io.emit('member_join', joinMsg);
    if (CONFIG.respondToJoins) {
      aiBrain.processJoin(joinMsg.user);
    }
  });

  tiktokConnection.on('roomUser', data => {
    sessionTracker.updatePeakViewers(data.viewerCount);
    io.emit('stats_update', { viewerCount: data.viewerCount });
  });

  tiktokConnection.on('disconnected', () => {
    console.log('[TikTok] Disconnected from live stream.');
    io.emit('tiktok_status', { connected: false, username: currentTikTokUsername });
  });
}

// ----------------------------------------------------
// 7. REST API Endpoints
// ----------------------------------------------------

// Status & Config
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    connected: tiktokConnection && tiktokConnection.isConnected,
    username: currentTikTokUsername,
    config: CONFIG,
    pinnedProduct: productManager.getPinned()
  });
});

app.post('/api/config', (req, res) => {
  Object.assign(CONFIG, req.body);
  io.emit('config_updated', CONFIG);
  res.json({ success: true, config: CONFIG });
});

// TikTok Connect/Disconnect
app.post('/api/tiktok/connect', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  connectTikTok(username);
  res.json({ success: true, connectingTo: username });
});

app.post('/api/tiktok/disconnect', (req, res) => {
  if (tiktokConnection) {
    tiktokConnection.disconnect();
    tiktokConnection = null;
  }
  res.json({ success: true, disconnected: true });
});

// Product APIs
app.get('/api/products', (req, res) => res.json(productManager.getAll()));

app.post('/api/products', (req, res) => {
  const p = productManager.addProduct(req.body);
  io.emit('products_updated', productManager.getAll());
  res.json({ success: true, product: p });
});

app.put('/api/products/:id', (req, res) => {
  const p = productManager.updateProduct(req.params.id, req.body);
  if (!p) return res.status(404).json({ error: 'Not found' });
  io.emit('products_updated', productManager.getAll());
  io.emit('pinned_updated', productManager.getPinned());
  res.json({ success: true, product: p });
});

app.delete('/api/products/:id', (req, res) => {
  const ok = productManager.deleteProduct(req.params.id);
  io.emit('products_updated', productManager.getAll());
  io.emit('pinned_updated', productManager.getPinned());
  res.json({ success: ok });
});

app.post('/api/products/:id/pin', (req, res) => {
  const p = productManager.pin(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (CONFIG.autoSfxOnPin) audioMixer.playSfx('ding', 0.8);
  io.emit('pinned_updated', p);
  const pinSpeech = `ตอนนี้ปักหมุดตะกร้าที่ ${p.id} ${p.title} แล้วนะคะ สนใจสั่งซื้อจิ้มตะกร้าได้เลยค่า`;
  aiBrain.enqueue(pinSpeech, 2, { type: 'pin', product: p });
  res.json({ success: true, product: p });
});

app.post('/api/products/:id/urgency', (req, res) => {
  const p = productManager.getById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  audioMixer.playSfx('cash', 0.9);
  const urgencyText = aiBrain.generateUrgencySpeech(p);
  aiBrain.enqueue(urgencyText, 1, { type: 'urgency', product: p });
  res.json({ success: true, alertText: urgencyText });
});

app.post('/api/products/:id/decrement', (req, res) => {
  const newStock = productManager.decrementStock(req.params.id, 1);
  if (newStock === null) return res.status(404).json({ error: 'Not found' });
  audioMixer.playSfx('cash', 0.7);
  io.emit('products_updated', productManager.getAll());
  res.json({ success: true, newStock });
});

// FAQ APIs
app.get('/api/faqs', (req, res) => res.json(faqManager.getAll()));

app.post('/api/faqs', (req, res) => {
  const f = faqManager.add(req.body);
  io.emit('faqs_updated', faqManager.getAll());
  res.json({ success: true, faq: f });
});

app.put('/api/faqs/:id', (req, res) => {
  const f = faqManager.update(req.params.id, req.body);
  if (!f) return res.status(404).json({ error: 'Not found' });
  io.emit('faqs_updated', faqManager.getAll());
  res.json({ success: true, faq: f });
});

app.delete('/api/faqs/:id', (req, res) => {
  const ok = faqManager.delete(req.params.id);
  io.emit('faqs_updated', faqManager.getAll());
  res.json({ success: ok });
});

// Session Analytics APIs
app.get('/api/session/stats', (req, res) => res.json(sessionTracker.getStats()));

app.post('/api/session/start', (req, res) => {
  sessionTracker.startSession();
  io.emit('session_started', sessionTracker.getStats());
  res.json({ success: true });
});

app.get('/api/session/export-csv', (req, res) => {
  const csv = sessionTracker.exportCSV();
  const filename = `session_${new Date().toISOString().slice(0,10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv); // UTF-8 BOM for Excel Thai
});

// Flash Sale APIs
app.post('/api/flash-sale/start', (req, res) => {
  const mins = parseInt(req.body?.durationMinutes) || 5;
  const pid = req.body?.productId !== undefined ? parseInt(req.body.productId) : (productManager.getPinned()?.id || 1);
  flashSaleManager.start(mins, pid);
  res.json({ success: true, state: flashSaleManager.getState() });
});

app.post('/api/flash-sale/stop', (req, res) => {
  flashSaleManager.stop();
  res.json({ success: true, state: flashSaleManager.getState() });
});

app.get('/api/flash-sale/state', (req, res) => {
  res.json(flashSaleManager.getState());
});

// Speech & Sound APIs
app.post('/api/speak', (req, res) => {
  const { text, priority } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  aiBrain.enqueue(text, priority || 2, { type: 'manual' });
  res.json({ success: true, queued: text });
});

app.post('/api/stop-speech', (req, res) => {
  audioMixer.stopSpeech();
  aiBrain.speechQueue = [];
  aiBrain.isSpeaking = false;
  res.json({ success: true, stopped: true });
});

app.post('/api/sfx/:name', (req, res) => {
  const { name } = req.params;
  const vol = parseFloat(req.body?.volume) || 0.8;
  audioMixer.playSfx(name, vol);
  res.json({ success: true, played: name });
});

app.post('/api/bgm/toggle', (req, res) => {
  CONFIG.bgmEnabled = !CONFIG.bgmEnabled;
  audioMixer.setBgm(CONFIG.bgmEnabled, CONFIG.bgmVolume);
  io.emit('config_updated', CONFIG);
  res.json({ success: true, bgmEnabled: CONFIG.bgmEnabled });
});

app.post('/api/bgm/volume', (req, res) => {
  const vol = Math.max(0, Math.min(1, parseFloat(req.body?.volume) || 0.25));
  CONFIG.bgmVolume = vol;
  audioMixer.setBgmVolume(vol);
  io.emit('config_updated', CONFIG);
  res.json({ success: true, volume: vol });
});

// Simulation API (Test without needing live TikTok session)
app.post('/api/simulate', async (req, res) => {
  const { type, user, comment, giftName, repeatCount } = req.body;
  if (type === 'chat') {
    const chatMsg = {
      user: String(user || 'คุณลูกค้า').trim(),
      comment: String(comment || 'สวัสดีค่า').trim(),
      timestamp: new Date().toLocaleTimeString(),
      simulated: true
    };
    io.emit('chat_message', chatMsg);
    const resp = await aiBrain.processComment(chatMsg.user, chatMsg.comment);
    return res.json({ success: true, type, message: chatMsg, response: resp });
  } else if (type === 'gift') {
    const giftMsg = {
      user: String(user || 'VIP ผู้ใจดี').trim(),
      giftName: String(giftName || 'ดอกกุหลาบ').trim(),
      repeatCount: parseInt(repeatCount) || 1,
      timestamp: new Date().toLocaleTimeString(),
      simulated: true
    };
    io.emit('gift_event', giftMsg);
    aiBrain.processGift(giftMsg.user, giftMsg.giftName, giftMsg.repeatCount);
    return res.json({ success: true, type, gift: giftMsg });
  } else if (type === 'join') {
    const joinMsg = {
      user: String(user || 'ผู้ใช้ใหม่').trim(),
      timestamp: new Date().toLocaleTimeString(),
      simulated: true
    };
    io.emit('member_join', joinMsg);
    aiBrain.processJoin(joinMsg.user);
    return res.json({ success: true, type, join: joinMsg });
  }
  res.status(400).json({ error: 'Invalid simulation type' });
});

// One-Click AI Script Generator (Inspired by BocaLive!)
app.post('/api/ai/generate-script', (req, res) => {
  const { title, highlights, price, promo } = req.body;
  if (!title) return res.status(400).json({ error: 'Product title required' });

  const safeTitle = String(title).trim();
  const safePrice = String(price || '199').trim();
  const safePromo = String(promo || 'ส่งฟรีในไลฟ์').trim();
  const safeHighlights = String(highlights || 'ผ้านุ่ม ใส่สบาย คุณภาพพรีเมียม').trim();

  const scripts = {
    sweet: `สวัสดีค่าทุกคน สำหรับชิ้นนี้นะคะเป็น ${safeTitle} บอกเลยว่าน่ารักมากๆ ${safeHighlights} วันนี้ในไลฟ์จัดโปรพิเศษเพียง ${safePrice} บาท พร้อม ${safePromo} ทันที ใครสนใจจิ้มตะกร้าซ้ายล่างได้เลยนะคะ`,
    hype: `🔥 ด่วนที่สุดในไลฟ์นี้! ${safeTitle} มาแล้วจ้า! ${safeHighlights} ปกติตัวละเกือบห้าร้อย วันนี้ในไลฟ์เทขายเพียง ${safePrice} บาทเท่านั้น! แถม ${safePromo} ด่วนๆ เลยจ้า เหลือไม่กี่ชิ้นแล้ว จิ้มตะกร้าด่วนๆ!`,
    pro: `ขอแนะนำ ${safeTitle} ชิ้นนี้ครับ คัดสรรคุณภาพระดับพรีเมียม ${safeHighlights} เหมาะสำหรับการใช้งานในทุกๆ วัน วันนี้มีข้อเสนอพิเศษในไลฟ์ ${safePrice} บาท มีการรับประกันสินค้าพร้อม ${safePromo} สั่งซื้อได้ทันทีที่ตะกร้าด้านล่างครับ`
  };

  res.json({ success: true, scripts });
});

// Stream Overlay page route
app.get('/stream-overlay', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'stream-overlay.html'));
});

// Start Server
server.listen(CONFIG.port, () => {
  console.log(`=======================================================`);
  console.log(`  🚀 TikTok Live AI Automated Selling System v3.0.0`);
  console.log(`  🌐 Dashboard:       http://localhost:${CONFIG.port}`);
  console.log(`  📺 Stream Overlay:  http://localhost:${CONFIG.port}/stream-overlay`);
  console.log(`=======================================================`);
});

export {
  app,
  server,
  io,
  CONFIG,
  productManager,
  faqManager,
  audioMixer,
  aiBrain,
  sessionTracker,
  flashSaleManager,
  GeminiAIBrain,
  geminiAI
};

