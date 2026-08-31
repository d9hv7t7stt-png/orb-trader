var yahoo = require("./yahoo");
var tickers = require("./tickers");

var CACHE_MS = parseInt(process.env.OPTIONS_CACHE_SEC || "3600", 10) * 1000;
var cache = {};

function ivRankFromChain(calls, puts, spot) {
  var ivs = [];
  [calls, puts].forEach(function (legs) {
    (legs || []).forEach(function (leg) {
      if (leg.impliedVolatility != null && leg.impliedVolatility > 0) {
        ivs.push(leg.impliedVolatility);
      }
    });
  });
  if (!ivs.length) return null;
  var atmIv = null;
  var bestDist = Infinity;
  [calls, puts].forEach(function (legs) {
    (legs || []).forEach(function (leg) {
      if (leg.impliedVolatility == null || !leg.strike) return;
      var dist = Math.abs(leg.strike - spot);
      if (dist < bestDist) {
        bestDist = dist;
        atmIv = leg.impliedVolatility;
      }
    });
  });
  if (atmIv == null) atmIv = ivs.reduce(function (a, b) { return a + b; }, 0) / ivs.length;
  var min = Math.min.apply(null, ivs);
  var max = Math.max.apply(null, ivs);
  var rank = max > min ? ((atmIv - min) / (max - min)) * 100 : 50;
  return {
    iv: parseFloat((atmIv * 100).toFixed(1)),
    ivRank: parseFloat(rank.toFixed(1))
  };
}

async function fetchOptionsOverlay(displayTicker, spotPrice) {
  if (spotPrice == null) return null;
  var key = displayTicker + ":" + Math.round(spotPrice);
  var cached = cache[key];
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  var yahooSymbol = tickers.getYahooSymbol(displayTicker);
  var path = "/v7/finance/options/" + encodeURIComponent(yahooSymbol);
  var payload = await yahoo.getJson("query2.finance.yahoo.com", path);
  var chain = payload && payload.optionChain && payload.optionChain.result;
  if (!chain || !chain[0]) return null;

  var result = chain[0];
  var options = result.options && result.options[0];
  if (!options) return null;

  var stats = ivRankFromChain(options.calls, options.puts, spotPrice);
  if (!stats) return null;

  var overlay = {
    ticker: displayTicker,
    iv: stats.iv,
    ivRank: stats.ivRank,
    expiry: options.expirationDate
      ? new Date(options.expirationDate * 1000).toISOString().slice(0, 10)
      : null,
    lowIv: stats.ivRank <= tickers.OPTIONS_IV_RANK_MAX
  };
  cache[key] = { data: overlay, ts: Date.now() };
  return overlay;
}

function isLowIvOverlay(overlay) {
  return !!(overlay && overlay.lowIv);
}

module.exports = {
  fetchOptionsOverlay: fetchOptionsOverlay,
  isLowIvOverlay: isLowIvOverlay,
  ivRankFromChain: ivRankFromChain
};
