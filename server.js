// In-memory state — resets on server restart
let state = {
  day: 1,
  contracts: { SPY: 1, IWM: 1 },
  orb: {
    SPY: { high: null, low: null, mid: null, set: false },
    IWM: { high: null, low: null, mid: null, set: false },
  },
  positions: {
    // ticker → { side, halfIn, fullIn, contracts, entryPrice, highWatermark, stopped, traded }
    SPY: null,
    IWM: null,
  },
  lastReset: null,
  log: [],
};

function getState() { return state; }

function resetDay() {
  const today = new Date().toDateString();
  if (state.lastReset !== today) {
    state.orb = {
      SPY: { high: null, low: null, mid: null, set: false },
      IWM: { high: null, low: null, mid: null, set: false },
    };
    state.positions = { SPY: null, IWM: null };
    state.lastReset = today;
    logEvent("DAY_RESET", `New trading day. Contracts: SPY=${state.contracts.SPY}, IWM=${state.contracts.IWM}`);
  }
}

function setORB(ticker, high, low) {
  const h = parseFloat(high);
  const l = parseFloat(low);
  const mid = parseFloat(((h + l) / 2).toFixed(4));
  state.orb[ticker] = { high: h, low: l, mid, set: true };
  logEvent("ORB_SET", `${ticker} ORB → High: ${h}, Low: ${l}, Mid: ${mid}`);
}

function getPosition(ticker) { return state.positions[ticker]; }

function openHalfPosition(ticker, side, contracts, entryPrice) {
  state.positions[ticker] = {
    side,           // 'call' | 'put'
    halfIn: true,
    fullIn: false,
    contracts,      // half position size (Math.ceil(total/2))
    totalContracts: contracts,
    entryPrice: parseFloat(entryPrice),
    highWatermark: parseFloat(entryPrice),
    lastProfitTier: 0,  // tracks which profit tiers fired
    stopped: false,
    traded: true,
  };
  logEvent("POSITION_OPEN", `${ticker} ${side} half position: ${contracts} contracts @ $${entryPrice}`);
}

function addSecondHalf(ticker, contracts, fillPrice) {
  const pos = state.positions[ticker];
  if (!pos || pos.fullIn) return;
  pos.contracts += contracts;
  pos.fullIn = true;
  pos.halfIn = false;
  logEvent("POSITION_ADD", `${ticker} second half added: +${contracts} contracts @ $${fillPrice}. Total: ${pos.contracts}`);
}

function updateHighWatermark(ticker, currentPrice) {
  const pos = state.positions[ticker];
  if (!pos) return;
  if (currentPrice > pos.highWatermark) pos.highWatermark = currentPrice;
}

function markProfitTier(ticker, tier) {
  const pos = state.positions[ticker];
  if (pos) pos.lastProfitTier = tier;
}

function closePosition(ticker, reason) {
  const pos = state.positions[ticker];
  if (pos) {
    pos.stopped = true;
    logEvent("POSITION_CLOSE", `${ticker} closed — ${reason}`);
  }
}

function incrementContracts() {
  state.day++;
  state.contracts.SPY++;
  state.contracts.IWM++;
  logEvent("CONTRACTS", `Day ${state.day}: SPY=${state.contracts.SPY}, IWM=${state.contracts.IWM}`);
}

function logEvent(type, message) {
  const entry = { time: new Date().toISOString(), type, message };
  state.log.unshift(entry);
  if (state.log.length > 200) state.log.pop();
  console.log(`[${type}] ${message}`);
}

module.exports = {
  getState, resetDay, setORB, getPosition,
  openHalfPosition, addSecondHalf, updateHighWatermark,
  markProfitTier, closePosition, incrementContracts, logEvent,
};
