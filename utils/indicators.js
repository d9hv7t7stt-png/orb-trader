var https = require("https");
var tickers = require("./tickers");

var CACHE_TTL_MS = parseInt(process.env.YAHOO_CACHE_SEC || "300", 10) * 1000;
var cache = {};

function cacheGet(ticker) {
  var hit = cache[ticker];
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    delete cache[ticker];
    return null;
  }
  return hit.data;
}

function cacheSet(ticker, data) {
  cache[ticker] = { data: data, ts: Date.now() };
}

function clearCache() {
  cache = {};
}

function yahooChart(symbol, interval, range) {
  return new Promise(function (resolve) {
    var path = "/v8/finance/chart/" + encodeURIComponent(symbol)
      + "?interval=" + interval + "&range=" + range;
    var options = {
      hostname: "query1.finance.yahoo.com",
      path: path,
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
    };
    var req = https.request(options, function (r) {
      var raw = "";
      r.on("data", function (c) { raw += c; });
      r.on("end", function () {
        try {
          if (r.statusCode && r.statusCode >= 400) return resolve(null);
          var parsed = JSON.parse(raw);
          var result = parsed.chart && parsed.chart.result && parsed.chart.result[0];
          if (!result) return resolve(null);
          var quotes = result.indicators && result.indicators.quote && result.indicators.quote[0];
          var closes = (quotes && quotes.close) || [];
          var timestamps = result.timestamp || [];
          var meta = result.meta || {};
          var bars = [];
          for (var i = 0; i < closes.length; i++) {
            if (closes[i] != null) {
              bars.push({ time: timestamps[i], close: closes[i] });
            }
          }
          resolve({
            bars: bars,
            price: meta.regularMarketPrice || meta.previousClose || (bars.length ? bars[bars.length - 1].close : null),
            symbol: symbol
          });
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on("error", function () { resolve(null); });
    req.setTimeout(15000, function () { req.destroy(); resolve(null); });
    req.end();
  });
}

function sma(values, period) {
  if (values.length < period) return null;
  var slice = values.slice(-period);
  return slice.reduce(function (a, b) { return a + b; }, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;
  var k = 2 / (period + 1);
  var emaVal = values.slice(0, period).reduce(function (a, b) { return a + b; }, 0) / period;
  for (var i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function computeMA(closes, level) {
  if (level.type === "sma") return sma(closes, level.period);
  return ema(closes, level.period);
}

function proximityPct(price, ma) {
  if (!price || !ma) return null;
  return Math.abs(price - ma) / ma;
}

function isNearMA(price, ma, threshold) {
  if (!price || !ma) return false;
  return proximityPct(price, ma) <= threshold;
}

function completedDailyClose(dailyBars, marketOpen) {
  if (!dailyBars.length) return null;
  if (marketOpen && dailyBars.length >= 2) {
    return dailyBars[dailyBars.length - 2].close;
  }
  return dailyBars[dailyBars.length - 1].close;
}

async function fetchTickerIndicators(displayTicker, resolveYahoo, marketOpen) {
  var cached = cacheGet(displayTicker);
  if (cached) return cached;

  var yahoo = resolveYahoo ? resolveYahoo(displayTicker) : tickers.getYahooSymbol(displayTicker);
  var daily = await yahooChart(yahoo, "1d", "2y");
  if (!daily || !daily.bars.length) {
    return { ticker: displayTicker, yahoo: yahoo, error: "no data", price: null, levels: [] };
  }

  var weekly = await yahooChart(yahoo, "1wk", "5y");
  var dailyCloses = daily.bars.map(function (b) { return b.close; });
  var price = daily.price || dailyCloses[dailyCloses.length - 1];
  var stopPrice = completedDailyClose(daily.bars, marketOpen);
  var weeklyCloses = weekly && weekly.bars.length
    ? weekly.bars.map(function (b) { return b.close; })
    : [];

  var levels = tickers.MA_LEVELS.map(function (level) {
    var closes = level.timeframe === "weekly" ? weeklyCloses : dailyCloses;
    var ma = computeMA(closes, level);
    var prox = proximityPct(price, ma);
    var near = isNearMA(price, ma, tickers.PROXIMITY_PCT);
    return {
      key: level.key,
      label: level.label,
      timeframe: level.timeframe,
      value: ma ? parseFloat(ma.toFixed(4)) : null,
      proximity_pct: prox != null ? parseFloat((prox * 100).toFixed(3)) : null,
      near: near,
      distance: ma ? parseFloat((price - ma).toFixed(4)) : null
    };
  });

  var result = {
    ticker: displayTicker,
    yahoo: yahoo,
    price: parseFloat(price.toFixed(4)),
    stopPrice: stopPrice != null ? parseFloat(stopPrice.toFixed(4)) : null,
    levels: levels,
    updated: new Date().toISOString()
  };
  cacheSet(displayTicker, result);
  return result;
}

async function fetchAllIndicators(tickerList, resolveYahoo, marketOpen) {
  var unique = [];
  var seen = {};
  tickerList.forEach(function (t) {
    if (!seen[t]) { seen[t] = true; unique.push(t); }
  });

  var batchSize = 4;
  var results = {};
  for (var i = 0; i < unique.length; i += batchSize) {
    var batch = unique.slice(i, i + batchSize);
    var batchResults = await Promise.all(batch.map(function (t) {
      return fetchTickerIndicators(t, resolveYahoo, marketOpen);
    }));
    batchResults.forEach(function (r) {
      results[r.ticker] = r;
    });
    if (i + batchSize < unique.length) {
      await new Promise(function (r) { setTimeout(r, 300); });
    }
  }
  return results;
}

module.exports = {
  fetchTickerIndicators: fetchTickerIndicators,
  fetchAllIndicators: fetchAllIndicators,
  isNearMA: isNearMA,
  proximityPct: proximityPct,
  clearCache: clearCache,
  yahooChart: yahooChart
};
