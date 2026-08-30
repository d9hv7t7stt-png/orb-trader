var DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
var pools = require("./pools");
var marketHours = require("./marketHours");

function poolTag(poolId) {
  var pool = pools.getPool(poolId);
  return pool ? "[" + pool.shortLabel + "] " : "";
}

function getPaperAccount(poolId) {
  poolId = poolId || "main";
  try {
    return require("./paper").getPortfolio(poolId);
  } catch (e) {
    var pool = pools.getPool(poolId) || pools.POOLS.main;
    return { cash: pool.startingBalance, startingBalance: pool.startingBalance, positions: {} };
  }
}

function accountFooter(poolId) {
  poolId = poolId || "main";
  var pool = pools.getPool(poolId) || pools.POOLS.main;
  var equity = getPaperAccount(poolId).cash;
  try {
    equity = require("./paper").getEquity(poolId, {});
  } catch (e) {}
  return "Argus Paper · " + pool.shortLabel + " · Equity " + formatMoney(equity);
}

async function httpPost(url, data) {
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify(data);
    var urlObj = new URL(url);
    var options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    };
    var req = require("https").request(options, function (res) {
      var raw = "";
      res.on("data", function (c) { raw += c; });
      res.on("end", function () {
        if (res.statusCode >= 400) {
          reject(new Error("Discord HTTP " + res.statusCode + ": " + raw.slice(0, 200)));
        } else {
          resolve(raw);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function sendDiscord(payload, roleType) {
  if (!DISCORD_WEBHOOK) return;
  try {
    var ping = rolePing(roleType);
    if (ping && !payload.content) payload.content = ping;
    else if (ping && payload.content) payload.content = ping + " " + payload.content;
    await httpPost(DISCORD_WEBHOOK, payload);
  } catch (err) {
    console.log("[DISCORD_ERROR]", err.message);
  }
}

function rolePing(type) {
  var map = {
    entry: process.env.DISCORD_ROLE_ENTRIES,
    stop: process.env.DISCORD_ROLE_STOPS,
    proximity: process.env.DISCORD_ROLE_PROXIMITY,
    daily: process.env.DISCORD_ROLE_DAILY,
    profit: process.env.DISCORD_ROLE_TAKEPROFIT
  };
  var id = map[type] || process.env.DISCORD_ROLE_ALERTS;
  if (!id) return null;
  return "<@&" + id + ">";
}

function formatMoney(n) {
  var abs = Math.abs(n);
  var str = "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? "-" + str : str;
}

function formatPct(n) {
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}

function scheduleDailySummary() {
  async function runAfterBell() {
    var stateMod = require("./state");
    var scannerMod = require("./scanner");
    await scannerMod.runScan(true);
    var livePricesByPool = {};
    pools.getAllPools().forEach(function (pool) {
      var s = stateMod.getState(pool.id);
      livePricesByPool[pool.id] = {};
      Object.values(s.scanResults || {}).forEach(function (r) {
        if (r && r.price) livePricesByPool[pool.id][r.ticker] = { price: r.price };
      });
    });
    await postStockDailySummary(livePricesByPool);
  }
  function scheduleNext() {
    setTimeout(async function () {
      await runAfterBell();
      scheduleNext();
    }, marketHours.msUntilAfterBell());
  }
  scheduleNext();
  console.log("[DISCORD] After-the-bell summary scheduled (4:05 PM ET — scan + P&L)");
}

async function postProximityAlert(poolId, ticker, price, level) {
  await sendDiscord({ embeds: [{
    color: 0x4da6ff,
    title: poolTag(poolId) + (require("./tickers").isAlertOnly(ticker) ? "📍 WATCH — " : "📍 MA PROXIMITY — ") + ticker,
    description: ticker + " is within **" + level.proximity_pct + "%** of **" + level.label + "**" +
      (require("./tickers").isAlertOnly(ticker) ? "\n*Watch only — sector ETFs are not paper-traded.*" : ""),
    fields: [
      { name: "Price", value: "$" + price.toFixed(2), inline: true },
      { name: "MA Level", value: "$" + level.value.toFixed(2), inline: true },
      { name: "Distance", value: formatPct((level.distance / level.value) * 100), inline: true }
    ],
    footer: { text: accountFooter(poolId) },
    timestamp: new Date().toISOString()
  }] }, "proximity");
}

async function postStockEntry(poolId, ticker, maLabel, price, shares, total, proximityPct, riskUsd) {
  await sendDiscord({ embeds: [{
    color: 0x00e5a0,
    title: poolTag(poolId) + "📈 STOCK BUY — " + ticker,
    fields: [
      { name: "Trigger", value: maLabel, inline: true },
      { name: "Shares", value: String(shares), inline: true },
      { name: "Price", value: "$" + price.toFixed(2), inline: true },
      { name: "Cost", value: formatMoney(total), inline: true },
      { name: "Risk Size", value: formatMoney(riskUsd) + " (2% equity)", inline: true },
      { name: "MA Proximity", value: proximityPct + "%", inline: true }
    ],
    footer: { text: accountFooter(poolId) },
    timestamp: new Date().toISOString()
  }] }, "entry");
}

async function postStockExit(poolId, ticker, maLabel, exitPrice, pnl, pct, reason, roleType) {
  var color = pnl >= 0 ? 0x00e5a0 : 0xff4d6a;
  await sendDiscord({ embeds: [{
    color: color,
    title: poolTag(poolId) + (pnl >= 0 ? "✅" : "🔴") + " STOCK SELL — " + ticker,
    fields: [
      { name: "Entry MA", value: maLabel, inline: true },
      { name: "Exit", value: "$" + exitPrice.toFixed(2), inline: true },
      { name: "P&L", value: formatMoney(pnl) + " (" + formatPct(pct) + ")", inline: true },
      { name: "Reason", value: reason, inline: false }
    ],
    footer: { text: accountFooter(poolId) },
    timestamp: new Date().toISOString()
  }] }, roleType || "stop");
}

async function postTakeProfit(poolId, ticker, maLabel, tierLabel, exitPrice, sharesSold, pnl, pct, remaining) {
  await sendDiscord({ embeds: [{
    color: 0xf5a623,
    title: poolTag(poolId) + "💰 TAKE PROFIT — " + ticker,
    fields: [
      { name: "Tier", value: tierLabel, inline: true },
      { name: "Sold", value: sharesSold + "sh @ $" + exitPrice.toFixed(2), inline: true },
      { name: "P&L", value: formatMoney(pnl) + " (" + formatPct(pct) + ")", inline: true },
      { name: "Entry MA", value: maLabel, inline: true },
      { name: "Remaining", value: remaining != null ? remaining + " shares" : "Closed", inline: true }
    ],
    footer: { text: accountFooter(poolId) },
    timestamp: new Date().toISOString()
  }] }, "profit");
}

async function postStockDailySummary(livePricesByPool) {
  var paperMod = require("./paper");
  var riskPct = (parseFloat(process.env.RISK_PCT || "2")).toFixed(0);
  var fields = [];
  var totalNet = 0;
  var totalEquity = 0;

  pools.getAllPools().forEach(function (pool) {
    var livePrices = (livePricesByPool && livePricesByPool[pool.id]) || {};
    var p = paperMod.getPortfolio(pool.id);
    var unreal = paperMod.getUnrealizedPnL(pool.id, livePrices);
    var pnlSum = paperMod.getPnlSummary(pool.id);
    var equity = paperMod.getEquity(pool.id, livePrices);
    var netPnl = equity - p.startingBalance;
    totalNet += netPnl;
    totalEquity += equity;

    var closedToday = p.trades.filter(function (t) {
      return t.type === "sell" && new Date(t.time).toDateString() === new Date().toDateString();
    });
    var tradeLines = closedToday.map(function (t) {
      var e = t.pnl >= 0 ? "✅" : "🔴";
      return e + " " + t.ticker + ": " + formatMoney(t.pnl) + " (" + formatPct(t.pct) + ") — " + t.reason;
    }).join("\n") || "No closed trades today";

    var openLines = Object.values(p.positions).map(function (pos) {
      var px = livePrices[pos.ticker] ? livePrices[pos.ticker].price : pos.entryPrice;
      var u = (px - pos.entryPrice) * pos.shares;
      return "• " + pos.ticker + " (" + pos.maLabel + ") " + pos.shares + "sh · uP&L " + formatMoney(u);
    }).join("\n") || "No open positions";

    fields.push(
      { name: pool.shortLabel + " — Equity", value: formatMoney(equity), inline: true },
      { name: pool.shortLabel + " — Cash", value: formatMoney(p.cash), inline: true },
      { name: pool.shortLabel + " — Unrealized", value: formatMoney(unreal.total), inline: true },
      { name: pool.shortLabel + " — Realized Today", value: pnlSum.daily != null ? formatMoney(pnlSum.daily) : "—", inline: true },
      { name: pool.shortLabel + " — Net P&L", value: formatMoney(netPnl), inline: true },
      { name: pool.shortLabel + " — W / L", value: p.wins + " / " + p.losses, inline: true },
      { name: pool.shortLabel + " — Closed Today", value: tradeLines.slice(0, 1000), inline: false },
      { name: pool.shortLabel + " — Open Positions", value: openLines.slice(0, 1000), inline: false },
      { name: pool.shortLabel + " — Next Entry", value: formatMoney(paperMod.getPositionSizeUSD(pool.id, livePrices)) + " (" + riskPct + "% equity)", inline: false }
    );
  });

  var color = totalNet >= 0 ? 0x00e5a0 : 0xff4d6a;

  await sendDiscord({ embeds: [{
    color: color,
    title: "🔔 AFTER THE BELL — Position summary · " + new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    description: "One message, both pools. Combined equity " + formatMoney(totalEquity) + " · Combined net P&L " + formatMoney(totalNet),
    fields: fields,
    footer: { text: "Argus Paper · Main $50K + Space DC $108K · Stop: daily close < 55 SMA · TP: +10/+20/+30%" },
    timestamp: new Date().toISOString()
  }] }, "daily");
}

module.exports = {
  scheduleDailySummary: scheduleDailySummary,
  postProximityAlert: postProximityAlert,
  postStockEntry: postStockEntry,
  postStockExit: postStockExit,
  postTakeProfit: postTakeProfit,
  postStockDailySummary: postStockDailySummary
};
