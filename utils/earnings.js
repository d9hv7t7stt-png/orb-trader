var yahoo = require("./yahoo");
var tickers = require("./tickers");

var CACHE_MS = parseInt(process.env.EARNINGS_CACHE_SEC || "86400", 10) * 1000;
var cache = {};

function daysUntil(date) {
  if (!date) return null;
  var now = new Date();
  var ms = date.getTime() - now.getTime();
  return Math.ceil(ms / 86400000);
}

function parseEarningsDates(payload) {
  var result = payload && payload.quoteSummary && payload.quoteSummary.result;
  if (!result || !result[0]) return null;
  var cal = result[0].calendarEvents;
  if (!cal || !cal.earnings) return null;
  var dates = cal.earnings.earningsDate || cal.earnings.earningsDateRaw;
  if (!dates) return null;
  if (!Array.isArray(dates)) dates = [dates];
  var parsed = dates.map(function (d) {
    if (typeof d === "number") return new Date(d * 1000);
    if (d && d.raw) return new Date(d.raw * 1000);
    if (d && d.fmt) return new Date(d.fmt);
    return null;
  }).filter(Boolean);
  if (!parsed.length) return null;
  parsed.sort(function (a, b) { return a - b; });
  var upcoming = parsed.find(function (d) { return d.getTime() >= Date.now() - 86400000; });
  return upcoming || parsed[parsed.length - 1];
}

async function fetchEarningsInfo(displayTicker) {
  var cached = cache[displayTicker];
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  var yahooSymbol = tickers.getYahooSymbol(displayTicker);
  var path = "/v10/finance/quoteSummary/" + encodeURIComponent(yahooSymbol)
    + "?modules=calendarEvents";
  var payload = await yahoo.getJson("query2.finance.yahoo.com", path);
  var nextDate = parseEarningsDates(payload);
  var info = {
    ticker: displayTicker,
    earningsDate: nextDate ? nextDate.toISOString().slice(0, 10) : null,
    daysToEarnings: nextDate ? daysUntil(nextDate) : null
  };
  cache[displayTicker] = { data: info, ts: Date.now() };
  return info;
}

function isEarningsBlackout(info) {
  if (!info || info.daysToEarnings == null) return false;
  var d = parseInt(info.daysToEarnings, 10);
  return d >= 0 && d <= tickers.EARNINGS_BLACKOUT_DAYS;
}

module.exports = {
  fetchEarningsInfo: fetchEarningsInfo,
  isEarningsBlackout: isEarningsBlackout,
  daysUntil: daysUntil
};
