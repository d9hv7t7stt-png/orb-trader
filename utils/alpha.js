var tickers = require("./tickers");
var themes = require("./themes");

var REGIME_TICKERS = (process.env.REGIME_TICKERS || "SPY,QQQ").split(",").map(function (s) {
  return s.trim().toUpperCase();
}).filter(Boolean);
var REGIME_MA_KEY = process.env.REGIME_MA_KEY || "d_sma200";
var RS_MIN_PERCENTILE = parseFloat(process.env.RS_MIN_PERCENTILE || "50");
var SETUP_SCORE_MIN = parseInt(process.env.SETUP_SCORE_MIN || "55", 10);

function levelAt(data, key) {
  if (!data || !data.levels) return null;
  return data.levels.find(function (l) { return l.key === key; }) || null;
}

function isAboveMA(data, key) {
  var lvl = levelAt(data, key);
  if (!lvl || lvl.value == null || data.price == null) return false;
  return data.price > lvl.value;
}

function isRegimeBullish(allResults) {
  allResults = allResults || {};
  for (var i = 0; i < REGIME_TICKERS.length; i++) {
    var t = REGIME_TICKERS[i];
    var data = allResults[t];
    if (!data || data.error || !data.price) return false;
    if (!isAboveMA(data, REGIME_MA_KEY)) return false;
  }
  return true;
}

function pctChange(closes, days) {
  if (!closes || closes.length < days + 1) return null;
  var last = closes[closes.length - 1];
  var prev = closes[closes.length - 1 - days];
  if (!last || !prev) return null;
  return ((last - prev) / prev) * 100;
}

function returnRel(closes, spyCloses, days) {
  if (!closes || !spyCloses) return null;
  if (closes.length < days + 1 || spyCloses.length < days + 1) return null;
  var r = pctChange(closes, days);
  var s = pctChange(spyCloses, days);
  if (r == null || s == null) return null;
  return parseFloat((r - s).toFixed(2));
}

function enrichRelativeStrength(allResults, spyBars) {
  if (!spyBars || !spyBars.length) return;
  var spyCloses = spyBars.map(function (b) { return b.close; });
  Object.keys(allResults).forEach(function (t) {
    var data = allResults[t];
    if (!data || data.error || tickers.isAlertOnly(t)) return;
    if (!data._closes || data._closes.length < 21) return;
    data.rs20 = returnRel(data._closes, spyCloses, 20);
    data.rs60 = returnRel(data._closes, spyCloses, 60);
    delete data._closes;
  });
}

function buildRsRanks(allResults, poolTickers) {
  var rows = [];
  poolTickers.forEach(function (t) {
    var data = allResults[t];
    if (!data || tickers.isAlertOnly(t) || data.rs20 == null) return;
    var score = data.rs60 != null ? (data.rs20 + data.rs60) / 2 : data.rs20;
    rows.push({ ticker: t, rs20: data.rs20, rs60: data.rs60, score: score });
  });
  rows.sort(function (a, b) { return b.score - a.score; });
  var total = rows.length;
  rows.forEach(function (r, i) {
    r.rank = i + 1;
    r.percentile = total > 1 ? parseFloat(((1 - i / (total - 1)) * 100).toFixed(1)) : 100;
  });
  var map = {};
  rows.forEach(function (r) { map[r.ticker] = r; });
  return { rows: rows, byTicker: map, total: total };
}

function passesRsGate(rsInfo) {
  if (!rsInfo) return false;
  return rsInfo.percentile >= RS_MIN_PERCENTILE;
}

function computeSetupScore(data, ctx) {
  ctx = ctx || {};
  var score = 0;
  var parts = [];

  if (levelAt(data, tickers.ENTRY_MA_KEY) && levelAt(data, tickers.ENTRY_MA_KEY).near) {
    score += 25;
    parts.push("21D near");
  }
  if (isAboveMA(data, tickers.STOP_MA_KEY)) {
    score += 15;
    parts.push(">55D");
  }
  if (isAboveMA(data, REGIME_MA_KEY)) {
    score += 10;
    parts.push(">200D");
  }
  if (ctx.regimeBullish) {
    score += 10;
    parts.push("regime OK");
  }
  if (ctx.rsInfo && passesRsGate(ctx.rsInfo)) {
    score += ctx.rsInfo.percentile >= 75 ? 15 : 10;
    parts.push("RS #" + ctx.rsInfo.rank);
  }
  if (data.daysToEarnings == null || data.daysToEarnings > tickers.EARNINGS_BLACKOUT_DAYS || data.daysToEarnings < 0) {
    score += 5;
    parts.push("no earn blackout");
  }
  if (ctx.vix && !ctx.vix.blockEntries) {
    score += Math.round(10 * (ctx.vix.riskMult || 0));
    parts.push("VIX " + (ctx.vix.zone || ""));
  }
  if (ctx.themeOk !== false) {
    score += 5;
    parts.push("theme slot");
  }

  return {
    score: Math.min(100, score),
    parts: parts,
    tradeable: score >= SETUP_SCORE_MIN && ctx.regimeBullish && (!ctx.vix || !ctx.vix.blockEntries) && ctx.themeOk !== false && passesRsGate(ctx.rsInfo)
  };
}

module.exports = {
  REGIME_TICKERS: REGIME_TICKERS,
  REGIME_MA_KEY: REGIME_MA_KEY,
  SETUP_SCORE_MIN: SETUP_SCORE_MIN,
  RS_MIN_PERCENTILE: RS_MIN_PERCENTILE,
  isRegimeBullish: isRegimeBullish,
  isAboveMA: isAboveMA,
  enrichRelativeStrength: enrichRelativeStrength,
  buildRsRanks: buildRsRanks,
  passesRsGate: passesRsGate,
  computeSetupScore: computeSetupScore,
  getTheme: themes.getTheme
};
