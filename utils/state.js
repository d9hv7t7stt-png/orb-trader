var fs = require("fs");
var PERSIST_FILE = "/tmp/swing-state.json";

function loadPersistedState() {
  try {
    if (fs.existsSync(PERSIST_FILE)) {
      return JSON.parse(fs.readFileSync(PERSIST_FILE, "utf8"));
    }
  } catch (e) {}
  return null;
}

function savePersistedState() {
  try {
    fs.writeFileSync(PERSIST_FILE, JSON.stringify({
      contracts: state.contracts,
      tickers: state.tickers
    }));
  } catch (e) {}
}

var _saved = loadPersistedState();

var state = {
  contracts: (_saved && _saved.contracts) ? _saved.contracts : { SPY: 2, SPXW: 1, IWM: 2, QQQ: 2 },
  tickers: (_saved && _saved.tickers) ? _saved.tickers : { SPY: true, SPXW: true, IWM: true, QQQ: true },
  positions: { SPY: null, SPXW: null, IWM: null, QQQ: null },
  signals: { SPY: null, SPXW: null, IWM: null, QQQ: null },
  log: []
};

function getState() { return state; }

function getPosition(ticker) { return state.positions[ticker]; }

function openPosition(ticker, side, contracts, entryPrice, strike, expiry) {
  state.positions[ticker] = {
    side: side,
    contracts: contracts,
    totalContracts: contracts,
    entryPrice: parseFloat(entryPrice) || 0,
    strike: strike,
    expiry: expiry,
    highWatermark: parseFloat(entryPrice) || 0,
    stopLevel: null,
    breakEvenActivated: false,
    lastProfitTier: 0,
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
  savePersistedState();
  logEvent("CONTRACTS", ticker + "=" + state.contracts[ticker]);
}

function toggleTicker(ticker, enabled) {
  state.tickers[ticker] = enabled;
  savePersistedState();
  logEvent("TICKER", ticker + " " + (enabled ? "enabled" : "disabled"));
}

function setLastSignal(ticker, data) {
  state.signals[ticker] = Object.assign({ time: new Date().toISOString() }, data);
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
  setLastSignal: setLastSignal,
  logEvent: logEvent
};
