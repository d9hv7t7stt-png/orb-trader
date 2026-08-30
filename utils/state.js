var fs = require("fs");
var tickers = require("./tickers");

var PERSIST_FILE = "/tmp/stock-trader-state.json";

function loadPersisted() {
  try {
    if (fs.existsSync(PERSIST_FILE)) return JSON.parse(fs.readFileSync(PERSIST_FILE, "utf8"));
  } catch (e) {}
  return null;
}

function savePersisted() {
  try {
    fs.writeFileSync(PERSIST_FILE, JSON.stringify({
      tickers: state.tickers,
      lastAlerts: state.lastAlerts
    }));
  } catch (e) {}
}

var _saved = loadPersisted();
var allTickers = tickers.getAllTickers();

function defaultTickers() {
  var map = {};
  allTickers.forEach(function (t) { map[t] = true; });
  return map;
}

var state = {
  mode: "paper_stock",
  tickers: (_saved && _saved.tickers) ? Object.assign(defaultTickers(), _saved.tickers) : defaultTickers(),
  scanResults: {},
  lastAlerts: (_saved && _saved.lastAlerts) ? _saved.lastAlerts : {},
  log: []
};

function getState() { return state; }

function isTickerEnabled(ticker) {
  return state.tickers[ticker] !== false;
}

function toggleTicker(ticker, enabled) {
  state.tickers[ticker] = !!enabled;
  savePersisted();
  logEvent("TICKER", ticker + " " + (enabled ? "enabled" : "disabled"));
}

function setScanResults(results) {
  state.scanResults = results;
}

function getLastAlert(key) {
  return state.lastAlerts[key] || null;
}

function setLastAlert(key, time) {
  state.lastAlerts[key] = time;
  savePersisted();
}

function logEvent(type, message) {
  var entry = { time: new Date().toISOString(), type: type, message: message };
  state.log.unshift(entry);
  if (state.log.length > 300) state.log.pop();
  console.log("[" + type + "] " + message);
}

module.exports = {
  getState: getState,
  isTickerEnabled: isTickerEnabled,
  toggleTicker: toggleTicker,
  setScanResults: setScanResults,
  getLastAlert: getLastAlert,
  setLastAlert: setLastAlert,
  logEvent: logEvent
};
