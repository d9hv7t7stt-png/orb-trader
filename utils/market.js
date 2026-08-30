var https = require("https");
var fs = require("fs");

var TICKER_MAP = { SPY: "SPY", IWM: "IWM", QQQ: "QQQ", SPXW: "^GSPC", SPX: "^GSPC" };

function fetchYahooPrice(symbol) {
  return new Promise(function (resolve) {
    var options = {
      hostname: "query1.finance.yahoo.com",
      path: "/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=1d",
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
    };
    var req = https.request(options, function (r) {
      var raw = "";
      r.on("data", function (c) { raw += c; });
      r.on("end", function () {
        try {
          var parsed = JSON.parse(raw);
          var meta = parsed.chart && parsed.chart.result && parsed.chart.result[0] && parsed.chart.result[0].meta;
          var price = meta ? (meta.regularMarketPrice || meta.previousClose || null) : null;
          var prev = meta ? (meta.chartPreviousClose || meta.previousClose || null) : null;
          var change = (price != null && prev != null) ? price - prev : null;
          var changePct = (change != null && prev) ? (change / prev) * 100 : null;
          resolve({ price: price, prev_close: prev, change: change, change_pct: changePct });
        } catch (e) {
          resolve({ price: null, prev_close: null, change: null, change_pct: null });
        }
      });
    });
    req.on("error", function () {
      resolve({ price: null, prev_close: null, change: null, change_pct: null });
    });
    req.end();
  });
}

async function fetchPrices() {
  var entries = Object.entries(TICKER_MAP);
  var results = await Promise.all(entries.map(function (pair) {
    return fetchYahooPrice(pair[1]).then(function (data) {
      return [pair[0], data];
    });
  }));
  return Object.fromEntries(results);
}

function getPnlSummary() {
  try {
    var pnlFile = "/tmp/swing-pnl.json";
    if (!fs.existsSync(pnlFile)) {
      return { daily: null, weekly: null, monthly: null, yearly: null };
    }
    var data = JSON.parse(fs.readFileSync(pnlFile, "utf8"));
    var now = new Date();
    var daily = 0;
    var weekly = 0;
    var monthly = 0;
    var yearly = 0;
    var hasData = false;
    (data.trades || []).forEach(function (t) {
      var d = new Date(t.time);
      var pnl = parseFloat(t.pnl) || 0;
      if (d.toDateString() === now.toDateString()) { daily += pnl; hasData = true; }
      var weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      if (d >= weekAgo) { weekly += pnl; hasData = true; }
      var monthAgo = new Date(now);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      if (d >= monthAgo) { monthly += pnl; hasData = true; }
      var yearAgo = new Date(now);
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      if (d >= yearAgo) { yearly += pnl; hasData = true; }
    });
    return hasData ? { daily: daily, weekly: weekly, monthly: monthly, yearly: yearly } : { daily: null, weekly: null, monthly: null, yearly: null };
  } catch (e) {
    return { daily: null, weekly: null, monthly: null, yearly: null };
  }
}

module.exports = { fetchPrices: fetchPrices, getPnlSummary: getPnlSummary };
