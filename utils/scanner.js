var indicators = require("./indicators");
var paper = require("./paper");
var tickers = require("./tickers");
var state = require("./state");
var discord = require("./discord");
var pools = require("./pools");
var marketHours = require("./marketHours");

var ALERT_COOLDOWN_MS = parseInt(process.env.ALERT_COOLDOWN_MIN || "60", 10) * 60 * 1000;
var scanning = false;

function canAlert(poolId, ticker, maKey) {
  var key = ticker + ":" + maKey;
  var last = state.getLastAlert(poolId, key);
  if (!last) return true;
  return Date.now() - new Date(last).getTime() > ALERT_COOLDOWN_MS;
}

function markAlert(poolId, ticker, maKey) {
  state.setLastAlert(poolId, ticker + ":" + maKey, new Date().toISOString());
}

function flattenAlertOnlyPositions(poolId, results) {
  var flattened = 0;
  paper.getOpenPositions(poolId).forEach(function (entry) {
    var pos = entry.pos;
    if (!tickers.isAlertOnly(pos.ticker)) return;
    var data = results[pos.ticker];
    var px = data && data.price ? data.price : pos.entryPrice;
    var trade = paper.sell(poolId, entry.key, px, "Alert-only unwind — sector ETF is watch-only");
    if (trade) {
      flattened++;
      state.logEvent("ALERT_ONLY", pos.ticker + " flattened (sector ETFs are notifications only)", poolId);
    }
  });
  return flattened;
}

function isBelowStopMA(data) {
  if (!data || !data.levels) return false;
  var sma55 = data.levels.find(function (l) { return l.key === tickers.STOP_MA_KEY; });
  if (!sma55 || sma55.value == null) return false;
  var checkPrice = data.stopPrice != null ? data.stopPrice : data.price;
  if (checkPrice == null) return false;
  return checkPrice < sma55.value;
}

function processStopLosses(poolId, results) {
  var exits = 0;

  paper.getOpenPositions(poolId).forEach(function (entry) {
    var key = entry.key;
    var pos = entry.pos;
    var data = results[pos.ticker];
    if (!data || !data.levels) return;
    if (tickers.isAlertOnly(pos.ticker)) return;

    var sma55 = data.levels.find(function (l) { return l.key === tickers.STOP_MA_KEY; });
    if (!sma55 || sma55.value == null) return;

    var checkPrice = data.stopPrice != null ? data.stopPrice : data.price;
    if (checkPrice == null || checkPrice >= sma55.value) return;

    var trade = paper.sell(poolId, key, data.price, "Stop loss — daily close below 55-Day SMA ($" + sma55.value.toFixed(2) + ", close $" + checkPrice.toFixed(2) + ")");
    if (trade) {
      exits++;
      state.logEvent("STOP_LOSS", pos.ticker + " sold @ $" + data.price + " (daily close $" + checkPrice + " below 55 SMA $" + sma55.value.toFixed(2) + ")", poolId);
      discord.postStockExit(poolId, pos.ticker, pos.maLabel, data.price, trade.pnl, trade.pct, trade.reason, "stop").catch(function () {});
    }
  });

  return exits;
}

function processTakeProfits(poolId, results) {
  var tpExits = 0;

  paper.getOpenPositions(poolId).forEach(function (entry) {
    var key = entry.key;
    var pos = entry.pos;
    var data = results[pos.ticker];
    if (!data || !data.price || pos.entryPrice <= 0) return;
    if (tickers.isAlertOnly(pos.ticker)) return;

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

function processTicker(poolId, data, livePrices) {
  if (data.error || !data.price) return { alerts: 0, entries: 0 };

  var ticker = data.ticker;
  if (!state.isTickerEnabled(poolId, ticker)) return { alerts: 0, entries: 0 };

  var alerts = 0;
  var entries = 0;
  var alreadyInTicker = paper.hasAnyPosition(poolId, ticker);
  var belowStop = isBelowStopMA(data);

  data.levels.forEach(function (level) {
    if (!level.near || level.value == null) return;

    if (canAlert(poolId, ticker, level.key)) {
      markAlert(poolId, ticker, level.key);
      alerts++;
      state.logEvent("MA_NEAR", ticker + " within " + level.proximity_pct + "% of " + level.label + " ($" + level.value + ")", poolId);
      discord.postProximityAlert(poolId, ticker, data.price, level).catch(function () {});
    }

    if (alreadyInTicker) return;
    if (tickers.isAlertOnly(ticker)) return;
    if (belowStop) return;
    if (!paper.hasPosition(poolId, ticker, level.key)) {
      var riskUsd = paper.getPositionSizeUSD(poolId, livePrices);
      var shares = Math.floor(riskUsd / data.price);
      var trade = paper.buy(poolId, ticker, level.key, level.label, data.price, shares, "MA proximity entry", riskUsd);
      if (trade) {
        entries++;
        alreadyInTicker = true;
        state.logEvent("STOCK_BUY", ticker + " " + shares + "sh @ $" + data.price + " (" + level.label + ", " + riskUsd + " risk)", poolId);
        discord.postStockEntry(poolId, ticker, level.label, data.price, shares, trade.total, level.proximity_pct, riskUsd).catch(function () {});
      }
    }
  });

  return { alerts: alerts, entries: entries };
}

function collectNearHits(poolId, list, results) {
  var nearHits = [];
  list.forEach(function (t) {
    var data = results[t];
    if (!data || !data.levels) return;
    data.levels.filter(function (l) { return l.near; }).forEach(function (l) {
      nearHits.push({ poolId: poolId, ticker: t, level: l.label, proximity: l.proximity_pct, price: data.price });
    });
  });
  return nearHits;
}

function runPoolScan(poolId, allResults, marketOpen, opts) {
  opts = opts || {};
  var pool = pools.getPool(poolId);
  var list = pool.getTickers().filter(function (t) { return state.isTickerEnabled(poolId, t); });
  state.logEvent("SCAN", (opts.quotesOnly ? "Quotes-only scan " : "Scanning ") + list.length + " tickers…", poolId);

  var results = {};
  list.forEach(function (t) {
    if (allResults[t]) results[t] = allResults[t];
  });
  state.setScanResults(poolId, results);

  var livePrices = {};
  Object.values(results).forEach(function (r) {
    if (r && r.price) livePrices[r.ticker] = { price: r.price };
  });

  var totalExits = 0;
  var totalTakeProfits = 0;
  var totalAlerts = 0;
  var totalEntries = 0;
  var nearHits = collectNearHits(poolId, list, results);

  if (!opts.quotesOnly) {
    flattenAlertOnlyPositions(poolId, results);
    totalExits = processStopLosses(poolId, results);
    totalTakeProfits = processTakeProfits(poolId, results);

    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var data = results[t];
      if (!data) continue;
      var out = processTicker(poolId, data, livePrices);
      totalAlerts += out.alerts;
      totalEntries += out.entries;
    }
  }

  var equity = paper.getEquity(poolId, livePrices);
  state.logEvent("SCAN_DONE", totalAlerts + " alerts, " + totalEntries + " entries, " + totalExits + " stops, " + totalTakeProfits + " TPs", poolId);

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

async function runScan(force, opts) {
  opts = opts || {};
  if (scanning) return { skipped: true, reason: "scan in progress" };
  if (!force && !marketHours.isMarketHours()) {
    return { skipped: true, reason: "outside market hours" };
  }

  scanning = true;
  var start = Date.now();
  try {
    var marketOpen = marketHours.isMarketHours();
    var allTickers = [];
    var seen = {};
    pools.getAllPools().forEach(function (pool) {
      pool.getTickers().forEach(function (t) {
        if (!seen[t]) { seen[t] = true; allTickers.push(t); }
      });
    });

    var allResults = await indicators.fetchAllIndicators(
      allTickers,
      tickers.getYahooSymbol,
      marketOpen
    );

    var poolResults = await Promise.all(
      pools.getAllPools().map(function (pool) {
        return Promise.resolve(runPoolScan(pool.id, allResults, marketOpen, opts));
      })
    );

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

function startupScanForced() {
  return marketHours.isMarketHours();
}

function flattenAllAlertOnlyPositions() {
  var flattened = 0;
  pools.getAllPools().forEach(function (pool) {
    var s = state.getState(pool.id);
    flattened += flattenAlertOnlyPositions(pool.id, s.scanResults || {});
  });
  return flattened;
}

function scheduleScanner() {
  var intervalMin = parseInt(process.env.SCAN_INTERVAL_MIN || "30", 10);
  state.logEvent("SCAN", "Scanner scheduled every " + intervalMin + " min (all pools)");

  async function tick() {
    await runScan(false);
    setTimeout(tick, intervalMin * 60 * 1000);
  }

  setTimeout(function () {
    var force = startupScanForced();
    runScan(force).then(function (result) {
      if (!force && result && result.skipped) {
        state.logEvent("SCAN", "Startup scan skipped — outside market hours");
      }
      setTimeout(tick, intervalMin * 60 * 1000);
    });
  }, 5000);
}

module.exports = {
  runScan: runScan,
  scheduleScanner: scheduleScanner,
  startupScanForced: startupScanForced,
  isBelowStopMA: isBelowStopMA,
  flattenAllAlertOnlyPositions: flattenAllAlertOnlyPositions
};
