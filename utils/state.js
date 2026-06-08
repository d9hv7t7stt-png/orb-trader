// Swing Trader State
// Tracks positions, contract sizes, and daily log

var state = {
  contracts: { SPY: 2, SPXW: 1, IWM: 2, QQQ: 2 },
  tickers: { SPY: true, SPXW: true, IWM: true, QQQ: true }, // toggleable
  positions: { SPY: null, SPXW: null, IWM: null, QQQ: null },
  log: []
};

function getState() { return state; }

function getPosition(ticker) { return state.positions[ticker]; }

function openPosition(ticker, side, contracts, entryPrice, strike, expiry) {
  state.positions[ticker] = {
    side: side,           // 'call' | 'put'
    contracts: contracts,
    totalContracts: contracts,
    entryPrice: parseFloat(entryPrice) || 0,
    strike: strike,
    expiry: expiry,
    highWatermark: parseFloat(entryPrice) || 0,
    stopLevel: null,      // null = original stop (close below/above SMA), then breakeven, then ratchet
    breakEvenActivated: false,
    lastProfitTier: 0,    // tracks 20% increments for 10% sells
    weeklyMoveSold: false,
    hundredPctSold: false,
    stopped: false
  };
  logEvent("POSITION_OPEN", ticker + " " + side + " " + contracts + "c @ $" + entryPrice + " strike=" + strike + " exp=" + expiry);
}

function closePosition(ticker, reason) {
  var pos = state.positions[ticker];
  if (pos) {
    pos.stopped = true;
    logEvent("POSITION_CLOSE", ticker + " closed: " + reason);
  }
  state.positions[ticker] = null;
}

function updatePosition(ticker, updates) {
  var pos = state.positions[ticker];
  if (pos) Object.assign(pos, updates);
}

function setContractSize(ticker, contracts) {
  state.contracts[ticker] = parseInt(contracts) || 1;
  logEvent("CONTRACTS", ticker + "=" + state.contracts[ticker]);
}

function toggleTicker(ticker, enabled) {
  state.tickers[ticker] = enabled;
  logEvent("TICKER", ticker + " " + (enabled ? "enabled" : "disabled"));
}

function logEvent(type, message) {
  var entry = { time: new Date().toISOString(), type: type, message: message };
  state.log.unshift(entry);
  if (state.log.length > 200) state.log.pop();
  console.log("[" + type + "] " + message);
}

module.exports = {
  getState: getState,
  getPosition: getPosition,
  openPosition: openPosition,
  closePosition: closePosition,
  updatePosition: updatePosition,
  setContractSize: setContractSize,
  toggleTicker: toggleTicker,
  logEvent: logEvent
};
