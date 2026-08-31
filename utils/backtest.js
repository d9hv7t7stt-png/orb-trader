var indicators = require("./indicators");
var tickers = require("./tickers");
var pools = require("./pools");

function levelAt(data, key) {
  if (!data || !data.levels) return null;
  return data.levels.find(function (l) { return l.key === key; }) || null;
}

function simulateTicker(ticker, dailyBars, weeklyBars, startIdx, endIdx) {
  var position = null;
  var trades = [];
  var realized = 0;

  for (var i = Math.max(startIdx, 55); i <= endIdx; i++) {
    var data = indicators.buildIndicatorsFromBars(ticker, dailyBars, weeklyBars, i, false);
    if (!data || data.price == null) continue;

    var sma55 = levelAt(data, tickers.STOP_MA_KEY);
    var ema21 = levelAt(data, tickers.ENTRY_MA_KEY);
    var checkPrice = data.stopPrice != null ? data.stopPrice : data.price;

    if (position) {
      var gainPct = ((data.price - position.entryPrice) / position.entryPrice) * 100;

      if (sma55 && sma55.value != null && checkPrice < sma55.value) {
        var stopPnl = data.price - position.entryPrice;
        realized += stopPnl;
        trades.push({ type: "sell", ticker: ticker, price: data.price, pnl: stopPnl, reason: "55 SMA stop", day: i });
        position = null;
        continue;
      }

      if (gainPct >= tickers.TAKE_PROFIT_TIERS[tickers.TAKE_PROFIT_TIERS.length - 1].pct) {
        var tpPnl = data.price - position.entryPrice;
        realized += tpPnl;
        trades.push({ type: "sell", ticker: ticker, price: data.price, pnl: tpPnl, reason: "take profit", day: i });
        position = null;
        continue;
      }
    }

    if (!position && ema21 && ema21.near && sma55 && sma55.value != null && data.price > sma55.value) {
      position = { entryPrice: data.price, day: i };
      trades.push({ type: "buy", ticker: ticker, price: data.price, reason: "21D near + above 55D", day: i });
    }
  }

  if (position && endIdx >= 0) {
    var last = indicators.buildIndicatorsFromBars(ticker, dailyBars, weeklyBars, endIdx, false);
    if (last && last.price != null) {
      var openPnl = last.price - position.entryPrice;
      trades.push({ type: "mark", ticker: ticker, price: last.price, pnl: openPnl, reason: "open at end", day: endIdx });
    }
  }

  var sells = trades.filter(function (t) { return t.type === "sell"; });
  return {
    ticker: ticker,
    trades: trades.length,
    closed: sells.length,
    realized: parseFloat(realized.toFixed(2)),
    wins: sells.filter(function (t) { return t.pnl >= 0; }).length,
    losses: sells.filter(function (t) { return t.pnl < 0; }).length
  };
}

async function runBacktest(opts) {
  opts = opts || {};
  var poolId = opts.poolId || "main";
  var days = parseInt(opts.days || process.env.BACKTEST_DAYS || "90", 10);
  if (days < 30) days = 30;
  if (days > 365) days = 365;

  var pool = pools.getPool(poolId);
  if (!pool) return { ok: false, error: "invalid pool" };

  var list = (opts.tickers || pool.getTickers()).filter(function (t) {
    return !tickers.isAlertOnly(t);
  });

  var period2 = Math.floor(Date.now() / 1000);
  var period1 = period2 - (days + 280) * 86400;
  var results = [];
  var errors = [];

  for (var ti = 0; ti < list.length; ti++) {
    var ticker = list[ti];
    try {
      var yahoo = tickers.getYahooSymbol(ticker);
      var dailyPack = await indicators.yahooChartPeriod(yahoo, "1d", period1, period2);
      var weeklyPack = await indicators.yahooChartPeriod(yahoo, "1wk", period1, period2);
      if (!dailyPack || !dailyPack.bars.length) {
        errors.push({ ticker: ticker, error: "no daily bars" });
        continue;
      }
      var endIdx = dailyPack.bars.length - 1;
      var startIdx = Math.max(55, endIdx - days);
      results.push(simulateTicker(ticker, dailyPack.bars, (weeklyPack && weeklyPack.bars) || [], startIdx, endIdx));
    } catch (e) {
      errors.push({ ticker: ticker, error: e.message });
    }
    if (ti + 1 < list.length) {
      await new Promise(function (r) { setTimeout(r, 200); });
    }
  }

  var totalRealized = results.reduce(function (s, r) { return s + r.realized; }, 0);
  var totalClosed = results.reduce(function (s, r) { return s + r.closed; }, 0);
  var totalWins = results.reduce(function (s, r) { return s + r.wins; }, 0);

  return {
    ok: true,
    poolId: poolId,
    days: days,
    tickers: list.length,
    strategy: "21D proximity entry when price above 55D · stop on daily close below 55D · TP at +30%",
    summary: {
      realized: parseFloat(totalRealized.toFixed(2)),
      closedTrades: totalClosed,
      wins: totalWins,
      losses: totalClosed - totalWins
    },
    results: results.sort(function (a, b) { return b.realized - a.realized; }),
    errors: errors
  };
}

module.exports = {
  runBacktest: runBacktest,
  simulateTicker: simulateTicker
};
