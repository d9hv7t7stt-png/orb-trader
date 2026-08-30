var indicators = require("./indicators");
var paper = require("./paper");
var tickers = require("./tickers");
var state = require("./state");
var discord = require("./discord");

var ALERT_COOLDOWN_MS = parseInt(process.env.ALERT_COOLDOWN_MIN || "60", 10) * 60 * 1000;
var scanning = false;

function isMarketHours() {
  var now = new Date();
  var utc = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utc >= 14 * 60 + 30 && utc <= 21 * 60;
}

function canAlert(ticker, maKey) {
  var key = ticker + ":" + maKey;
  var last = state.getLastAlert(key);
  if (!last) return true;
  return Date.now() - new Date(last).getTime() > ALERT_COOLDOWN_MS;
}

function markAlert(ticker, maKey) {
  state.setLastAlert(ticker + ":" + maKey, new Date().toISOString());
}

async function processTicker(data) {
  if (data.error || !data.price) return { alerts: 0, entries: 0 };

  var ticker = data.ticker;
  if (!state.isTickerEnabled(ticker)) return { alerts: 0, entries: 0 };

  var alerts = 0;
  var entries = 0;

  data.levels.forEach(function (level) {
    if (!level.near || level.value == null) return;

    if (canAlert(ticker, level.key)) {
      markAlert(ticker, level.key);
      alerts++;
      state.logEvent("MA_NEAR", ticker + " within " + level.proximity_pct + "% of " + level.label + " ($" + level.value + ")");
      discord.postProximityAlert(ticker, data.price, level).catch(function () {});
    }

    if (!paper.hasPosition(ticker, level.key)) {
      var shares = Math.floor(tickers.TRADE_SIZE / data.price);
      var trade = paper.buy(ticker, level.key, level.label, data.price, shares, "MA proximity entry");
      if (trade) {
        entries++;
        state.logEvent("STOCK_BUY", ticker + " " + shares + "sh @ $" + data.price + " (" + level.label + ")");
        discord.postStockEntry(ticker, level.label, data.price, shares, trade.total, level.proximity_pct).catch(function () {});
      }
    }
  });

  return { alerts: alerts, entries: entries };
}

async function runScan(force) {
  if (scanning) return { skipped: true, reason: "scan in progress" };
  if (!force && !isMarketHours()) {
    return { skipped: true, reason: "outside market hours" };
  }

  scanning = true;
  var start = Date.now();
  try {
    var list = tickers.getAllTickers().filter(state.isTickerEnabled);
    state.logEvent("SCAN", "Scanning " + list.length + " tickers…");
    var results = await indicators.fetchAllIndicators(list);
    state.setScanResults(results);

    var totalAlerts = 0;
    var totalEntries = 0;
    var nearHits = [];

    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var data = results[t];
      if (!data) continue;
      var out = await processTicker(data);
      totalAlerts += out.alerts;
      totalEntries += out.entries;
      if (data.levels) {
        data.levels.filter(function (l) { return l.near; }).forEach(function (l) {
          nearHits.push({ ticker: t, level: l.label, proximity: l.proximity_pct, price: data.price });
        });
      }
    }

    var livePrices = {};
    Object.values(results).forEach(function (r) {
      if (r && r.price) livePrices[r.ticker] = { price: r.price };
    });
    var unrealized = paper.getUnrealizedPnL(livePrices);
    var equity = paper.getEquity(livePrices);

    state.logEvent("SCAN_DONE", totalAlerts + " alerts, " + totalEntries + " entries, equity $" + equity.toFixed(0));

    return {
      ok: true,
      duration_ms: Date.now() - start,
      tickers: list.length,
      alerts: totalAlerts,
      entries: totalEntries,
      near_hits: nearHits,
      equity: equity,
      unrealized: unrealized.total
    };
  } catch (e) {
    state.logEvent("SCAN_ERROR", e.message);
    return { ok: false, error: e.message };
  } finally {
    scanning = false;
  }
}

function scheduleScanner() {
  var intervalMin = parseInt(process.env.SCAN_INTERVAL_MIN || "30", 10);
  state.logEvent("SCAN", "Scanner scheduled every " + intervalMin + " min");

  async function tick() {
    await runScan(false);
    setTimeout(tick, intervalMin * 60 * 1000);
  }

  setTimeout(function () {
    runScan(true).then(function () {
      setTimeout(tick, intervalMin * 60 * 1000);
    });
  }, 5000);
}

module.exports = { runScan: runScan, scheduleScanner: scheduleScanner };
