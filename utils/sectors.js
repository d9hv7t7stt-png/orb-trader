var indicators = require("./indicators");
var tickers = require("./tickers");

var CACHE_MS = parseInt(process.env.SECTOR_CACHE_SEC || "600", 10) * 1000;
var cache = null;

function returnPct(closes, days) {
  if (!closes || closes.length < days + 1) return null;
  var last = closes[closes.length - 1];
  var prev = closes[closes.length - 1 - days];
  if (!last || !prev) return null;
  return ((last - prev) / prev) * 100;
}

function relStrength(closes, spyCloses, days) {
  var r = returnPct(closes, days);
  var s = returnPct(spyCloses, days);
  if (r == null || s == null) return null;
  return r - s;
}

async function fetchSectorRanks() {
  if (cache && Date.now() - cache.ts < CACHE_MS) return cache.data;

  var spyChart = await indicators.yahooChart("SPY", "1d", "3mo");
  if (!spyChart || !spyChart.bars.length) return { ok: false, sectors: [] };

  var spyCloses = spyChart.bars.map(function (b) { return b.close; });
  var weekSpy = returnPct(spyCloses, 5);
  var monthSpy = returnPct(spyCloses, 20);

  var sectors = [];
  var list = tickers.SECTOR_SPDR.slice();

  for (var i = 0; i < list.length; i++) {
    var sym = list[i];
    var chart = await indicators.yahooChart(sym, "1d", "3mo");
    if (!chart || !chart.bars.length) continue;
    var closes = chart.bars.map(function (b) { return b.close; });
    var weekRet = returnPct(closes, 5);
    var monthRet = returnPct(closes, 20);
    var weekRs = relStrength(closes, spyCloses, 5);
    var monthRs = relStrength(closes, spyCloses, 20);
    sectors.push({
      ticker: sym,
      name: tickers.getDisplayName(sym),
      weekReturn: weekRet != null ? parseFloat(weekRet.toFixed(2)) : null,
      monthReturn: monthRet != null ? parseFloat(monthRet.toFixed(2)) : null,
      weekRs: weekRs != null ? parseFloat(weekRs.toFixed(2)) : null,
      monthRs: monthRs != null ? parseFloat(monthRs.toFixed(2)) : null,
      price: chart.price || closes[closes.length - 1]
    });
    if (i + 1 < list.length) {
      await new Promise(function (r) { setTimeout(r, 120); });
    }
  }

  sectors.sort(function (a, b) {
    var aw = a.weekRs != null ? a.weekRs : -999;
    var bw = b.weekRs != null ? b.weekRs : -999;
    return bw - aw;
  });

  sectors.forEach(function (s, idx) {
    s.weekRank = idx + 1;
  });

  sectors.sort(function (a, b) {
    var am = a.monthRs != null ? a.monthRs : -999;
    var bm = b.monthRs != null ? b.monthRs : -999;
    return bm - am;
  });

  sectors.forEach(function (s, idx) {
    s.monthRank = idx + 1;
  });

  var byWeek = sectors.slice().sort(function (a, b) { return a.weekRank - b.weekRank; });

  var data = {
    ok: true,
    spyWeekReturn: weekSpy != null ? parseFloat(weekSpy.toFixed(2)) : null,
    spyMonthReturn: monthSpy != null ? parseFloat(monthSpy.toFixed(2)) : null,
    sectors: byWeek,
    leadersWeek: byWeek.slice(0, 3).map(function (s) { return s.ticker; }),
    laggardsWeek: byWeek.slice(-3).reverse().map(function (s) { return s.ticker; }),
    updated: new Date().toISOString()
  };

  cache = { data: data, ts: Date.now() };
  return data;
}

function formatSectorRankLines(ranks, mode) {
  mode = mode || "week";
  if (!ranks || !ranks.sectors || !ranks.sectors.length) return "Sector data unavailable";
  var spyLine = "SPY " + (mode === "week" ? ranks.spyWeekReturn : ranks.spyMonthReturn);
  if (spyLine.indexOf("null") === -1) spyLine += "%";
  var lines = [mode === "week" ? "**This week vs SPY**" : "**This month vs SPY**", "Benchmark: " + spyLine];
  ranks.sectors.forEach(function (s) {
    var rs = mode === "week" ? s.weekRs : s.monthRs;
    var ret = mode === "week" ? s.weekReturn : s.monthReturn;
    if (rs == null) return;
    var rank = mode === "week" ? s.weekRank : s.monthRank;
    var arrow = rs >= 0 ? "▲" : "▼";
    lines.push("#" + rank + " **" + s.ticker + "** " + arrow + " RS " + (rs >= 0 ? "+" : "") + rs.toFixed(2) + "% · " + (ret >= 0 ? "+" : "") + ret.toFixed(2) + "%");
  });
  if (ranks.leadersWeek && ranks.leadersWeek.length && mode === "week") {
    lines.push("\n**Leading:** " + ranks.leadersWeek.join(", "));
    lines.push("**Weakest:** " + ranks.laggardsWeek.join(", "));
  }
  return lines.join("\n");
}

module.exports = {
  fetchSectorRanks: fetchSectorRanks,
  formatSectorRankLines: formatSectorRankLines,
  returnPct: returnPct,
  relStrength: relStrength
};
