/**
 * Winged Red 7s — Batch 2
 * Compact phone controls, paytable modal, mechanical bar-cabinet SFX.
 * Batch 1 spin/bet/save behavior preserved.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "winged-red-7s-v1";
  const START_BANKROLL = 100;
  const DENOMS = [0.25, 0.5, 1];
  const SYMBOLS = ["red7", "white7", "blue7", "rwb7"];
  const SYMBOL_LABEL = { red7: "7", white7: "7", blue7: "7", rwb7: "7" };
  const SYMBOL_CLASS = { red7: "red7", white7: "white7", blue7: "blue7", rwb7: "rwb7" };

  const REEL_WEIGHTS = [
    { id: "blue7", w: 34 },
    { id: "white7", w: 28 },
    { id: "red7", w: 22 },
    { id: "rwb7", w: 16 },
  ];

  const PAYTABLE = {
    rwb7: 40,
    red7: 20,
    white7: 12,
    blue7: 8,
    mixed: 3,
  };

  const LINE_ROWS = { 1: 1, 2: 0, 3: 2 };

  const state = {
    bankroll: START_BANKROLL,
    denomIndex: 0,
    lines: 1,
    phase: "IDLE",
    lastWin: 0,
    lastGrid: null,
    spinToken: 0,
    muted: false,
  };

  const els = {
    bankroll: document.getElementById("bankroll"),
    totalBet: document.getElementById("totalBet"),
    lastWin: document.getElementById("lastWin"),
    status: document.getElementById("status"),
    denomBtn: document.getElementById("denomBtn"),
    linesBtn: document.getElementById("linesBtn"),
    spinBtn: document.getElementById("spinBtn"),
    paytableBtn: document.getElementById("paytableBtn"),
    muteBtn: document.getElementById("muteBtn"),
    paytableModal: document.getElementById("paytableModal"),
    paytableClose: document.getElementById("paytableClose"),
    strips: [
      document.getElementById("strip0"),
      document.getElementById("strip1"),
      document.getElementById("strip2"),
    ],
    lineMarkers: Array.from(document.querySelectorAll(".lm")),
  };

  /* —— Web Audio: old mechanical bar-7s cabinet (procedural, no samples) —— */
  const audio = {
    ctx: null,
    unlocked: false,
    spin: null,
  };

  function ensureAudio() {
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio.ctx = new AC();
    }
    if (audio.ctx.state === "suspended") {
      audio.ctx.resume().catch(function () {});
    }
    audio.unlocked = true;
    return audio.ctx;
  }

  function makeNoiseBuffer(ctx, seconds) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.97 * b0 + 0.03 * white;
      data[i] = white * 0.35 + b0 * 0.65;
    }
    return buf;
  }

  function stopSpinLoop(fadeMs) {
    const nodes = audio.spin;
    if (!nodes) return;
    audio.spin = null;
    const ctx = audio.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const fade = Math.max(0.03, (fadeMs || 90) / 1000);
    try {
      if (nodes.tickTimer) {
        clearInterval(nodes.tickTimer);
        nodes.tickTimer = null;
      }
      if (nodes.master) {
        const cur = Math.max(nodes.master.gain.value, 0.0001);
        nodes.master.gain.cancelScheduledValues(t);
        nodes.master.gain.setValueAtTime(cur, t);
        nodes.master.gain.exponentialRampToValueAtTime(0.0001, t + fade);
      }
      const stopAt = t + fade + 0.06;
      (nodes.sources || []).forEach(function (s) {
        try {
          s.stop(stopAt);
        } catch (_) {}
      });
    } catch (_) {}
  }

  function softRatchetTick() {
    if (state.muted || !audio.spin || !audio.ctx) return;
    const ctx = audio.ctx;
    const t0 = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.016));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 1600 + Math.random() * 400;
    filt.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.028, t0 + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.015);
    src.connect(filt);
    filt.connect(g);
    g.connect(audio.spin.master);
    src.start(t0);
    src.stop(t0 + 0.02);
  }

  function sfxSpinStart() {
    if (state.muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    stopSpinLoop(20);

    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(1, t0 + 0.06);
    master.connect(ctx.destination);

    // Continuous filtered noise — reel whir bed
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = makeNoiseBuffer(ctx, 1.6);
    noiseSrc.loop = true;
    const noiseFilt = ctx.createBiquadFilter();
    noiseFilt.type = "bandpass";
    noiseFilt.frequency.setValueAtTime(620, t0);
    noiseFilt.frequency.linearRampToValueAtTime(980, t0 + 2.4);
    noiseFilt.Q.value = 0.85;
    const noiseG = ctx.createGain();
    noiseG.gain.value = 0.05;
    noiseSrc.connect(noiseFilt);
    noiseFilt.connect(noiseG);
    noiseG.connect(master);
    noiseSrc.start(t0);

    // Low-mid motor whir (mechanical, not a beep loop)
    const whir = ctx.createOscillator();
    whir.type = "sawtooth";
    whir.frequency.setValueAtTime(88, t0);
    whir.frequency.linearRampToValueAtTime(112, t0 + 2.0);
    const whirFilt = ctx.createBiquadFilter();
    whirFilt.type = "lowpass";
    whirFilt.frequency.value = 360;
    whirFilt.Q.value = 0.6;
    const whirG = ctx.createGain();
    whirG.gain.value = 0.03;
    whir.connect(whirFilt);
    whirFilt.connect(whirG);
    whirG.connect(master);
    whir.start(t0);

    // Soft sub rumble under the whir
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(52, t0);
    const subG = ctx.createGain();
    subG.gain.value = 0.022;
    sub.connect(subG);
    subG.connect(master);
    sub.start(t0);

    const tickTimer = setInterval(function () {
      softRatchetTick();
    }, 90 + Math.floor(Math.random() * 25));

    audio.spin = {
      master: master,
      sources: [noiseSrc, whir, sub],
      tickTimer: tickTimer,
    };
  }

  function sfxReelStop() {
    if (state.muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime;

    // Weighty mid-frequency mechanical clunk body (noise)
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.1));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.55);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(1500, t0);
    filt.frequency.exponentialRampToValueAtTime(380, t0 + 0.08);
    filt.Q.value = 1.3;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(0.24, t0 + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.095);
    src.connect(filt);
    filt.connect(ng);
    ng.connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + 0.11);

    // Pitch-drop thunk — weighty, not a toy click
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(185, t0);
    osc.frequency.exponentialRampToValueAtTime(52, t0 + 0.085);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.17, t0 + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
    osc.connect(og);
    og.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.13);

    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(105, t0);
    osc2.frequency.exponentialRampToValueAtTime(45, t0 + 0.1);
    const og2 = ctx.createGain();
    og2.gain.setValueAtTime(0.0001, t0);
    og2.gain.exponentialRampToValueAtTime(0.11, t0 + 0.004);
    og2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    osc2.connect(og2);
    og2.connect(ctx.destination);
    osc2.start(t0);
    osc2.stop(t0 + 0.14);
  }

  function coinClink(absTime, peak) {
    const ctx = audio.ctx;
    if (!ctx) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.065));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.1);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 2000 + Math.random() * 2200;
    filt.Q.value = 2.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, absTime);
    g.gain.exponentialRampToValueAtTime(peak, absTime + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, absTime + 0.058);
    src.connect(filt);
    filt.connect(g);
    g.connect(ctx.destination);
    src.start(absTime);
    src.stop(absTime + 0.07);

    const o = ctx.createOscillator();
    o.type = "triangle";
    const f = 1600 + Math.random() * 1600;
    o.frequency.setValueAtTime(f, absTime);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, absTime + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, absTime);
    og.gain.exponentialRampToValueAtTime(peak * 0.4, absTime + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, absTime + 0.048);
    o.connect(og);
    og.connect(ctx.destination);
    o.start(absTime);
    o.stop(absTime + 0.055);
  }

  function sfxWin(amount) {
    if (state.muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime;

    // Short knocker / bell, then change into tray
    function knocker(freq, when, peak) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, t0 + when);
      o.frequency.exponentialRampToValueAtTime(freq * 0.82, t0 + when + 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + when);
      g.gain.exponentialRampToValueAtTime(peak, t0 + when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + when + 0.2);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0 + when);
      o.stop(t0 + when + 0.22);
    }
    knocker(920, 0, 0.13);
    knocker(1240, 0.045, 0.075);

    const bursts = amount >= 5 ? 11 : amount >= 1 ? 8 : 5;
    let delay = 0.15;
    for (let i = 0; i < bursts; i++) {
      delay += 0.03 + Math.random() * 0.075;
      coinClink(t0 + delay, 0.055 + Math.random() * 0.055);
    }
  }

  function sfxNoWin() {
    if (state.muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    // Soft dull settle — mechanical, not a modern UI down-chirp
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(98, t0);
    osc.frequency.exponentialRampToValueAtTime(58, t0 + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.048, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  }

  function sfxClick() {
    if (state.muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    // Tiny old electronic beep for denom/lines — not a modern chirp
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(420, t0);
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.038, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.032);
    osc.connect(filt);
    filt.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.04);
  }

  function money(n) {
    return "$" + Number(n).toFixed(2);
  }

  function denom() {
    return DENOMS[state.denomIndex];
  }

  function totalBet() {
    return denom() * state.lines;
  }

  function pickSymbol() {
    const total = REEL_WEIGHTS.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const item of REEL_WEIGHTS) {
      r -= item.w;
      if (r <= 0) return item.id;
    }
    return REEL_WEIGHTS[0].id;
  }

  function makeCell(symbolId) {
    const div = document.createElement("div");
    div.className = "symbol " + SYMBOL_CLASS[symbolId];
    div.textContent = SYMBOL_LABEL[symbolId];
    div.dataset.symbol = symbolId;
    div.setAttribute("aria-hidden", "true");
    return div;
  }

  function cellSize() {
    const probe = els.strips[0].querySelector(".symbol");
    if (probe) return probe.getBoundingClientRect().height;
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--cell");
    return parseFloat(raw) || 72;
  }

  function gapSize() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--gap");
    return parseFloat(raw) || 8;
  }

  function step() {
    return cellSize() + gapSize();
  }

  function renderStaticGrid(grid) {
    for (let c = 0; c < 3; c++) {
      const strip = els.strips[c];
      strip.style.transition = "none";
      strip.innerHTML = "";
      for (let r = 0; r < 3; r++) {
        strip.appendChild(makeCell(grid[c][r]));
      }
      strip.style.transform = "translateY(0)";
    }
  }

  function defaultGrid() {
    return [
      ["red7", "white7", "blue7"],
      ["white7", "rwb7", "red7"],
      ["blue7", "red7", "white7"],
    ];
  }

  function lineWin(symbols) {
    if (symbols[0] === symbols[1] && symbols[1] === symbols[2]) {
      return PAYTABLE[symbols[0]] || 0;
    }
    const allSevens = symbols.every((s) => SYMBOLS.includes(s));
    if (allSevens) return PAYTABLE.mixed;
    return 0;
  }

  function evaluate(grid, lines) {
    let totalMult = 0;
    const wins = [];
    for (let L = 1; L <= lines; L++) {
      const row = LINE_ROWS[L];
      const syms = [grid[0][row], grid[1][row], grid[2][row]];
      const mult = lineWin(syms);
      if (mult > 0) {
        totalMult += mult;
        wins.push({ line: L, mult, syms });
      }
    }
    return { totalMult, wins, amount: totalMult * denom() };
  }

  function updateLineMarkers() {
    els.lineMarkers.forEach((el) => {
      const n = Number(el.textContent.trim());
      el.classList.toggle("active", n <= state.lines);
    });
  }

  function setStatus(text, kind) {
    els.status.textContent = text;
    els.status.className = "status" + (kind ? " " + kind : "");
  }

  function updateMuteUI() {
    els.muteBtn.textContent = state.muted ? "Muted" : "Sound On";
    els.muteBtn.setAttribute("aria-pressed", state.muted ? "true" : "false");
    els.muteBtn.title = state.muted ? "Unmute" : "Mute";
  }

  function updateUI() {
    els.bankroll.textContent = money(state.bankroll);
    els.totalBet.textContent = money(totalBet());
    els.lastWin.textContent = money(state.lastWin);
    els.denomBtn.textContent = money(denom());
    els.linesBtn.textContent = state.lines === 1 ? "1 Line" : state.lines + " Lines";
    updateLineMarkers();
    updateMuteUI();

    const spinning = state.phase === "SPINNING";
    els.denomBtn.disabled = spinning;
    els.linesBtn.disabled = spinning;
    const canSpin = !spinning && state.bankroll + 1e-9 >= totalBet();
    els.spinBtn.disabled = !canSpin;
    if (!spinning && state.bankroll + 1e-9 < totalBet()) {
      setStatus("Not enough bankroll for bet — lower denom or lines", "lose");
    }
  }

  function save() {
    const payload = {
      bankroll: state.bankroll,
      denomIndex: state.denomIndex,
      lines: state.lines,
      lastWin: state.lastWin,
      lastGrid: state.lastGrid,
      muted: state.muted,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {
      /* ignore quota / private mode */
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.bankroll === "number" && data.bankroll >= 0) {
        state.bankroll = Math.round(data.bankroll * 100) / 100;
      }
      if (Number.isInteger(data.denomIndex) && data.denomIndex >= 0 && data.denomIndex < DENOMS.length) {
        state.denomIndex = data.denomIndex;
      }
      if (data.lines === 1 || data.lines === 2 || data.lines === 3) {
        state.lines = data.lines;
      }
      if (typeof data.lastWin === "number") state.lastWin = data.lastWin;
      if (Array.isArray(data.lastGrid) && data.lastGrid.length === 3) {
        state.lastGrid = data.lastGrid;
      }
      if (typeof data.muted === "boolean") state.muted = data.muted;
    } catch (_) {
      /* ignore corrupt */
    }
  }

  function cycleDenom() {
    if (state.phase !== "IDLE") return;
    ensureAudio();
    sfxClick();
    state.denomIndex = (state.denomIndex + 1) % DENOMS.length;
    save();
    updateUI();
    setStatus("Denom " + money(denom()) + " · bet " + money(totalBet()), "");
  }

  function cycleLines() {
    if (state.phase !== "IDLE") return;
    ensureAudio();
    sfxClick();
    state.lines = state.lines >= 3 ? 1 : state.lines + 1;
    save();
    updateUI();
    setStatus(state.lines + " line(s) · bet " + money(totalBet()), "");
  }

  function toggleMute() {
    ensureAudio();
    state.muted = !state.muted;
    if (state.muted) stopSpinLoop(50);
    save();
    updateMuteUI();
    if (!state.muted) sfxClick();
  }

  function openPaytable() {
    els.paytableModal.hidden = false;
    els.paytableClose.focus();
  }

  function closePaytable() {
    if (els.paytableModal.hidden) return;
    els.paytableModal.hidden = true;
    els.paytableBtn.focus();
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function animateReel(col, finalColSymbols, durationMs, token) {
    const strip = els.strips[col];
    const s = step();
    const spins = 12 + col * 6;
    const sequence = [];
    for (let i = 0; i < spins; i++) sequence.push(pickSymbol());
    sequence.push(finalColSymbols[0], finalColSymbols[1], finalColSymbols[2]);

    strip.style.transition = "none";
    strip.innerHTML = "";
    sequence.forEach((id) => strip.appendChild(makeCell(id)));
    strip.style.transform = "translateY(0)";

    void strip.offsetHeight;

    const endY = -((sequence.length - 3) * s);
    strip.style.transition = "transform " + durationMs + "ms cubic-bezier(0.12, 0.75, 0.2, 1)";
    strip.style.transform = "translateY(" + endY + "px)";

    await sleep(durationMs + 40);
    if (token !== state.spinToken) return;

    strip.style.transition = "none";
    strip.innerHTML = "";
    finalColSymbols.forEach((id) => strip.appendChild(makeCell(id)));
    strip.style.transform = "translateY(0)";
    sfxReelStop();
  }

  async function spin() {
    if (state.phase !== "IDLE") return;
    const bet = totalBet();
    if (state.bankroll + 1e-9 < bet) {
      setStatus("Not enough bankroll for bet", "lose");
      updateUI();
      return;
    }

    ensureAudio();
    state.phase = "SPINNING";
    state.spinToken += 1;
    const token = state.spinToken;
    state.bankroll = Math.round((state.bankroll - bet) * 100) / 100;
    state.lastWin = 0;
    save();
    updateUI();
    setStatus("Spinning…", "spinning");
    sfxSpinStart();

    const grid = [[], [], []];
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) grid[c][r] = pickSymbol();
    }

    const base = 900;
    await Promise.all([
      animateReel(0, grid[0], base, token),
      animateReel(1, grid[1], base + 450, token),
      animateReel(2, grid[2], base + 900, token),
    ]);

    if (token !== state.spinToken) return;

    stopSpinLoop(110);

    const result = evaluate(grid, state.lines);
    state.lastGrid = grid;
    state.lastWin = result.amount;
    state.bankroll = Math.round((state.bankroll + result.amount) * 100) / 100;
    state.phase = "IDLE";
    save();
    updateUI();

    if (result.amount > 0) {
      const parts = result.wins.map((w) => "L" + w.line + " ×" + w.mult).join(", ");
      setStatus("Win " + money(result.amount) + " (" + parts + ")", "win");
      sfxWin(result.amount);
    } else {
      setStatus("No win — try again", "lose");
      sfxNoWin();
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && !els.paytableModal.hidden) {
      e.preventDefault();
      closePaytable();
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const action = t.dataset.action;
    if (action === "spin" || action === "denom" || action === "lines" || action === "paytable" || action === "mute" || action === "close-paytable") {
      e.preventDefault();
      t.click();
    }
  }

  function bind() {
    els.spinBtn.addEventListener("click", () => spin());
    els.denomBtn.addEventListener("click", () => cycleDenom());
    els.linesBtn.addEventListener("click", () => cycleLines());
    els.paytableBtn.addEventListener("click", () => openPaytable());
    els.muteBtn.addEventListener("click", () => toggleMute());
    els.paytableModal.addEventListener("click", (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.dataset.action === "close-paytable") {
        closePaytable();
      }
    });
    document.addEventListener("keydown", onKeyDown);
    // Unlock audio on first gesture anywhere
    const unlock = () => {
      ensureAudio();
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
  }

  function init() {
    load();
    const grid = state.lastGrid || defaultGrid();
    state.lastGrid = grid;
    renderStaticGrid(grid);
    bind();
    updateUI();
    if (state.phase === "IDLE") {
      setStatus("Ready — press Spin", "");
    }
  }

  init();
})();
