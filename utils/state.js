var fs = require("fs");
var tickers = require("./tickers");
var pools = require("./pools");
var paths = require("./paths");

var PERSIST_FILE = paths.dataPath("stock-trader-state.json");
var LEGACY_STATE = "/tmp/stock-trader-state.json";

function defaultPoolTickers(pool) {
  var map = {};
  pool.getTickers().forEach(function (t) { map[t] = true; });
  return map;
}

function defaultPoolState(pool) {
  return {
    tickers: defaultPoolTickers(pool),
    scanResults: {},
    lastAlerts: {},
    lastScan: null
  };
}

function defaultState() {
  var state = { mode: "paper_stock", pools: {}, log: [] };
  pools.getAllPools().forEach(function (pool) {
    state.pools[pool.id] = defaultPoolState(pool);
  });
  return state;
}

function loadPersisted() {
  try {
    if (fs.existsSync(PERSIST_FILE)) return JSON.parse(fs.readFileSync(PERSIST_FILE, "utf8"));
    if (fs.existsSync(LEGACY_STATE)) {
      var legacy = JSON.parse(fs.readFileSync(LEGACY_STATE, "utf8"));
      paths.ensureDataDir();
      savePersisted(mergeState(legacy));
      console.log("[State] Migrated legacy state from /tmp");
      return legacy;
    }
  } catch (e) {
    console.error("[State] Load error:", e.message);
  }
  return null;
}

function savePersisted(state) {
  try {
    paths.ensureDataDir();
    var poolsOut = {};
    pools.getAllPools().forEach(function (pool) {
      var ps = state.pools[pool.id] || defaultPoolState(pool);
      poolsOut[pool.id] = {
        tickers: ps.tickers,
        lastAlerts: ps.lastAlerts
      };
    });
    fs.writeFileSync(PERSIST_FILE, JSON.stringify({
      pools: poolsOut,
      log: (state.log || []).slice(0, 100)
    }));
  } catch (e) {
    console.error("[State] Save error:", e.message);
  }
}

function mergeState(saved) {
  var state = defaultState();
  if (saved && saved.pools) {
    pools.getAllPools().forEach(function (pool) {
      var ps = saved.pools[pool.id] || {};
      state.pools[pool.id] = {
        tickers: Object.assign(defaultPoolTickers(pool), ps.tickers || {}),
        scanResults: {},
        lastAlerts: ps.lastAlerts || {},
        lastScan: null
      };
    });
  } else if (saved && saved.tickers) {
    state.pools.main = {
      tickers: Object.assign(defaultPoolTickers(pools.getPool("main")), saved.tickers),
      scanResults: saved.scanResults || {},
      lastAlerts: saved.lastAlerts || {},
      lastScan: saved.lastScan || null
    };
  }
  if (saved && Array.isArray(saved.log) && saved.log.length) {
    state.log = saved.log.slice(0, 100);
  }
  return state;
}

var state = mergeState(loadPersisted());

function poolState(poolId) {
  if (!pools.isValidPoolId(poolId)) poolId = "main";
  if (!state.pools[poolId]) {
    state.pools[poolId] = defaultPoolState(pools.getPool(poolId) || pools.POOLS.main);
  }
  return state.pools[poolId];
}

function getState(poolId) {
  if (poolId) {
    if (!pools.isValidPoolId(poolId)) poolId = "main";
    var ps = poolState(poolId);
    return {
      mode: state.mode,
      poolId: poolId,
      pool: pools.getPool(poolId),
      tickers: ps.tickers,
      scanResults: ps.scanResults,
      lastAlerts: ps.lastAlerts,
      lastScan: ps.lastScan,
      log: state.log
    };
  }
  return {
    mode: state.mode,
    pools: state.pools,
    log: state.log
  };
}

function isTickerEnabled(poolId, ticker) {
  return poolState(poolId).tickers[ticker] !== false;
}

function toggleTicker(poolId, ticker, enabled) {
  poolState(poolId).tickers[ticker] = !!enabled;
  savePersisted(state);
  logEvent("TICKER", ticker + " " + (enabled ? "enabled" : "disabled"), poolId);
}

function setScanResults(poolId, results) {
  var ps = poolState(poolId);
  ps.scanResults = results;
  ps.lastScan = new Date().toISOString();
}

function getLastAlert(poolId, key) {
  return poolState(poolId).lastAlerts[key] || null;
}

function setLastAlert(poolId, key, time) {
  poolState(poolId).lastAlerts[key] = time;
  savePersisted(state);
}

function logEvent(type, message, poolId) {
  var prefix = "";
  if (poolId && pools.isValidPoolId(poolId)) {
    prefix = "[" + pools.getPool(poolId).shortLabel + "] ";
  }
  var entry = { time: new Date().toISOString(), type: type, message: prefix + message, poolId: poolId || null };
  state.log.unshift(entry);
  if (state.log.length > 300) state.log.pop();
  console.log("[" + type + "] " + entry.message);
  savePersisted(state);
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
