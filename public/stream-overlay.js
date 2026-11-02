// TikTok Live Stream Overlay Controller (v3.0.0)
const socket = io();

// Parse URL Parameters
const urlParams = new URLSearchParams(window.location.search);
const showSubtitlesParam = urlParams.get('subtitles') !== 'off';

// DOM Elements
const avatarCanvas = document.getElementById('avatar-canvas');
const ctx = avatarCanvas.getContext('2d', { willReadFrequently: true });

const imgIdle = document.getElementById('img-avatar-idle');
const imgSpeaking = document.getElementById('img-avatar-speaking');
const imgBlink = document.getElementById('img-avatar-blink');

const overlayViewers = document.getElementById('overlay-viewers');
const overlayShopName = document.getElementById('overlay-shop-name');

const badgeBasketNum = document.getElementById('badge-basket-num');
const badgeTitle = document.getElementById('badge-title');
const badgePrice = document.getElementById('badge-price');
const badgeOrigPrice = document.getElementById('badge-orig-price');
const badgePromo = document.getElementById('badge-promo-text');
const badgeStock = document.getElementById('badge-stock-text');

const subtitlesContainer = document.getElementById('subtitles-container');
const subtitlesText = document.getElementById('subtitles-text');

const giftBanner = document.getElementById('gift-banner');
const giftSender = document.getElementById('gift-sender');
const giftDetail = document.getElementById('gift-detail');

const confettiCanvas = document.getElementById('confetti-canvas');
const confettiCtx = confettiCanvas.getContext('2d');

// State & Animation Timing
let avatarState = 'idle'; // 'idle' or 'speaking'
let isSpeaking = false;
let currentPinnedId = 1;
let speechBlend = 0.0;
let speechStartTime = 0;

// Organic Eye Blinking Engine
let nextBlinkTime = Date.now() + 2000 + Math.random() * 2500;
let isBlinking = false;
let blinkStartTime = 0;
const BLINK_DURATION = 140; // 140ms natural eyelid closure

// ==========================================
// 1. Dual-Mode High Performance Render Engine (60 FPS)
// ==========================================
function renderFrame() {
  const dw = 1080;
  const dh = 1920;
  const now = Date.now();

  // 1. Organic Eye Blinking Engine (every 3.2 - 5.8s for ~140ms)
  if (!isBlinking && now >= nextBlinkTime) {
    isBlinking = true;
    blinkStartTime = now;
  }
  let blinkProgress = 0.0;
  if (isBlinking) {
    const elapsedBlink = now - blinkStartTime;
    if (elapsedBlink < BLINK_DURATION) {
      blinkProgress = Math.sin((elapsedBlink / BLINK_DURATION) * Math.PI);
    } else {
      isBlinking = false;
      nextBlinkTime = now + 3200 + Math.random() * 2600;
    }
  }

  // 2. Dynamic Speech Cadence & Syllable Modulation
  let targetBlend = 0.0;
  if (avatarState === 'speaking') {
    const speechElapsed = (now - speechStartTime) * 0.001;
    // Multi-frequency syllable rhythm (3.8Hz primary Thai syllable speed + 1.9Hz phrase dynamics)
    const syllableWave = Math.sin(speechElapsed * Math.PI * 2 * 3.8) * 0.32 +
                         Math.sin(speechElapsed * Math.PI * 2 * 1.9) * 0.16;
    targetBlend = Math.max(0.35, Math.min(1.0, 0.72 + syllableWave));
  }
  speechBlend += (targetBlend - speechBlend) * 0.22;

  // Direct High-Resolution 60FPS Studio Render with Multi-Layer Organic Animation
  const idleReady = imgIdle && (imgIdle.complete && imgIdle.naturalWidth > 0);
  const spkReady = imgSpeaking && (imgSpeaking.complete && imgSpeaking.naturalWidth > 0);
  const blinkReady = imgBlink && (imgBlink.complete && imgBlink.naturalWidth > 0);

  if (idleReady && !useVideoMode) {
    ctx.clearRect(0, 0, dw, dh);

    // Layer 1: Base Idle Frame (Wai Greeting / Smiling)
    ctx.globalAlpha = 1.0;
    ctx.drawImage(imgIdle, 0, 0, dw, dh);

    // Layer 2: Speaking Frame with dynamic syllable openness
    if (spkReady && speechBlend > 0.01) {
      ctx.globalAlpha = Math.min(1.0, Math.max(0.0, speechBlend));
      ctx.drawImage(imgSpeaking, 0, 0, dw, dh);
    }

    // Layer 3: Organic Eye Blink Frame (smooth blend over face)
    if (blinkReady && blinkProgress > 0.01) {
      ctx.globalAlpha = Math.min(1.0, Math.max(0.0, blinkProgress));
      ctx.drawImage(imgBlink, 0, 0, dw, dh);
    }

    ctx.globalAlpha = 1.0;
  }

  requestAnimationFrame(renderFrame);
}

// Start render loop once images load
imgIdle.onload = () => requestAnimationFrame(renderFrame);
imgSpeaking.onload = () => requestAnimationFrame(renderFrame);
imgBlink.onload = () => requestAnimationFrame(renderFrame);
if (imgIdle.complete) requestAnimationFrame(renderFrame);

// ==========================================
// 2. Confetti Particle System
// ==========================================
let confettiParticles = [];

class ConfettiParticle {
  constructor() {
    this.x = Math.random() * 1080;
    this.y = -20;
    this.size = Math.random() * 16 + 10;
    this.speedY = Math.random() * 8 + 6;
    this.speedX = Math.random() * 6 - 3;
    this.rotation = Math.random() * 360;
    this.rotSpeed = Math.random() * 10 - 5;
    const colors = ['#fe2c55', '#25f4ee', '#f59e0b', '#22c55e', '#a855f7', '#ec4899'];
    this.color = colors[Math.floor(Math.random() * colors.length)];
    this.life = 1.0;
  }

  update() {
    this.y += this.speedY;
    this.x += this.speedX;
    this.rotation += this.rotSpeed;
    this.life -= 0.008;
  }

  draw(c) {
    c.save();
    c.translate(this.x, this.y);
    c.rotate((this.rotation * Math.PI) / 180);
    c.fillStyle = this.color;
    c.globalAlpha = Math.max(0, this.life);
    c.fillRect(-this.size / 2, -this.size / 2, this.size, this.size * 0.6);
    c.restore();
  }
}

function triggerConfettiBurst(count = 60) {
  for (let i = 0; i < count; i++) {
    confettiParticles.push(new ConfettiParticle());
  }
}

function updateConfetti() {
  confettiCtx.clearRect(0, 0, 1080, 1920);
  confettiParticles = confettiParticles.filter(p => p.life > 0 && p.y < 1950);
  confettiParticles.forEach(p => {
    p.update();
    p.draw(confettiCtx);
  });
  requestAnimationFrame(updateConfetti);
}
requestAnimationFrame(updateConfetti);

// ==========================================
// 3. Socket.IO Real-time Events
// ==========================================
socket.on('init_state', data => {
  if (data.pinnedProduct) {
    updatePinnedCard(data.pinnedProduct);
  }
  if (data.flashSale) {
    updateFlashSaleBanner(data.flashSale);
  }
  if (data.config) {
    updateOverlayConfig(data.config);
  }
});

function updateOverlayConfig(cfg) {
  if (!cfg) return;
  const isMale = (cfg.voice || '').includes('Niwat');
  const speakerName = document.querySelector('.speaker-name');
  if (speakerName) {
    speakerName.textContent = isMale ? 'พ่อค้า AI:' : 'แม่ค้า AI:';
  }
}

socket.on('config_updated', cfg => {
  updateOverlayConfig(cfg);
});

socket.on('pinned_updated', product => {
  if (product) updatePinnedCard(product);
});

socket.on('products_updated', products => {
  if (currentPinnedId && products) {
    const current = products.find(p => p.id === currentPinnedId);
    if (current) {
      badgeStock.textContent = `เหลือ ${current.stock} ชิ้น`;
    }
  }
});

socket.on('stats_update', stats => {
  if (stats.viewerCount !== undefined) {
    overlayViewers.textContent = Number(stats.viewerCount || 0).toLocaleString();
  }
});

socket.on('tiktok_status', data => {
  if (data.username) {
    overlayShopName.textContent = `@${data.username.toUpperCase()}`;
  }
});

// Audio Player Engine for OBS Browser Source / Web Browser
let overlayAudio = null;

function speakOverlayAudio(data) {
  if (!data || !data.text) return;
  // If muted in iframe preview, do not produce sound
  if (urlParams.get('muted') === '1') return;
  // If Python audio mixer already played the sound locally on the same host machine (localhost only),
  // do not duplicate playback unless specifically requested via ?audio=1.
  // When running on cloud (Render / remote host), always play audio in browser source.
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocalhost && data.playedLocally && urlParams.get('audio') !== '1') return;

  // 1. If audio file URL is available, play high-quality neural voice
  if (data.audioUrl && !data.fallback) {
    try {
      if (overlayAudio) {
        overlayAudio.pause();
        overlayAudio = null;
      }
      overlayAudio = new Audio(data.audioUrl);
      overlayAudio.volume = data.volume !== undefined ? Math.min(1.0, Math.max(0.0, data.volume)) : 1.0;
      overlayAudio.play().catch(err => {
        console.warn('Overlay audio playback blocked or failed, fallback to Web Speech:', err);
        speakWebSpeech(data.text);
      });
      return;
    } catch (e) {
      console.warn('Audio URL playback error:', e);
    }
  }

  // 2. Fallback: Browser Native Web Speech API
  speakWebSpeech(data.text);
}

function speakWebSpeech(text) {
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
    utter.rate = 1.05;
    window.speechSynthesis.speak(utter);
  } catch (e) {
    console.error('Web Speech error:', e);
  }
}

// Unlock audio on click or touch (for standard browser view)
document.addEventListener('click', () => {
  if (window.speechSynthesis && window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }
}, { once: false });

// Video Avatar Elements (High-Fidelity Seamless Video Loops)
const videoIdle = document.getElementById('video-avatar-idle');
const videoTalk = document.getElementById('video-avatar-talk');
let useVideoMode = false;

function activateVideoMode() {
  useVideoMode = true;
  avatarCanvas.style.display = 'none';
  if (videoIdle) {
    videoIdle.muted = true;
    videoIdle.style.opacity = '1';
    videoIdle.play().catch(err => {
      console.warn('[AvatarEngine] videoIdle play failed, falling back to Canvas:', err);
      useVideoMode = false;
      avatarCanvas.style.display = 'block';
    });
  }
  if (videoTalk) {
    videoTalk.muted = true;
    videoTalk.style.opacity = '0';
    videoTalk.play().catch(() => {});
  }
  console.log('[AvatarEngine] High-Fidelity 30 FPS Video Mode Active (Seamless Loops)!');
}

function checkVideoAvatarSupport() {
  if (videoIdle && videoTalk) {
    videoIdle.muted = true;
    videoTalk.muted = true;
    
    if (videoIdle.readyState >= 2) {
      activateVideoMode();
    } else {
      videoIdle.addEventListener('loadeddata', activateVideoMode, { once: true });
      videoIdle.addEventListener('canplay', activateVideoMode, { once: true });
    }
    
    // Auto-resume playback on user interaction
    const unlockPlay = () => {
      if (videoIdle && videoIdle.paused) {
        videoIdle.play().then(() => activateVideoMode()).catch(() => {});
      }
      if (videoTalk && videoTalk.paused) {
        videoTalk.play().catch(() => {});
      }
    };
    document.addEventListener('click', unlockPlay);
    document.addEventListener('touchstart', unlockPlay);

    videoIdle.addEventListener('error', () => {
      console.warn('[AvatarEngine] Video idle failed to load, falling back to Canvas 2D Morphing.');
      useVideoMode = false;
      avatarCanvas.style.display = 'block';
    });
  }
}
checkVideoAvatarSupport();

function updateVideoAvatarState(state) {
  if (!useVideoMode) return;
  if (state === 'speaking') {
    if (videoTalk) {
      if (videoTalk.paused) videoTalk.play().catch(() => {});
      videoTalk.style.opacity = '1';
    }
    if (videoIdle) {
      videoIdle.style.opacity = '0';
    }
  } else {
    if (videoIdle) {
      if (videoIdle.paused) videoIdle.play().catch(() => {});
      videoIdle.style.opacity = '1';
    }
    if (videoTalk) {
      videoTalk.style.opacity = '0';
    }
  }
}

socket.on('avatar_updated', data => {
  console.log('[AvatarEngine] Avatar video loops updated, hot-reloading 30 FPS streams...', data);
  const t = Date.now();
  if (videoIdle) {
    videoIdle.src = `/assets/avatar_idle.mp4?t=${t}`;
    videoIdle.load();
    videoIdle.play().catch(() => {});
  }
  if (videoTalk) {
    videoTalk.src = `/assets/avatar_talking.mp4?t=${t}`;
    videoTalk.load();
    videoTalk.play().catch(() => {});
  }
  if (imgIdle) imgIdle.src = `/assets/avatar_idle.jpg?t=${t}`;
  if (imgSpeaking) imgSpeaking.src = `/assets/avatar_speaking.jpg?t=${t}`;
  if (imgBlink) imgBlink.src = `/assets/avatar_blink.jpg?t=${t}`;
});

socket.on('tts_event', event => {
  if (event.event === 'playing') {
    isSpeaking = true;
    avatarState = 'speaking';
    speechStartTime = Date.now();
    updateVideoAvatarState('speaking');

    if (showSubtitlesParam && event.data && event.data.text) {
      subtitlesText.textContent = event.data.text;
      subtitlesContainer.classList.add('active');
    }

    if (event.data) {
      speakOverlayAudio(event.data);
    }
  } else if (event.event === 'finished' || event.event === 'stopped') {
    isSpeaking = false;
    avatarState = 'idle';
    updateVideoAvatarState('idle');
    if (overlayAudio) {
      overlayAudio.pause();
      overlayAudio = null;
    }
    setTimeout(() => {
      if (!isSpeaking) {
        subtitlesContainer.classList.remove('active');
      }
    }, 1500);
  }
});

socket.on('gift_event', gift => {
  giftSender.textContent = gift.user;
  giftDetail.textContent = `ส่ง ${gift.giftName} ${gift.repeatCount > 1 ? `x${gift.repeatCount}` : ''} 🎉`;
  giftBanner.classList.add('show');
  triggerConfettiBurst(50);

  setTimeout(() => {
    giftBanner.classList.remove('show');
  }, 4500);
});

function updatePinnedCard(p) {
  currentPinnedId = p.id;
  badgeBasketNum.textContent = `ตะกร้าที่ ${p.id}`;
  badgeTitle.textContent = p.title;
  badgePrice.textContent = p.price;
  badgeOrigPrice.textContent = p.originalPrice ? `฿${p.originalPrice}` : '';
  badgePromo.textContent = p.promotion || 'โปรโมชั่นพิเศษ';
  badgeStock.textContent = `เหลือ ${p.stock !== undefined ? p.stock : 50} ชิ้น`;
}

// Flash Sale Overlay Controller
const flashSaleBanner = document.getElementById('flash-sale-banner');
const flashCountdown = document.getElementById('flash-countdown');

function updateFlashSaleBanner(state) {
  if (!flashSaleBanner || !flashCountdown) return;
  if (state && state.active && state.remainingSeconds > 0) {
    flashSaleBanner.classList.remove('hidden');
    const m = Math.floor(state.remainingSeconds / 60).toString().padStart(2, '0');
    const s = (state.remainingSeconds % 60).toString().padStart(2, '0');
    flashCountdown.textContent = `${m}:${s}`;
  } else {
    flashSaleBanner.classList.add('hidden');
  }
}

socket.on('flash_sale_tick', state => updateFlashSaleBanner(state));

socket.on('flash_sale_stopped', () => {
  if (flashSaleBanner) {
    flashSaleBanner.classList.add('hidden');
  }
});


