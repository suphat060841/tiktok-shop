import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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
app.use(express.json({ limit: '35mb' }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next(err);
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/cache', express.static(path.join(__dirname, 'cache')));
app.use('/sounds', express.static(path.join(__dirname, 'sounds')));

// Configuration Manager (Persistent to data/config.json)
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');

function loadConfig() {
  const defaults = {
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
    geminiModel: 'gemini-3.8-flash',
    voice_mode: 'neural', // 'neural' or 'replicated'
    replicated_voice_id: null,
    avatar_mode: 'video_hd',
    avatar_fps: 30
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const saved = JSON.parse(raw);
      return Object.assign(defaults, saved, { port: defaults.port });
    }
  } catch (err) {
    console.warn('[Config] Failed to load data/config.json:', err.message);
  }
  return defaults;
}

function saveConfig(cfg) {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Config] Failed to save data/config.json:', err.message);
  }
}

const CONFIG = loadConfig();

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
      const isMale = (CONFIG.voice || '').includes('Niwat');
      const persona = CONFIG.persona || 'sweet';
      const selfTitle = isMale ? 'พ่อค้าหนุ่ม' : 'แม่ค้าสาว';
      const polite = isMale ? 'ครับ' : 'ค่ะ';

      let styleDesc = 'บุคลิกอ่อนหวาน สดใส น่ารัก เป็นกันเอง พูดเพราะ (ลงท้ายด้วยนะคะ/ค่า หรือนะครับ/ครับ)';
      if (persona === 'hype') {
        styleDesc = 'บุคลิกสายไฮป์ พลังงานสูง ตื่นเต้น เร้าใจ เน้นเร่งปิดยอด กระตุ้นให้รีบกดตะกร้าด่วนๆ ช้าหมดอดโปร';
      } else if (persona === 'pro') {
        styleDesc = 'บุคลิกผู้เชี่ยวชาญมืออาชีพ สุภาพ ชัดเจน น่าเชื่อถือ ให้ข้อมูลแม่นยำ ตรงประเด็น มั่นใจในคุณภาพ';
      }

      const productList = products.map(p => `- ตะกร้าที่ ${p.id}: ${p.title} (ราคา ${p.price} บาท)`).join('\n');
      const faqList = faqs.map(f => `- ${f.title}: ${f.answer}`).join('\n');
      const systemPrompt = `คุณคือ${selfTitle}ชื่อ "น้องAI" ขายสินค้าในไลฟ์สด TikTok Shop\nสไตล์การพูด: ${styleDesc}\nคำลงท้าย: ลงท้ายด้วย "${polite}" เสมอ (ห้ามใช้คำลงท้ายของเพศตรงข้าม)\nสินค้าที่ขายอยู่:\n${productList}\nFAQ ที่รู้:\n${faqList}\nกฎการตอบ: ตอบแบบสั้น กระชับ ภาษาไทย ไม่เกิน 2 ประโยค ห้ามใช้ emoji ห้ามใช้ Markdown`;

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

  async replicateVoice(sourceAudioB64, consentAudioB64, displayName = 'Shop Owner') {
    if (!this.ai || !this.apiKey) {
      throw new Error('Gemini API key is not configured');
    }
    const voice = await this.ai.voices.create({
      store: true,
      voice: {
        model: 'gemini-3.8-flash-tts',
        type: 'replicated',
        display_name: displayName,
        replicated: {
          source_audio: {
            mime_type: 'audio/wav',
            data: sourceAudioB64
          },
          consent_audio: {
            mime_type: 'audio/wav',
            data: consentAudioB64 || sourceAudioB64
          }
        }
      }
    });
    return voice.id;
  }

  async synthesizeReplicated(text, voiceId) {
    if (!this.ai || !this.apiKey || !voiceId) return null;
    const clean = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/[*#_~`]/g, '').trim();
    if (!clean) return null;

    const hash = crypto.createHash('md5').update(`gemini_${voiceId}_${clean}`).digest('hex');
    const cacheDir = path.join(__dirname, 'cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const outPath = path.join(cacheDir, `${hash}.wav`);

    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
      return outPath;
    }

    const interaction = await this.ai.interactions.create({
      model: 'gemini-3.8-flash-tts',
      input: [{
        type: 'user_input',
        content: [{
          type: 'text',
          text: clean,
          annotations: [{
            type: 'speech_metadata',
            style: 'natural Thai live seller, enthusiastic and engaging'
          }]
        }]
      }],
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: [
          { voice: voiceId }
        ]
      }
    });

    let audioBase64 = interaction.output_audio?.data;
    if (!audioBase64 && interaction.steps) {
      for (const step of interaction.steps) {
        if (step.type === 'model_output' && step.content) {
          const a = step.content.find(c => c.type === 'audio');
          if (a && a.data) {
            audioBase64 = a.data;
            break;
          }
        }
      }
    }

    if (audioBase64) {
      fs.writeFileSync(outPath, Buffer.from(audioBase64, 'base64'));
      return outPath;
    }
    return null;
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
    if (this.orders.length > 0) {
      this.saveSession();
    }
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
        if (pid != null && pid !== undefined) {
          counts[pid] = (counts[pid] || 0) + 1;
          if (counts[pid] > maxCount) {
            maxCount = counts[pid];
            topProductId = pid;
          }
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
    const escapeCsv = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const rows = this.orders.map(o => [
      escapeCsv(o.timestamp),
      escapeCsv(o.user),
      escapeCsv(o.productId),
      escapeCsv(o.productTitle),
      escapeCsv(o.comment)
    ].join(','));
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
          fallback: false,
          playedLocally: !!evt.played_locally,
          volume: CONFIG.volume,
          rate: CONFIG.rate,
          voice: CONFIG.voice
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
          fallback: true,
          volume: CONFIG.volume,
          rate: CONFIG.rate,
          voice: CONFIG.voice
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
      rate: options.rate || CONFIG.rate,
      volume: options.volume !== undefined ? options.volume : CONFIG.volume
    });
    return speechId;
  }

  playAudioFile(filepath, text, options = {}) {
    const speechId = `spk_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.send({
      command: 'play_audio_file',
      filepath,
      text: text || '',
      id: speechId,
      volume: options.volume !== undefined ? options.volume : CONFIG.volume
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

const ORDER_KEYWORDS = [
  'กด', 'สั่ง', 'ซื้อ', 'เอา', 'จอง', 'โอน',
  'จ่ายเงิน', 'ชำระเงิน', 'พร้อมโอน',
  'ขอสั่ง', 'ขอรับ', 'ขอจอง',
  '1ชิ้น', '2ชิ้น', '3ชิ้น'
];
const NEGATION_PREFIXES = ['ไม่', 'ยัง', 'ยังไม่'];

function detectOrderIntent(comment) {
  const c = String(comment || '').toLowerCase().trim();
  if (!c) return false;

  // Exclude inquiry phrases (e.g. COD / payment inquiry)
  if (/(จ่ายปลายทาง|ปลายทาง)/.test(c)) return false;

  // Check for negation anywhere in comment before keyword or phrase
  if (/(ไม่|ยังไม่|ยกเลิก)\s*(สั่ง|กด|ซื้อ|โอน|เอา|จอง)/.test(c)) return false;
  if (c.includes('ไม่เอา') || c.includes('ไม่สั่ง') || c.includes('ไม่กด') || 
      c.includes('ไม่ซื้อ') || c.includes('ไม่โอน') || c.includes('ไม่จอง') ||
      c.includes('ยกเลิก')) {
    return false;
  }
  if (NEGATION_PREFIXES.some(n => c.startsWith(n))) return false;

  return ORDER_KEYWORDS.some(k => c.includes(k));
}

// ----------------------------------------------------
// 4. TikTok Community Safety & Compliance Gate (Adapted from SenRerunAI)
// ----------------------------------------------------
class TikTokSafetyFilter {
  static check(text) {
    if (!text || typeof text !== 'string') return { safe: true, text: '' };
    const lower = text.toLowerCase();
    const hits = [];

    // 1. Off-Platform Policy (ห้ามชักชวนไปช่องทางอื่นนอก TikTok: Line, เบอร์โทร, FB, IG, โอนตรง)
    const offplatformPatterns = [
      /line(?:\s*id)?/i,
      /@line/i,
      /แอดไลน์/i,
      /ไลน์ไอดี/i,
      /เบอร์โทร/i,
      /โทรมา/i,
      /facebook/i,
      /เฟสบุ๊ค/i,
      /instagram/i,
      /อินสตาแกรม/i,
      /0[689]\d{1}[- ]?\d{3}[- ]?\d{4}/,
      /โอนตรง/i,
      /บัญชีส่วนตัว/i,
      /นอกรอบ/i
    ];
    for (const pat of offplatformPatterns) {
      if (pat.test(lower)) {
        hits.push({ rule: 'offplatform', label: 'ช่องทางนอก TikTok / คำต้องห้าม' });
        break;
      }
    }

    // 2. Medical / Health Exaggerations (ห้ามอวดอ้างสรรพคุณทางยา เกินจริง ขาวไว หายขาด)
    const medicalPatterns = [
      /รักษาโรค/i,
      /หายขาด/i,
      /ขาวไวใน\s*\d+\s*วัน/i,
      /ลดน้ำหนัก\s*\d+\s*โล/i,
      /อย\.ปลอม/i,
      /ต้านมะเร็ง/i
    ];
    for (const pat of medicalPatterns) {
      if (pat.test(lower)) {
        hits.push({ rule: 'medical', label: 'อ้างสรรพคุณทางการแพทย์เกินจริง' });
        break;
      }
    }

    // 3. Expert / False Authority (ห้ามอ้างตัวเป็นแพทย์/ผู้เชี่ยวชาญ)
    const expertPatterns = [
      /หมอการันตี/i,
      /แพทย์รับรอง/i,
      /เภสัชกรแนะนำ/i
    ];
    for (const pat of expertPatterns) {
      if (pat.test(lower)) {
        hits.push({ rule: 'expert', label: 'อ้างตัวเป็นหมอ/ผู้เชี่ยวชาญ' });
        break;
      }
    }

    if (hits.length > 0) {
      return {
        safe: false,
        hits,
        sanitized: 'สั่งซื้อผ่านตะกร้าในไลฟ์ TikTok ได้อย่างปลอดภัย มีการรับประกันสินค้าพร้อมโปรส่งฟรีนะคะ'
      };
    }
    return { safe: true, hits: [], sanitized: text };
  }
}

// ----------------------------------------------------
// 5. AI Brain (Smart Director Logic)
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

  getPersonaContext() {
    const isMale = (CONFIG.voice || '').includes('Niwat');
    const persona = CONFIG.persona || 'sweet';
    return {
      isMale,
      persona,
      polite: isMale ? 'ครับ' : 'ค่ะ',
      politeLong: isMale ? 'ครับผม' : 'ค่า',
      call: isMale ? 'ครับ' : 'คะ',
      softEnd: isMale ? 'นะครับ' : 'นะคะ',
      cheerEnd: isMale ? 'ยินดีต้อนรับครับ' : 'ยินดีต้อนรับค่า',
      self: isMale ? 'พ่อค้า' : 'แม่ค้า',
      orderCall: isMale ? 'สั่งได้เลยครับ' : 'สั่งได้เลยค่า'
    };
  }

  enqueue(text, priority = 3, meta = {}) {
    // Priorities: 1 = urgent/gift, 2 = comment reply, 3 = pitch/welcome
    let finalText = text;
    if (!meta.raw) {
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

  async processQueue() {
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

    // Replicated Owner Voice synthesis via Gemini 3.8 Flash TTS
    if (CONFIG.voice_mode === 'replicated' && CONFIG.replicated_voice_id && typeof geminiAI !== 'undefined' && geminiAI?.apiKey) {
      try {
        const audioPath = await geminiAI.synthesizeReplicated(next.text, CONFIG.replicated_voice_id);
        if (audioPath && fs.existsSync(audioPath)) {
          this.mixer.playAudioFile(audioPath, next.text, { volume: CONFIG.volume });
          io.emit('ai_speaking', {
            text: next.text,
            meta: next.meta,
            voiceMode: 'replicated',
            timestamp: new Date().toLocaleTimeString()
          });
          return;
        }
      } catch (err) {
        console.warn('[AIBrain] Replicated voice synthesis fallback to neural:', err.message);
      }
    }

    this.mixer.speak(next.text, {
      voice: CONFIG.voice,
      rate: CONFIG.rate,
      volume: CONFIG.volume
    });

    io.emit('ai_speaking', {
      text: next.text,
      meta: next.meta,
      voiceMode: 'neural',
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
    const isMale = (CONFIG.voice || '').includes('Niwat');
    let t = String(text).trim();

    // Remove any markdown or emoji characters so TTS doesn't mispronounce them
    t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/[*#_~`]/g, '').trim();

    // Gender particle normalization
    if (isMale) {
      t = t.replace(/นะคะ/g, 'นะครับ')
           .replace(/(คะ|ค่ะ|ค่า)/g, 'ครับ')
           .replace(/แม่ค้า/g, 'พ่อค้า');
    } else {
      t = t.replace(/นะครับ/g, 'นะคะ')
           .replace(/ครับผม/g, 'ค่า')
           .replace(/ครับ/g, 'ค่ะ')
           .replace(/พ่อค้า/g, 'แม่ค้า');
    }

    if (persona === 'sweet') {
      if (isMale) {
        if (!t.endsWith('นะครับ') && !t.endsWith('ครับ')) {
          t += ' นะครับ ยินดีต้อนรับครับ';
        }
      } else {
        if (!t.endsWith('นะคะ') && !t.endsWith('ค่ะ') && !t.endsWith('ค่า') && !t.endsWith('จ้ะ')) {
          t += ' นะคะ ยินดีต้อนรับค่า';
        }
      }
    } else if (persona === 'hype') {
      const hypeTail = isMale 
        ? ' ด่วนๆ เลยครับ กดสั่งตอนนี้รับส่วนลดทันที ช้าหมดอดนะจ๊ะ!' 
        : ' ด่วนๆ เลยค่า กดสั่งตอนนี้รับส่วนลดทันที ช้าหมดอดนะจ๊ะ!';
      if (!t.includes('ด่วน') && !t.includes('รีบ') && !t.includes('ไฟลุก')) {
        t += hypeTail;
      }
    } else if (persona === 'pro') {
      const proTail = isMale
        ? ' ทางร้านรับประกันคุณภาพ มั่นใจได้ร้อยเปอร์เซ็นต์ครับ'
        : ' ทางร้านรับประกันคุณภาพ มั่นใจได้ร้อยเปอร์เซ็นต์ค่ะ';
      if (!t.includes('รับประกันคุณภาพ')) {
        t += proTail;
      }
    }
    return t;
  }

  async processComment(user, comment) {
    // Order intent detection (DO NOT REMOVE)
    if (detectOrderIntent(comment)) {
      const pinned = this.products.getPinned();
      sessionTracker.recordOrder(user, pinned?.id ?? null, pinned?.title ?? '', comment);
      io.emit('session_order', sessionTracker.getStats());
    }

    // 0. TikTok Community Policy & Safety Gate (Adapted from SenRerunAI)
    const safety = TikTokSafetyFilter.check(comment);
    if (!safety.safe) {
      const ctx = this.getPersonaContext();
      const resp = `คุณ ${user} ${ctx.call} เพื่อความปลอดภัยของลูกค้า สั่งซื้อผ่านระบบตะกร้าในไลฟ์ TikTok ได้โดยตรง มีการรับประกันและโปรส่งฟรี${ctx.softEnd}`;
      this.enqueue(resp, 1, { type: 'safety_gate', user, comment, rules: safety.hits });
      return resp;
    }

    // 1. Check FAQ Rules
    const faq = this.faqs.match(comment);
    if (faq) {
      const ctx = this.getPersonaContext();
      const resp = `คุณ ${user} ${ctx.call} ${faq.answer}`;
      this.enqueue(resp, 2, { type: 'faq', user, comment });
      return resp;
    }

    // 2. Check Product match
    const prod = this.products.findMatchingProduct(comment);
    if (prod) {
      this.products.pin(prod.id);
      io.emit('pinned_updated', prod);
      if (CONFIG.autoSfxOnPin) this.mixer.playSfx('ding', 0.8);
      const ctx = this.getPersonaContext();
      let resp = '';
      if (ctx.persona === 'hype') {
        resp = `คุณ ${user} ตะกร้าที่ ${prod.id} ${prod.title} ตัวนี้จัดโปรเด็ดมาก ราคาเพียง ${prod.price} บาท รีบกดสั่งตอนนี้เลย${ctx.softEnd} ช้าหมดอดโปรนี้แน่นอน${ctx.polite}!`;
      } else if (ctx.persona === 'pro') {
        resp = `สำหรับคุณ ${user} สินค้าในตะกร้าที่ ${prod.id} ${prod.title} ราคาพิเศษ ${prod.price} บาท สินค้าคุณภาพมาตรฐานรับประกันของแท้ สั่งซื้อได้ทันที${ctx.polite}`;
      } else {
        resp = `สำหรับคุณ ${user} สนใจ ${prod.title} ในตะกร้าที่ ${prod.id} ${ctx.softEnd} วันนี้ราคาพิเศษเพียง ${prod.price} บาทเท่านั้น รีบกดตะกร้าซ้ายล่างได้เลย${ctx.politeLong}`;
      }
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
          const cleanSpeech = aiReply.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/[*#_~`]/g, '').trim();
          this.enqueue(cleanSpeech, 2, { type: 'gemini_faq', user, comment });
          return cleanSpeech;
        }
      } catch (err) {
        console.warn('[AIBrain] Gemini call error, falling back to general reply:', err.message);
      }
    }

    // 4. General engaging reply
    const ctx = this.getPersonaContext();
    let generalReplies = [];
    if (ctx.persona === 'hype') {
      generalReplies = [
        `ยินดีต้อนรับคุณ ${user} เข้ามาถูกจังหวะมาก วันนี้มีโปรลดกระหน่ำในไลฟ์ รีบกดดูตะกร้าด่วนๆ เลย${ctx.softEnd}!`,
        `สวัสดีคุณ ${user} ดีลเด็ดวันนี้ลดแรงสุดๆ รีบคว้าไว้ก่อนหมดโปรเลย${ctx.softEnd}!`,
        `คุณ ${user} สินค้าในไลฟ์วันนี้ใกล้จะหมดแล้วนะ${ctx.call} ใครเล็งชิ้นไหนอยู่รีบกดด่วนๆ เลย${ctx.polite}!`
      ];
    } else if (ctx.persona === 'pro') {
      generalReplies = [
        `สวัสดี${ctx.polite} คุณ ${user} ทางร้านยินดีให้บริการและพร้อมให้คำแนะนำในทุกรายการสินค้า${ctx.polite}`,
        `ขอขอบคุณความคิดเห็นจากคุณ ${user} เป็นอย่างยิ่ง${ctx.polite} สินค้าทุกชิ้นมีการรับประกันคุณภาพและพร้อมจัดส่ง${ctx.polite}`,
        `ยินดีต้อนรับคุณ ${user} เข้าสู่การถ่ายทอดสด${ctx.polite} หากต้องการข้อมูลสินค้าส่วนใด สอบถามได้ตลอดเวลา${ctx.polite}`
      ];
    } else {
      generalReplies = [
        `สวัสดีคุณ ${user} ${ctx.softEnd} ขอบคุณที่แวะเข้ามาทักทายกันในไลฟ์${ctx.politeLong} สนใจชิ้นไหนจิ้มตะกร้าได้เลยน้า`,
        `ขอบคุณคอมเมนต์จากคุณ ${user} มากๆ เลย${ctx.softEnd} สินค้าพร้อมส่งทุกตะกร้าเลย${ctx.politeLong} สอบถามเพิ่มเติมได้เลย${ctx.softEnd}`,
        `คุณ ${user} แวะมาดูสินค้าคุณภาพ ราคาพิเศษวันนี้ได้เลย${ctx.politeLong} สั่งในไลฟ์ส่งฟรีทุกออเดอร์${ctx.softEnd}`
      ];
    }
    const pick = generalReplies[Math.floor(Math.random() * generalReplies.length)];
    this.enqueue(pick, 3, { type: 'chat', user, comment });
    return pick;
  }

  processGift(user, giftName, repeatCount = 1) {
    if (CONFIG.autoSfxOnGift) {
      this.mixer.playSfx('cheer', 0.9);
    }
    const ctx = this.getPersonaContext();
    let thankMsg = '';
    const countText = repeatCount > 1 ? `จำนวน ${repeatCount} ชิ้น ` : '';
    if (ctx.persona === 'hype') {
      thankMsg = `โอ้โห ปังมาก! ขอบคุณคุณ ${user} สำหรับ ${giftName} ${countText}มากๆ เลย${ctx.softEnd}! ขอให้ยอดเฮงยอดปัง รวยๆ ปังๆ ไปเลย${ctx.softEnd}!`;
    } else if (ctx.persona === 'pro') {
      thankMsg = `ทางร้านขอขอบพระคุณคุณ ${user} เป็นอย่างยิ่ง สำหรับ ${giftName} ${countText}ขอขอบพระคุณสำหรับกำลังใจและความอนุเคราะห์${ctx.polite}`;
    } else {
      thankMsg = `ขอบคุณคุณ ${user} มากๆ เลย${ctx.softEnd} สำหรับ ${giftName} ${countText}ขอให้เฮงๆ รวยๆ สุขภาพแข็งแรง${ctx.softEnd} ขอบคุณ${ctx.politeLong}!`;
    }
    this.enqueue(thankMsg, 1, { type: 'gift', user, giftName, repeatCount });
  }

  processJoin(user) {
    if (!CONFIG.respondToJoins) return;
    const ctx = this.getPersonaContext();
    let welcomes = [];
    if (ctx.persona === 'hype') {
      welcomes = [
        `สวัสดีคุณ ${user} เข้ามาได้จังหวะดีลเด็ดพอดี รีบส่องตะกร้าซ้ายล่างด่วนๆ เลย${ctx.softEnd}!`,
        `ยินดีต้อนรับคุณ ${user} ไลฟ์นี้ลดโหดมาก ชิ้นไหนถูกใจรีบจิ้มตะกร้าด่วนๆ เลย${ctx.polite}!`
      ];
    } else if (ctx.persona === 'pro') {
      welcomes = [
        `สวัสดี${ctx.polite}คุณ ${user} ยินดีต้อนรับเข้าสู่การถ่ายทอดสดครับ สอบถามรายละเอียดสินค้าได้ทันที${ctx.polite}`,
        `ยินดีต้อนรับคุณ ${user} เข้าสู่ร้านค้าอย่างเป็นทางการ วันนี้มีข้อเสนอพิเศษพร้อมการรับประกันคุณภาพ${ctx.polite}`
      ];
    } else {
      welcomes = [
        `สวัสดี${ctx.politeLong}คุณ ${user} ยินดีต้อนรับเข้าสู่ไลฟ์สด${ctx.softEnd} เข้ามาแล้วอย่าลืมกดติดตามและกดดูตะกร้าได้เลย${ctx.politeLong}`,
        `ยินดีต้อนรับคุณ ${user} ${ctx.softEnd} วันนี้มีโปรพิเศษส่งฟรีในไลฟ์ จิ้มดูตะกร้าซ้ายล่างได้เลยน้า`
      ];
    }
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

    const ctx = this.getPersonaContext();
    let pitch = prod.pitchScript;
    if (!pitch) {
      if (ctx.persona === 'hype') {
        pitch = `ด่วนที่สุดตอนนี้! ปักหมุดตะกร้าที่ ${prod.id} ${prod.title} ราคาพิเศษหลุดโลกเพียง ${prod.price} บาท! รีบจิ้มตะกร้าซ้ายล่างด่วนๆ ช้าหมดแน่นอน${ctx.polite}!`;
      } else if (ctx.persona === 'pro') {
        pitch = `ขอแนะนำสินค้าในตะกร้าที่ ${prod.id} ${prod.title} ราคาพิเศษ ${prod.price} บาท สินค้าคุณภาพมาตรฐาน รับประกันของแท้ สั่งซื้อได้ทันที${ctx.polite}`;
      } else {
        pitch = `ตอนนี้กำลังปักหมุดตะกร้าที่ ${prod.id} ${prod.title} ราคาพิเศษ ${prod.price} บาท${ctx.softEnd} สินค้ามีจำนวนจำกัด กดสั่งได้เลย${ctx.politeLong}`;
      }
    }
    this.enqueue(pitch, 3, { type: 'pitch', product: prod });
  }

  generateUrgencySpeech(prod) {
    const ctx = this.getPersonaContext();
    if (ctx.persona === 'hype') {
      return `ทุกคนด่วนๆ เลย${ctx.call}! ตะกร้าที่ ${prod.id} ${prod.title} สต็อกแตกแล้ว เหลือแค่ ${prod.stock} ชิ้นสุดท้าย! ใครไม่ทันรอบนี้คือพลาดมาก รีบกดจ่ายเงินด่วนที่สุด${ctx.polite}!`;
    } else if (ctx.persona === 'pro') {
      return `ขอแจ้งเตือนสต็อกสินค้าตะกร้าที่ ${prod.id} ${prod.title} ขณะนี้เหลือเพียง ${prod.stock} ชิ้นสุดท้ายในระบบ ขอแนะนำให้ท่านทำรายการสั่งซื้อและชำระเงินเพื่อสงวนสิทธิ์${ctx.polite}`;
    }
    return `ทุกคน${ctx.call} ตะกร้าที่ ${prod.id} ${prod.title} ตอนนี้เหลือสต็อกเพียง ${prod.stock} ชิ้นสุดท้ายแล้ว${ctx.softEnd} ใครที่เล็งไว้อยู่ รีบกดสั่งและชำระเงินได้เลย${ctx.politeLong}`;
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
    faqs: faqManager.getAll(),
    flashSale: flashSaleManager.getState(),
    session: sessionTracker.getStats(),
    tiktok: {
      connected: !!(tiktokConnection && tiktokConnection.isConnected),
      username: currentTikTokUsername
    }
  });

  // Director Monitor Real-time Ping Latency
  socket.on('ping_check', (clientTime) => {
    socket.emit('pong_check', {
      clientTime,
      serverTime: Date.now()
    });
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

  tiktokConnection.on('like', data => {
    io.emit('stats_update', { likeCount: data.totalLikeCount || data.likeCount });
  });

  tiktokConnection.on('disconnected', () => {
    console.log('[TikTok] Disconnected from live stream.');
    sessionTracker.saveSession();
    currentTikTokUsername = '';
    io.emit('tiktok_status', { connected: false, username: '' });
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
  saveConfig(CONFIG);
  io.emit('config_updated', CONFIG);
  res.json({ success: true, config: CONFIG });
});

// Voice & Persona Live Audio Preview
app.post('/api/voice/preview', (req, res) => {
  const isMale = (CONFIG.voice || '').includes('Niwat');
  const persona = CONFIG.persona || 'sweet';
  let sample = '';
  if (persona === 'sweet') {
    sample = isMale
      ? 'สวัสดีครับ ยินดีต้อนรับเข้าสู่ไลฟ์สดนะครับ สินค้าพร้อมส่งทุกตะกร้า แวะชมก่อนได้เลยครับ'
      : 'สวัสดีค่า ยินดีต้อนรับเข้าสู่ไลฟ์สดนะคะ สินค้าพร้อมส่งทุกตะกร้า แวะชมก่อนได้เลยค่า';
  } else if (persona === 'hype') {
    sample = isMale
      ? 'ด่วนที่สุดในไลฟ์นี้ครับทุกคน! โปรแรงแซงทุกดีล กดตะกร้าด่วนๆ เลยนะครับ ช้าหมดอดแน่นอนครับ!'
      : 'ด่วนที่สุดในไลฟ์นี้ค่าทุกคน! โปรแรงแซงทุกดีล กดตะกร้าด่วนๆ เลยนะคะ ช้าหมดอดแน่นอนค่า!';
  } else {
    // pro
    sample = isMale
      ? 'สวัสดีครับ ยินดีต้อนรับทุกท่าน สินค้าของทางร้านรับประกันคุณภาพแท้ร้อยเปอร์เซ็นต์ สั่งซื้อได้ทันทีครับ'
      : 'สวัสดีค่ะ ยินดีต้อนรับทุกท่าน สินค้าของทางร้านรับประกันคุณภาพแท้ร้อยเปอร์เซ็นต์ สั่งซื้อได้ทันทีค่ะ';
  }
  aiBrain.enqueue(sample, 1, { type: 'preview', raw: true });
  res.json({ success: true, previewText: sample, config: CONFIG });
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
    try { tiktokConnection.disconnect(); } catch (e) {}
    tiktokConnection = null;
  }
  currentTikTokUsername = '';
  io.emit('tiktok_status', { connected: false, username: '' });
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

// Stream Health & Director Monitor API
app.get('/api/stream/health', (req, res) => {
  const hasVideoIdle = fs.existsSync(path.join(__dirname, 'public', 'assets', 'avatar_idle.mp4'));
  const hasVideoTalk = fs.existsSync(path.join(__dirname, 'public', 'assets', 'avatar_talking.mp4'));
  res.json({
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
    activeSockets: io.engine.clientsCount,
    tiktokConnected: !!(tiktokConnection && tiktokConnection.isConnected),
    avatarMode: (hasVideoIdle && hasVideoTalk) ? 'video_hd' : 'canvas_2d',
    memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    timestamp: Date.now()
  });
});

// ----------------------------------------------------
// Avatar & Voice Cloning Studio APIs (Owner AI Digital Human)
// ----------------------------------------------------
app.get('/api/avatar/status', (req, res) => {
  const assetsDir = path.join(__dirname, 'public', 'assets');
  const hasIdleVideo = fs.existsSync(path.join(assetsDir, 'avatar_idle.mp4'));
  const hasTalkingVideo = fs.existsSync(path.join(assetsDir, 'avatar_talking.mp4'));
  const hasIdleImg = fs.existsSync(path.join(assetsDir, 'avatar_idle.jpg'));
  const hasSpeakingImg = fs.existsSync(path.join(assetsDir, 'avatar_speaking.jpg'));
  const hasBlinkImg = fs.existsSync(path.join(assetsDir, 'avatar_blink.jpg'));

  res.json({
    status: 'online',
    avatarMode: (hasIdleVideo && hasTalkingVideo) ? 'video_hd' : 'canvas_2d',
    fps: 30,
    hasIdleVideo,
    hasTalkingVideo,
    hasIdleImg,
    hasSpeakingImg,
    hasBlinkImg,
    voiceMode: CONFIG.voice_mode || 'neural',
    replicatedVoiceId: CONFIG.replicated_voice_id || null,
    currentVoice: CONFIG.voice,
    hasGeminiApiKey: !!(process.env.GEMINI_API_KEY)
  });
});

app.post('/api/avatar/upload-face', async (req, res) => {
  try {
    const { image, autoBuild } = req.body;
    if (!image) return res.status(400).json({ error: 'Image base64 data required' });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const assetsDir = path.join(__dirname, 'public', 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
    
    const idlePath = path.join(assetsDir, 'avatar_idle.jpg');
    fs.writeFileSync(idlePath, buffer);

    if (autoBuild !== false) {
      const scriptPath = path.join(__dirname, 'generate_avatar_videos.py');
      const pythonBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
      const py = spawn(pythonBin, [scriptPath, '--auto-morph', '--fps', '30'], {
        cwd: __dirname,
        env: process.env
      });
      py.on('error', (err) => console.error('[AvatarEngine] Auto-build spawn error:', err.message));
      py.on('close', (code) => {
        if (code === 0) {
          io.emit('avatar_updated', { timestamp: Date.now(), fps: 30, autoBuilt: true });
        }
      });
    }

    res.json({ success: true, message: 'Owner portrait uploaded successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/avatar/upload-video', async (req, res) => {
  try {
    const { video, type } = req.body;
    if (!video || !type) {
      return res.status(400).json({ error: 'Video base64 data and type (idle/talking) required' });
    }
    if (type !== 'idle' && type !== 'talking') {
      return res.status(400).json({ error: 'Type must be either "idle" or "talking"' });
    }

    const filename = type === 'talking' ? 'avatar_talking.mp4' : 'avatar_idle.mp4';
    const assetsDir = path.join(__dirname, 'public', 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const base64Data = video.replace(/^data:video\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const targetPath = path.join(assetsDir, filename);

    fs.writeFileSync(targetPath, buffer);
    console.log(`[AvatarEngine] Direct MP4 uploaded: ${filename} (${buffer.length} bytes)`);

    io.emit('avatar_updated', { timestamp: Date.now(), type, filename, directUpload: true });

    res.json({ success: true, message: `Updated ${filename} successfully`, type, filename, size: buffer.length });
  } catch (err) {
    console.error('[AvatarEngine] Video upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/avatar/generate-loop', (req, res) => {
  const fps = parseInt(req.body?.fps) || 30;
  const autoMorph = req.body?.autoMorph !== false;
  const scriptPath = path.join(__dirname, 'generate_avatar_videos.py');
  const args = [scriptPath, '--fps', String(fps)];
  if (autoMorph) args.push('--auto-morph');

  const pythonBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  const py = spawn(pythonBin, args, { cwd: __dirname, env: process.env });
  let output = '';
  let errOutput = '';
  py.stdout.on('data', d => output += d.toString());
  py.stderr.on('data', d => errOutput += d.toString());

  py.on('error', (err) => {
    console.error('[AvatarEngine] Spawn error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Video generation failed', details: `Process spawn error: ${err.message}` });
    }
  });

  py.on('close', (code) => {
    if (res.headersSent) return;
    if (code === 0) {
      io.emit('avatar_updated', { timestamp: Date.now(), fps });
      res.json({ success: true, fps, output });
    } else {
      console.error('[AvatarEngine] Python process failed with code', code, errOutput);
      res.status(500).json({ error: 'Video generation failed', details: errOutput || `Process exited with code ${code}` });
    }
  });
});

app.post('/api/avatar/clone-voice', async (req, res) => {
  try {
    const { audioData, consentData, displayName } = req.body;
    if (!audioData) return res.status(400).json({ error: 'Audio sample required' });
    if (!geminiAI || !geminiAI.apiKey) {
      return res.status(400).json({ error: 'GEMINI_API_KEY is required for voice cloning' });
    }

    const cleanAudio = audioData.replace(/^data:audio\/\w+;base64,/, '');
    const cleanConsent = consentData ? consentData.replace(/^data:audio\/\w+;base64,/, '') : cleanAudio;

    const voiceId = await geminiAI.replicateVoice(cleanAudio, cleanConsent, displayName || 'Shop Owner');
    CONFIG.replicated_voice_id = voiceId;
    CONFIG.voice_mode = 'replicated';
    saveConfig(CONFIG);
    io.emit('config_updated', CONFIG);

    res.json({ success: true, voiceId, voiceMode: 'replicated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/avatar/set-voice-mode', (req, res) => {
  const { mode, voice } = req.body;
  if (mode) CONFIG.voice_mode = mode;
  if (voice) CONFIG.voice = voice;
  saveConfig(CONFIG);
  io.emit('config_updated', CONFIG);
  res.json({ success: true, config: CONFIG });
});

app.post('/api/avatar/test-speak', (req, res) => {
  const text = req.body?.text || 'สวัสดีค่า ยินดีต้อนรับเข้าสู่ไลฟ์ของทางร้านนะคะ สนใจสินค้าชิ้นไหนสอบถามได้เลยค่า';
  aiBrain.enqueue(text, 1, { type: 'owner_test' });
  res.json({ success: true, text });
});

// Stream Overlay page route
app.get('/stream-overlay', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'stream-overlay.html'));
});

// Graceful shutdown on SIGINT
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down gracefully...');
  if (sessionTracker && sessionTracker.orders.length > 0) {
    sessionTracker.saveSession();
  }
  process.exit(0);
});

// Start Server
server.listen(CONFIG.port, '0.0.0.0', () => {
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
  geminiAI,
  TikTokSafetyFilter
};

