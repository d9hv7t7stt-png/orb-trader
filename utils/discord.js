var DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
var pools = require("./pools");

function poolTag(poolId) {
  return "[" + pools.getPool(poolId).shortLabel + "] ";
}

function getPaperAccount(poolId) {
  poolId = poolId || "main";
  try {
    return require("./paper").getPortfolio(poolId);
  } catch (e) {
    var pool = pools.getPool(poolId);
    return { cash: pool.startingBalance, startingBalance: pool.startingBalance, positions: {} };
  }
}

function accountFooter(poolId) {
  poolId = poolId || "main";
  var p = getPaperAccount(poolId);
  var equity = p.cash;
  try {
    equity = require("./paper").getEquity(poolId, {});
  } catch (e) {}
  var pool = pools.getPool(poolId);
  return "Argus Paper · " + pool.shortLabel + " · Equity " + formatMoney(equity);
}

async function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    };
    const req = require("https").request(options, (res) => {
      let raw = ""; res.on("data", c => raw += c); res.on("end", () => resolve(raw));
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

async function sendDiscord(payload, roleType) {
  if (!DISCORD_WEBHOOK) return;
  try {
    var ping = rolePing(roleType);
    if (ping && !payload.content) payload.content = ping;
    else if (ping && payload.content) payload.content = ping + " " + payload.content;
    await httpPost(DISCORD_WEBHOOK, payload);
  } catch(err) {
    console.log("[DISCORD_ERROR]", err.message);
  }
}

// Role pings — set role IDs in Railway (Developer Mode → right-click role → Copy ID)
// Example setup:
//   DISCORD_ROLE_ENTRIES=1234567890   → @Traders role on every paper buy
//   DISCORD_ROLE_STOPS=1234567891     → @Risk role on stop-loss exits
//   DISCORD_ROLE_PROXIMITY=1234567892 → @Alerts role on MA proximity (optional, can be noisy)
//   DISCORD_ROLE_DAILY=1234567893     → @Daily role on after-the-bell P&L summary
//   DISCORD_ROLE_TAKEPROFIT=1234567894 → @Profits role on take-profit partial/full exits
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

// Legacy options tracking (unused in paper stock mode)
var accountState = {
  balance: parseFloat(process.env.PAPER_BALANCE || "50000"),
  startingBalance: parseFloat(process.env.PAPER_BALANCE || "50000"),
  positions: {},
  dailyTrades: [],
  wins: 0,
  losses: 0
};

function formatMoney(n) {
  var abs = Math.abs(n);
  var str = "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? "-" + str : str;
}

function formatPct(n) {
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}

// ── Market open messages ──────────────────────────────────────────────────────
async function postGoodMorning(minutesBefore) {
  var messages = {
    45: {
      color: 0x4da6ff,
      title: "👁️ 45 Minutes to Open — Argus Pre-Market Check",
      description: "Morning rundown incoming. Reviewing all open swing positions before the bell. Stay sharp — the trend is your edge. 📋",
      footer: "Not financial advice. Options trading involves significant risk of loss."
    },
    20: {
      color: 0xf5c518,
      title: "🌊 20 Minutes — Argus Is Scanning",
      description: "Swing setups are loading. The market tells its story one candle at a time — Argus reads every word.\nStay patient. The best trades find you. 👁️",
      footer: "Not financial advice. Options trading involves significant risk of loss."
    },
    5: {
      color: 0xff8c00,
      title: "⚡ 5 Minutes — Argus Is Ready",
      description: "Swing traders don't chase. They wait, they strike, and they let winners run.\nToday is no different. 📊",
      footer: "Not financial advice. Trade at your own risk."
    },
    1: {
      color: 0xff4d6a,
      title: "🚨 BELL IN 60 SECONDS — ARGUS IS HUNTING",
      description: "The hunt begins. Momentum builds in one direction — Argus will find it.\nNo emotion. No hesitation. Pure execution. 🔥",
      footer: "Not financial advice. Options trading carries substantial risk of loss."
    }
  };

  var msg = messages[minutesBefore];
  if (!msg || !DISCORD_WEBHOOK) return;

  await sendDiscord({
    content: "@everyone",
    embeds: [{
      color: msg.color,
      title: msg.title,
      description: msg.description,
      footer: { text: msg.footer },
      timestamp: new Date().toISOString()
    }]
  });
  console.log("[DISCORD] Morning message sent (" + minutesBefore + " min)");

  // After 45-min message, also post open positions
  if (minutesBefore === 45) {
    await postOpenPositions("Pre-Market 45 Min");
  }
}

async function postOpenPositions(label) {
  var positions = Object.entries(accountState.positions).filter(function(e) { return e[1] && !e[1].stopped; });
  if (positions.length === 0) return; // no open positions, skip

  var fields = positions.map(function(e) {
    var ticker = e[0]; var pos = e[1];
    // Estimate current price from last known option price (stored on entry)
    var currentEst = pos.lastKnownPrice || pos.entryPrice;
    var pnl = (currentEst - pos.entryPrice) * pos.contracts * 100;
    var pct = pos.entryPrice > 0 ? ((currentEst - pos.entryPrice) / pos.entryPrice * 100).toFixed(1) : "0.0";
    var pnlStr = (pnl >= 0 ? "+" : "") + "$" + Math.abs(pnl).toLocaleString("en-US", {minimumFractionDigits:2,maximumFractionDigits:2});
    return {
      name: ticker + " " + pos.side.toUpperCase(),
      value: "Entry: $" + pos.entryPrice.toFixed(2) + "\nCurrent: $" + currentEst.toFixed(2) + "\nP&L: " + pnlStr + " (" + (pnl >= 0 ? "+" : "") + pct + "%)\nContracts: " + pos.contracts + "\nStrike: $" + (pos.strike || "-") + " - Exp: " + (pos.expiry || "-"),
      inline: true
    };
  });

  await sendDiscord({ embeds: [{
    color: 0x4da6ff,
    title: "📋 " + label + " — Open Positions",
    fields: fields,
    footer: { text: accountFooter() },
    timestamp: new Date().toISOString()
  }]});
}

// Called from alert handler to keep lastKnownPrice updated
function updateLastKnownPrice(ticker, optionPrice) {
  if (accountState.positions[ticker] && optionPrice) {
    accountState.positions[ticker].lastKnownPrice = optionPrice;
  }
}

// Every 30 minutes during market hours (9:30 AM - 4:00 PM ET)
function schedulePositionUpdates() {
  function isMarketHours() {
    var now = new Date();
    var utcH = now.getUTCHours();
    var utcM = now.getUTCMinutes();
    var utcTotal = utcH * 60 + utcM;
    return utcTotal >= 13*60+30 && utcTotal <= 20*60; // 9:30 AM - 4:00 PM ET
  }
  function msUntilNext30() {
    var now = new Date();
    var next = new Date(now);
    var m = now.getUTCMinutes();
    var addMin = m < 30 ? (30 - m) : (60 - m);
    next.setUTCMinutes(now.getUTCMinutes() + addMin, 0, 0);
    return next - now;
  }
  function scheduleNext() {
    setTimeout(async function() {
      if (isMarketHours()) {
        await postOpenPositions("30-Min Update");
      }
      scheduleNext();
    }, msUntilNext30());
  }
  scheduleNext();
  console.log("[DISCORD] 30-min position updates scheduled");
}

function scheduleMarketOpenMessages() {
  var alerts = [
    { utcHour: 12, utcMin: 45, minutesBefore: 45 },
    { utcHour: 13, utcMin: 10, minutesBefore: 20 },
    { utcHour: 13, utcMin: 25, minutesBefore: 5  },
    { utcHour: 13, utcMin: 29, minutesBefore: 1  }
  ];
  function msUntilNext(h, m) {
    var now = new Date();
    var target = new Date();
    target.setUTCHours(h, m, 0, 0);
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    return target - now;
  }
  alerts.forEach(function(a) {
    function scheduleNext() {
      setTimeout(async function() {
        await postGoodMorning(a.minutesBefore);
        scheduleNext();
      }, msUntilNext(a.utcHour, a.utcMin));
    }
    scheduleNext();
  });
  console.log("[DISCORD] Swing market open messages scheduled");
}

// ── Trade notifications ───────────────────────────────────────────────────────
async function postSwingEntry(ticker, side, strike, expiry, optionPrice, contracts) {
  var color = side === "call" ? 0x00e5a0 : 0xff4d6a;
  var emoji = side === "call" ? "📈" : "📉";
  var posValue = optionPrice * contracts * 100;

  accountState.positions[ticker] = {
    side: side, contracts: contracts, totalContracts: contracts,
    entryPrice: optionPrice, realizedPnl: 0, lastProfitTier: 0
  };

  await sendDiscord({ embeds: [{
    color: color,
    title: emoji + " SWING ENTRY — " + ticker + " " + side.toUpperCase(),
    fields: [
      { name: "Strike", value: "$" + strike, inline: true },
      { name: "Expiry", value: expiry, inline: true },
      { name: "Contracts", value: String(contracts), inline: true },
      { name: "Entry Price", value: "$" + optionPrice.toFixed(2), inline: true },
      { name: "Position Value", value: formatMoney(posValue), inline: true },
      { name: "Type", value: "Swing 10-14 DTE", inline: true }
    ],
    footer: { text: accountFooter() },
    timestamp: new Date().toISOString()
  }]});
}

async function postSwingFlip(ticker, oldSide, newSide, strike, expiry, optionPrice, contracts) {
  var color = newSide === "call" ? 0x00e5a0 : 0xff4d6a;
  await sendDiscord({ embeds: [{
    color: color,
    title: "🔄 FLIP — " + ticker + " " + oldSide.toUpperCase() + " → " + newSide.toUpperCase(),
    fields: [
      { name: "New Strike", value: "$" + strike, inline: true },
      { name: "Expiry", value: expiry, inline: true },
      { name: "Contracts", value: String(contracts), inline: true },
      { name: "Entry Price", value: "$" + optionPrice.toFixed(2), inline: true }
    ],
    footer: { text: "SMA crossover triggered flip" },
    timestamp: new Date().toISOString()
  }]});
}

async function postProfitTier(ticker, tierName, sellContracts, currentPrice, gainPct) {
  var pos = accountState.positions[ticker];
  if (!pos) return;
  var proceeds = sellContracts * currentPrice * 100;
  var cost = sellContracts * pos.entryPrice * 100;
  var pnl = proceeds - cost;
  pos.realizedPnl += pnl;
  pos.contracts -= sellContracts;
  accountState.balance += pnl;

  await sendDiscord({ embeds: [{
    color: 0xf5a623,
    title: "💰 " + tierName + " — " + ticker,
    fields: [
      { name: "Sold", value: sellContracts + "c @ $" + currentPrice.toFixed(2), inline: true },
      { name: "Gain", value: formatPct(gainPct), inline: true },
      { name: "P&L", value: formatMoney(pnl), inline: true },
      { name: "Remaining", value: String(pos.contracts) + " contracts", inline: true },
      { name: "Realized P&L", value: formatMoney(pos.realizedPnl), inline: true }
    ],
    footer: { text: accountFooter() },
    timestamp: new Date().toISOString()
  }]});
}

async function postBreakeven(ticker, stopLevel) {
  await sendDiscord({ embeds: [{
    color: 0xf5a623,
    title: "🟡 STOP RATCHET — " + ticker,
    fields: [
      { name: "New Stop Level", value: "$" + parseFloat(stopLevel).toFixed(2), inline: true },
      { name: "Status", value: "Gains protected ✅", inline: true }
    ],
    footer: { text: "Stop moved to protect profits" },
    timestamp: new Date().toISOString()
  }]});
}

async function postSwingClose(ticker, currentPrice, pnl, pct, reason) {
  var color = pnl >= 0 ? 0x00e5a0 : 0xff4d6a;
  var emoji = pnl >= 0 ? "✅" : "🔴";
  accountState.balance += pnl;
  if (pnl >= 0) accountState.wins++; else accountState.losses++;
  accountState.dailyTrades.push({ ticker, pnl, pct, reason, closed: true });
  delete accountState.positions[ticker];

  await sendDiscord({ embeds: [{
    color: color,
    title: emoji + " SWING CLOSED — " + ticker,
    fields: [
      { name: "Exit Price", value: "$" + currentPrice.toFixed(2), inline: true },
      { name: "P&L", value: formatMoney(pnl) + " (" + formatPct(pct) + ")", inline: true },
      { name: "Reason", value: reason, inline: true }
    ],
    footer: { text: accountFooter() },
    timestamp: new Date().toISOString()
  }]});
}

async function postDailySummary() {
  var netPnl = accountState.balance - accountState.startingBalance;
  var netPct = (netPnl / accountState.startingBalance) * 100;
  var color = netPnl >= 0 ? 0x00e5a0 : 0xff4d6a;
  var emoji = netPnl >= 0 ? "📈" : "📉";

  var tradeLines = accountState.dailyTrades.filter(function(t) { return t.closed; })
    .map(function(t) {
      var e = t.pnl >= 0 ? "✅" : "🔴";
      return e + " " + t.ticker + ": " + formatMoney(t.pnl) + " (" + formatPct(t.pct) + ")";
    }).join("\n") || "No closed trades today";

  await sendDiscord({ embeds: [{
    color: color,
    title: emoji + " SWING DAILY P&L — " + new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    fields: [
      { name: "Trades", value: tradeLines, inline: false },
      { name: "Net P&L", value: formatMoney(netPnl) + " (" + formatPct(netPct) + ")", inline: true },
      { name: "Wins / Losses", value: accountState.wins + " / " + accountState.losses, inline: true },
      { name: "Balance", value: formatMoney(accountState.balance), inline: true }
    ],
    footer: { text: "Argus Swing Trader 50K | Starting Balance: " + formatMoney(accountState.startingBalance) },
    timestamp: new Date().toISOString()
  }]});

  accountState.dailyTrades = [];
}

function scheduleDailySummary() {
  function msUntilAfterBell() {
    var now = new Date();
    var target = new Date();
    target.setUTCHours(20, 5, 0, 0);
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    return target - now;
  }
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
    }, msUntilAfterBell());
  }
  scheduleNext();
  console.log("[DISCORD] After-the-bell summary scheduled (4:05 PM ET — scan + P&L)");
}

// ── Paper stock notifications ─────────────────────────────────────────────────
async function postProximityAlert(poolId, ticker, price, level) {
  await sendDiscord({ embeds: [{
    color: 0x4da6ff,
    title: poolTag(poolId) + "📍 MA PROXIMITY — " + ticker,
    description: ticker + " is within **" + level.proximity_pct + "%** of **" + level.label + "**",
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
      { name: pool.shortLabel + " — Closed Today", value: tradeLines, inline: false },
      { name: pool.shortLabel + " — Open Positions", value: openLines, inline: false },
      { name: pool.shortLabel + " — Next Entry", value: formatMoney(paperMod.getPositionSizeUSD(pool.id, livePrices)) + " (" + riskPct + "% equity)", inline: false }
    );
  });

  var color = totalNet >= 0 ? 0x00e5a0 : 0xff4d6a;

  await sendDiscord({ embeds: [{
    color: color,
    title: "🔔 AFTER THE BELL — Daily P&L · " + new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    description: "Combined equity " + formatMoney(totalEquity) + " · Combined net P&L " + formatMoney(totalNet),
    fields: fields,
    footer: { text: "Argus Paper · Main $50K + Space DC $108K · Stop: 55 SMA · TP: +10/+20/+30%" },
    timestamp: new Date().toISOString()
  }] }, "daily");
}

module.exports = {
  postGoodMorning,
  scheduleMarketOpenMessages,
  schedulePositionUpdates,
  updateLastKnownPrice,
  postOpenPositions,
  postSwingEntry,
  postSwingFlip,
  postProfitTier,
  postBreakeven,
  postSwingClose,
  postDailySummary,
  scheduleDailySummary,
  postProximityAlert,
  postStockEntry,
  postStockExit,
  postTakeProfit,
  postStockDailySummary
};
