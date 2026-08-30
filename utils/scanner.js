var indicators = require("./indicators");
var paper = require("./paper");
var tickers = require("./tickers");
var state = require("./state");
var discord = require("./discord");
var pools = require("./pools");

var ALERT_COOLDOWN_MS = parseInt(process.env.ALERT_COOLDOWN_MIN || "60", 10) * 60 * 1000;
var scanning = false;

function isMarketHours() {
  var now = new Date();
  var utc = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utc >= 14 * 60 + 30 && utc <= 21 * 60;
}

function canAlert(poolId, ticker, maKey) {
  var key = ticker + ":" + maKey;
  var last = state.getLastAlert(poolId, key);
  if (!last) return true;
  return Date.now() - new Date(last).getTime() > ALERT_COOLDOWN_MS;
}

function markAlert(poolId, ticker, maKey) {
  state.setLastAlert(poolId, ticker + ":" + maKey, new Date().toISOString());
}

async function processStopLosses(poolId, results) {
  var exits = 0;
  var livePrices = {};
  Object.values(results).forEach(function (r) {
    if (r && r.price) livePrices[r.ticker] = { price: r.price };
  });

  paper.getOpenPositions(poolId).forEach(function (entry) {
    var key = entry.key;
    var pos = entry.pos;
    var data = results[pos.ticker];
    if (!data || !data.price || !data.levels) return;

    var sma55 = data.levels.find(function (l) { return l.key === tickers.STOP_MA_KEY; });
    if (!sma55 || sma55.value == null) return;

    if (data.price < sma55.value) {
      var trade = paper.sell(poolId, key, data.price, "Stop loss — close below 55-Day SMA ($" + sma55.value.toFixed(2) + ")");
      if (trade) {
        exits++;
        state.logEvent("STOP_LOSS", pos.ticker + " sold @ $" + data.price + " (below 55 SMA $" + sma55.value.toFixed(2) + ")", poolId);
        discord.postStockExit(poolId, pos.ticker, pos.maLabel, data.price, trade.pnl, trade.pct, trade.reason, "stop").catch(function () {});
      }
    }
  });

  return exits;
}

async function processTakeProfits(poolId, results) {
  var tpExits = 0;

  paper.getOpenPositions(poolId).forEach(function (entry) {
    var key = entry.key;
    var pos = entry.pos;
    var data = results[pos.ticker];
    if (!data || !data.price || pos.entryPrice <= 0) return;

    var gainPct = ((data.price - pos.entryPrice) / pos.entryPrice) * 100;
    var tierIdx = pos.lastProfitTier || 0;
    var original = pos.totalShares || pos.shares;

    for (var i = tierIdx; i < tickers.TAKE_PROFIT_TIERS.length; i++) {
      var tier = tickers.TAKE_PROFIT_TIERS[i];
      if (gainPct < tier.pct) break;

      var open = paper.getOpenPositions(poolId).find(function (e) { return e.key === key; });
      if (!open) break;
      pos = open.pos;

      var sellShares;
      if (tier.sellPct >= 1) {
        sellShares = pos.shares;
      } else {
        sellShares = Math.max(1, Math.floor(original * tier.sellPct));
        sellShares = Math.min(sellShares, pos.shares);
      }

      var reason = "Take profit " + tier.label + " (+" + gainPct.toFixed(1) + "%)";
      var trade = sellShares >= pos.shares
        ? paper.sell(poolId, key, data.price, reason)
        : paper.sellPartial(poolId, key, data.price, sellShares, reason);

      if (trade) {
        tpExits++;
        paper.markProfitTier(poolId, key, i + 1);
        state.logEvent("TAKE_PROFIT", pos.ticker + " " + tier.label + " sold " + sellShares + "sh @ $" + data.price + " (+" + gainPct.toFixed(1) + "%)", poolId);
        discord.postTakeProfit(poolId, pos.ticker, pos.maLabel, tier.label, data.price, sellShares, trade.pnl, trade.pct, trade.remaining).catch(function () {});
      }

      if (!paper.getOpenPositions(poolId).find(function (e) { return e.key === key; })) break;
    }
  });

  return tpExits;
}

async function processTicker(poolId, data, livePrices) {
  if (data.error || !data.price) return { alerts: 0, entries: 0 };

  var ticker = data.ticker;
  if (!state.isTickerEnabled(poolId, ticker)) return { alerts: 0, entries: 0 };

  var alerts = 0;
  var entries = 0;

  data.levels.forEach(function (level) {
    if (!level.near || level.value == null) return;

    if (canAlert(poolId, ticker, level.key)) {
      markAlert(poolId, ticker, level.key);
      alerts++;
      state.logEvent("MA_NEAR", ticker + " within " + level.proximity_pct + "% of " + level.label + " ($" + level.value + ")", poolId);
      discord.postProximityAlert(poolId, ticker, data.price, level).catch(function () {});
    }

    if (!paper.hasPosition(poolId, ticker, level.key)) {
      var riskUsd = paper.getPositionSizeUSD(poolId, livePrices);
      var shares = Math.floor(riskUsd / data.price);
      var trade = paper.buy(poolId, ticker, level.key, level.label, data.price, shares, "MA proximity entry", riskUsd);
      if (trade) {
        entries++;
        state.logEvent("STOCK_BUY", ticker + " " + shares + "sh @ $" + data.price + " (" + level.label + ", " + riskUsd + " risk)", poolId);
        discord.postStockEntry(poolId, ticker, level.label, data.price, shares, trade.total, level.proximity_pct, riskUsd).catch(function () {});
      }
    }
  });

  return { alerts: alerts, entries: entries };
}

async function runPoolScan(poolId, force) {
  var pool = pools.getPool(poolId);
  var list = pool.getTickers().filter(function (t) { return state.isTickerEnabled(poolId, t); });
  state.logEvent("SCAN", "Scanning " + list.length + " tickers…", poolId);

  var results = await indicators.fetchAllIndicators(list, function (ticker) {
    return pools.getYahooSymbol(poolId, ticker);
  });
  state.setScanResults(poolId, results);

  var livePrices = {};
  Object.values(results).forEach(function (r) {
    if (r && r.price) livePrices[r.ticker] = { price: r.price };
  });

  var totalExits = await processStopLosses(poolId, results);
  var totalTakeProfits = await processTakeProfits(poolId, results);

  var totalAlerts = 0;
  var totalEntries = 0;
  var nearHits = [];

  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var data = results[t];
    if (!data) continue;
    var out = await processTicker(poolId, data, livePrices);
    totalAlerts += out.alerts;
    totalEntries += out.entries;
    if (data.levels) {
      data.levels.filter(function (l) { return l.near; }).forEach(function (l) {
        nearHits.push({ poolId: poolId, ticker: t, level: l.label, proximity: l.proximity_pct, price: data.price });
      });
    }
  }

  var equity = paper.getEquity(poolId, livePrices);
  state.logEvent("SCAN_DONE", totalAlerts + " alerts, " + totalEntries + " entries, " + totalExits + " stops, " + totalTakeProfits + " TPs, equity $" + equity.toFixed(0), poolId);

  return {
    poolId: poolId,
    poolLabel: pool.shortLabel,
    tickers: list.length,
    alerts: totalAlerts,
    entries: totalEntries,
    exits: totalExits,
    take_profits: totalTakeProfits,
    near_hits: nearHits,
    equity: equity,
    unrealized: paper.getUnrealizedPnL(poolId, livePrices).total
  };
}

async function runScan(force) {
  if (scanning) return { skipped: true, reason: "scan in progress" };
  if (!force && !isMarketHours()) {
    return { skipped: true, reason: "outside market hours" };
  }

  scanning = true;
  var start = Date.now();
  try {
    var poolResults = [];
    for (var i = 0; i < pools.getAllPools().length; i++) {
      var pool = pools.getAllPools()[i];
      poolResults.push(await runPoolScan(pool.id, force));
    }

    return {
      ok: true,
      duration_ms: Date.now() - start,
      pools: poolResults
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
  state.logEvent("SCAN", "Scanner scheduled every " + intervalMin + " min (all pools)");

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
