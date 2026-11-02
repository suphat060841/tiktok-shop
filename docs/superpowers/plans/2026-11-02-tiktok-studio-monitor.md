# TikTok Studio All-in-One Live Director Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an All-in-One Live Director Monitor for TikTok LIVE Studio featuring real-time stream health diagnostics, live speech teleprompter with simulated VU audio meter, one-click basket switcher, quick Flash Sale triggers, and emergency audio controls directly flanking the 9:16 vertical stream monitor.

**Architecture:** Client-side split layout inside `#tab-monitor` divided into Left Diagnostics & Teleprompter Rail, Center 9:16 Studio Phone Preview, and Right Director Fast-Action Cockpit. Server provides lightweight ping/pong WebSocket events for latency tracking and leverages existing REST/Socket APIs for product pinning, Flash Sale control, and TTS event broadcasting.

**Tech Stack:** Vanilla JavaScript (ES6+), HTML5, CSS3 Grid/Flexbox with glassmorphism styling, Socket.IO, Express.js.

**Spec:** Integrated from user request "รวมครบวงจร" (All-in-One TikTok Studio Monitor) combining Stream Health Diagnostics, Live Teleprompter, and Director Fast-Action Controls.

## Global Constraints

- Must maintain 100% compatibility with existing overlay routes (`/stream-overlay`) and TikTok LIVE Studio 1080x1920 browser source.
- No regression on existing 69/69 test suite.
- Clean responsive layout that fits 1920x1080 desktop screens without horizontal overflow.
- Thai language UI copy with consistent emoji design language.

## Review Focus

1. **Ping Latency Tracking**: Network disconnection or rapid reconnects must not crash or loop the ping interval.
2. **Basket Pinning Sync**: Switching baskets from the monitor right rail must immediately reflect in both the dashboard left panel and the `/stream-overlay` without page reload.
3. **Audio VU Meter**: Meter must animate realistically when TTS audio is playing and reset to zero smoothly when speech finishes or stops.
4. **Teleprompter Overflow**: Long product pitches must wrap gracefully with auto-scroll or neat ellipsis without breaking the rail layout.
5. **Flash Sale State**: Timer in monitor cockpit must stay synchronized with server Flash Sale manager countdown.

---

### Task 1: Server-Side Ping/Pong Latency Channel & Health Endpoints

**Files:**
- Modify: `server.js:100-140`
- Test: `verify_system.mjs`

- [ ] Add `ping_check` socket handler in `server.js` returning `pong_check` with client timestamp for RTT calculation.
- [ ] Add `/api/stream/health` endpoint returning server uptime, active connections count, avatar mode, and memory usage.
- [ ] Verify test suite runs cleanly.

---

### Task 2: Studio Director Monitor HTML Structure in `public/index.html`

**Files:**
- Modify: `public/index.html:220-250`
- Test: `verify_system.mjs`

- [ ] Re-structure `#tab-monitor` into `.director-console` grid:
  - `.director-rail-left`: Stream Health Card (Ping, FPS, Avatar Mode, TikTok Status) + Live Teleprompter Card (Speech preview, VU Meter, Queued speech).
  - `.director-center`: Phone Frame 9:16 Live Preview (`#monitor-iframe`) + OBS URL bar.
  - `.director-rail-right`: Quick Basket Selector (Baskets 1-4 with active pin highlight) + Flash Sale Mini-Cockpit + Quick SFX/Emergency Mute.
- [ ] Verify HTML elements exist and validate syntax.

---

### Task 3: Director Monitor CSS Styling in `public/style.css`

**Files:**
- Modify: `public/style.css` (append director console styles)
- Test: `verify_system.mjs`

- [ ] Style `.director-console` as a 3-column responsive layout (`minmax(280px, 1fr) auto minmax(280px, 1fr)`).
- [ ] Style Audio VU Meter with gradient green-yellow-red LED bar animation.
- [ ] Style Teleprompter text bubble with glowing accent border when speech is active.
- [ ] Style Quick Basket mini-cards with pinned badge and hover effects.
- [ ] Ensure mobile / narrow screen responsiveness with graceful column wrapping.

---

### Task 4: Client Director Logic in `public/app.js`

**Files:**
- Modify: `public/app.js`
- Test: `verify_system.mjs`

- [ ] Implement ping/pong measurement loop (every 3 seconds) updating `#director-ping-val`.
- [ ] Bind `tts_event` to Live Teleprompter text and animate the VU Meter during speech.
- [ ] Render and bind Quick Basket selector (fetch `/api/products`, handle click to pin via `POST /api/products/pin`).
- [ ] Bind Mini Flash Sale buttons (3m, 5m, stop) to `/api/flash-sale/start` and `/api/flash-sale/stop`.
- [ ] Bind Director Quick SFX buttons and Emergency Mute.
- [ ] Synchronize state on `init_state` and `config_updated`.

---

### Task 5: System Verification, Testing & Git Deployment

**Files:**
- Modify: `verify_system.mjs`
- Test: `verify_system.mjs`

- [ ] Add comprehensive verification tests for:
  - Ping/pong socket handling
  - `/api/stream/health` endpoint
  - Director monitor DOM elements (teleprompter, VU meter, quick baskets, ping display)
- [ ] Run full test suite and ensure all tests pass (>70/70 tests).
- [ ] Commit and push to `origin/main` for automatic Render deployment.
