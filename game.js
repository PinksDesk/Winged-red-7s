/**
 * Winged Red 7s — Batch 1
 * 3-reel × 3-row single-player spin loop, fake money, localStorage isolation.
 */
(function () {
  "use strict";

  const STORAGE_KEY = "winged-red-7s-v1";
  const START_BANKROLL = 100;
  const DENOMS = [0.25, 0.5, 1];
  const SYMBOLS = ["red7", "white7", "blue7", "rwb7"];
  const SYMBOL_LABEL = { red7: "7", white7: "7", blue7: "7", rwb7: "7" };
  const SYMBOL_CLASS = { red7: "red7", white7: "white7", blue7: "blue7", rwb7: "rwb7" };

  // Weighted reel strip (slightly house-favored / cheap 7s)
  const REEL_WEIGHTS = [
    { id: "blue7", w: 34 },
    { id: "white7", w: 28 },
    { id: "red7", w: 22 },
    { id: "rwb7", w: 16 },
  ];

  // Multiplier × denom per winning line
  const PAYTABLE = {
    rwb7: 40,
    red7: 20,
    white7: 12,
    blue7: 8,
    mixed: 3,
  };

  // Line row indices: line1 middle, line2 top, line3 bottom
  const LINE_ROWS = { 1: 1, 2: 0, 3: 2 };

  const state = {
    bankroll: START_BANKROLL,
    denomIndex: 0,
    lines: 1,
    phase: "IDLE", // IDLE | SPINNING
    lastWin: 0,
    lastGrid: null, // 3 reels × 3 rows [col][row]
    spinToken: 0,
  };

  const els = {
    bankroll: document.getElementById("bankroll"),
    totalBet: document.getElementById("totalBet"),
    lastWin: document.getElementById("lastWin"),
    status: document.getElementById("status"),
    denomBtn: document.getElementById("denomBtn"),
    linesBtn: document.getElementById("linesBtn"),
    spinBtn: document.getElementById("spinBtn"),
    strips: [
      document.getElementById("strip0"),
      document.getElementById("strip1"),
      document.getElementById("strip2"),
    ],
    lineMarkers: Array.from(document.querySelectorAll(".lm")),
  };

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
    // symbols: [left, mid, right]
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

  function updateUI() {
    els.bankroll.textContent = money(state.bankroll);
    els.totalBet.textContent = money(totalBet());
    els.lastWin.textContent = money(state.lastWin);
    els.denomBtn.textContent = money(denom());
    els.linesBtn.textContent = state.lines === 1 ? "1 Line" : state.lines + " Lines";
    updateLineMarkers();

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
    } catch (_) {
      /* ignore corrupt */
    }
  }

  function cycleDenom() {
    if (state.phase !== "IDLE") return;
    state.denomIndex = (state.denomIndex + 1) % DENOMS.length;
    save();
    updateUI();
    setStatus("Denom " + money(denom()) + " · bet " + money(totalBet()), "");
  }

  function cycleLines() {
    if (state.phase !== "IDLE") return;
    state.lines = state.lines >= 3 ? 1 : state.lines + 1;
    save();
    updateUI();
    setStatus(state.lines + " line(s) · bet " + money(totalBet()), "");
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function animateReel(col, finalColSymbols, durationMs, token) {
    const strip = els.strips[col];
    const s = step();
    const spins = 12 + col * 6; // left stops first
    const sequence = [];
    for (let i = 0; i < spins; i++) sequence.push(pickSymbol());
    // Final visible window is last 3 symbols (top, mid, bottom)
    sequence.push(finalColSymbols[0], finalColSymbols[1], finalColSymbols[2]);

    strip.style.transition = "none";
    strip.innerHTML = "";
    sequence.forEach((id) => strip.appendChild(makeCell(id)));
    strip.style.transform = "translateY(0)";

    // Force layout
    void strip.offsetHeight;

    const endY = -((sequence.length - 3) * s);
    strip.style.transition = "transform " + durationMs + "ms cubic-bezier(0.12, 0.75, 0.2, 1)";
    strip.style.transform = "translateY(" + endY + "px)";

    await sleep(durationMs + 40);
    if (token !== state.spinToken) return;

    // Snap to clean 3-cell strip
    strip.style.transition = "none";
    strip.innerHTML = "";
    finalColSymbols.forEach((id) => strip.appendChild(makeCell(id)));
    strip.style.transform = "translateY(0)";
  }

  async function spin() {
    if (state.phase !== "IDLE") return;
    const bet = totalBet();
    if (state.bankroll + 1e-9 < bet) {
      setStatus("Not enough bankroll for bet", "lose");
      updateUI();
      return;
    }

    state.phase = "SPINNING";
    state.spinToken += 1;
    const token = state.spinToken;
    state.bankroll = Math.round((state.bankroll - bet) * 100) / 100;
    state.lastWin = 0;
    save();
    updateUI();
    setStatus("Spinning…", "spinning");

    // Build final grid [col][row]
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
    } else {
      setStatus("No win — try again", "lose");
    }
  }

  function onKeyDown(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.dataset.action === "spin" || t.dataset.action === "denom" || t.dataset.action === "lines") {
      e.preventDefault();
      t.click();
    }
  }

  function bind() {
    els.spinBtn.addEventListener("click", () => spin());
    els.denomBtn.addEventListener("click", () => cycleDenom());
    els.linesBtn.addEventListener("click", () => cycleLines());
    document.addEventListener("keydown", onKeyDown);
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
