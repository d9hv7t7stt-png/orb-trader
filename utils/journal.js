var paper = require("./paper");
var pools = require("./pools");

function tradesInRange(poolId, sinceMs, untilMs) {
  var p = paper.getPortfolio(poolId);
  return (p.trades || []).filter(function (t) {
    var ts = new Date(t.time).getTime();
    return ts >= sinceMs && ts <= untilMs;
  });
}

function summarizeTrades(trades) {
  var buys = 0;
  var sells = trades.filter(function (t) { return t.type === "sell"; });
  trades.forEach(function (t) { if (t.type === "buy") buys++; });
  var realized = sells.reduce(function (s, t) { return s + (t.pnl || 0); }, 0);
  var wins = sells.filter(function (t) { return (t.pnl || 0) >= 0; }).length;
  var losses = sells.length - wins;
  return {
    buys: buys,
    sells: sells.length,
    wins: wins,
    losses: losses,
    realized: parseFloat(realized.toFixed(2))
  };
}

function weeklyJournal(poolId, now) {
  now = now || new Date();
  var end = now.getTime();
  var start = end - 7 * 86400000;
  var trades = tradesInRange(poolId, start, end);
  var summary = summarizeTrades(trades);
  var sellLines = trades.filter(function (t) { return t.type === "sell"; }).slice(0, 20).map(function (t) {
    var sign = (t.pnl || 0) >= 0 ? "+" : "";
    return "• " + t.ticker + " " + sign + "$" + Math.abs(t.pnl || 0).toFixed(2)
      + " (" + (t.pct != null ? ((t.pct >= 0 ? "+" : "") + t.pct.toFixed(1) + "%") : "—") + ") — " + (t.reason || "");
  });
  return {
    poolId: poolId,
    poolLabel: pools.getPool(poolId).shortLabel,
    periodStart: new Date(start).toISOString(),
    periodEnd: new Date(end).toISOString(),
    summary: summary,
    closedLines: sellLines
  };
}

function allPoolsWeeklyJournal(now) {
  return pools.getAllPools().map(function (pool) {
    return weeklyJournal(pool.id, now);
  });
}

function formatWeeklyJournalText(journals) {
  return journals.map(function (j) {
    var s = j.summary;
    var header = "**" + j.poolLabel + "** — " + s.sells + " closed · W/L " + s.wins + "/" + s.losses
      + " · Realized $" + s.realized.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var body = j.closedLines.length ? j.closedLines.join("\n") : "No closed trades this week";
    return header + "\n" + body;
  }).join("\n\n");
}

module.exports = {
  tradesInRange: tradesInRange,
  summarizeTrades: summarizeTrades,
  weeklyJournal: weeklyJournal,
  allPoolsWeeklyJournal: allPoolsWeeklyJournal,
  formatWeeklyJournalText: formatWeeklyJournalText
};
