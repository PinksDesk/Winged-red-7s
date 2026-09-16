/**
 * Winged Red 7s — Batch 2
 * Compact phone controls, paytable modal, procedural cabinet sounds.
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

  /* —— Web Audio: fake-digital cabinet sounds (no samples) —— */
  const audio = {
    ctx: null,
    unlocked: false,
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

  function beep(freq, dur, type, gain, when) {
    if (state.muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = (when != null ? when : 0) + ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.08, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, gain, when) {
    if (state.muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = (when != null ? when : 0) + ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 1800;
    filt.Q.value = 0.8;
    g.gain.setValueAtTime(gain || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function sfxSpinStart() {
    // light digital whir + click
    beep(220, 0.06, "square", 0.05);
    beep(330, 0.08, "square", 0.04, 0.04);
    noiseBurst(0.05, 0.06, 0.02);
  }

  function sfxReelStop() {
    // mechanical clunk
    noiseBurst(0.045, 0.14);
    beep(90, 0.07, "triangle", 0.1);
    beep(55, 0.09, "sine", 0.06, 0.02);
  }

  function sfxWin(amount) {
    // rising chiptune cascade + coin tumble
    const steps = amount >= 5 ? 6 : amount >= 1 ? 4 : 3;
    for (let i = 0; i < steps; i++) {
      beep(440 + i * 110, 0.09, "square", 0.07, i * 0.07);
    }
    for (let i = 0; i < 5; i++) {
      noiseBurst(0.035, 0.08, 0.12 + i * 0.055);
      beep(900 + (i % 3) * 200, 0.04, "square", 0.045, 0.12 + i * 0.055);
    }
  }

  function sfxNoWin() {
    beep(160, 0.08, "triangle", 0.04);
    beep(110, 0.1, "triangle", 0.03, 0.06);
  }

  function sfxClick() {
    beep(520, 0.03, "square", 0.035);
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
