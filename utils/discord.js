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
  return "Argus · " + pool.shortLabel + " · Equity " + formatMoney(equity);
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
    req.setTimeout(15000, function () {
      req.destroy();
      reject(new Error("Discord request timed out"));
    });
    req.write(body);
    req.end();
  });
}

async function sendDiscord(payload, roleType) {
  if (!DISCORD_WEBHOOK) return;
  try {
    if (roleType === "everyone") {
      payload.content = payload.content
        ? "@everyone " + payload.content
        : "@everyone";
      payload.allowed_mentions = { parse: ["everyone"] };
    } else {
      var ping = rolePing(roleType);
      if (ping && !payload.content) payload.content = ping;
      else if (ping && payload.content) payload.content = ping + " " + payload.content;
    }
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
    profit: process.env.DISCORD_ROLE_TAKEPROFIT,
    weekly: process.env.DISCORD_ROLE_WEEKLY,
    options: process.env.DISCORD_ROLE_OPTIONS
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

function formatMaPrice(v) {
  return v != null ? formatMoney(v) : "n/a";
}

function formatPositionName(pos) {
  if (pos.maLabel) return pos.ticker + " (" + pos.maLabel + ")";
  return pos.ticker;
}

function formatTriggerLabel(maLabel) {
  return maLabel || "—";
}

function levelValue(scanRow, key) {
  if (!scanRow || !scanRow.levels) return null;
  var found = scanRow.levels.find(function (l) { return l.key === key; });
  return found && found.value != null ? found.value : null;
}

function fieldsFromGroups(baseName, groups, limit) {
  limit = limit || 1024;
  var fields = [];
  var buf = [];
  var len = 0;
  function flush() {
    if (!buf.length) return;
    fields.push({
      name: fields.length === 0 ? baseName : baseName + " (" + (fields.length + 1) + ")",
      value: buf.join("\n\n"),
      inline: false
    });
    buf = [];
    len = 0;
  }
  groups.forEach(function (group) {
    var text = Array.isArray(group) ? group.join("\n") : String(group);
    var add = (buf.length ? 2 : 0) + text.length;
    if (buf.length && len + add > limit) flush();
    buf.push(text);
    len += add;
  });
  flush();
  return fields;
}

function priorClose(scanRow, fallback) {
  if (scanRow && scanRow.stopPrice != null) return scanRow.stopPrice;
  if (scanRow && scanRow.price != null) return scanRow.price;
  return fallback != null ? fallback : null;
}

function buildSpaceDcWatchlistFields(livePrices, scanResults) {
  var paperMod = require("./paper");
  var spaceDcBook = require("./spaceDcBook");
  var p = paperMod.getPortfolio("space_dc");
  var byTicker = spaceDcBook.positionByTicker(p);
  livePrices = livePrices || {};
  scanResults = scanResults || {};
  var groups = [];

  spaceDcBook.watchlistTickers().forEach(function (ticker) {
    var row = scanResults[ticker] || {};
    var pos = byTicker[ticker];
    var close = priorClose(row, null);
    if (close == null && livePrices[ticker] && livePrices[ticker].price != null) {
      close = livePrices[ticker].price;
    }
    if (close == null && pos) close = pos.entryPrice;
    if (pos && pos.shares) {
      var mark = close != null ? close : pos.entryPrice;
      var pnl = (mark - pos.entryPrice) * pos.shares;
      var pct = pos.entryPrice ? ((mark - pos.entryPrice) / pos.entryPrice) * 100 : 0;
      var pnlStr = (pnl > 0 ? "+" : "") + formatMoney(pnl);
      groups.push([
        "$" + ticker + "  " + pos.shares + " sh  " + formatMaPrice(close),
        "Entry " + formatMoney(pos.entryPrice) + " · P&L " + pnlStr + " (" + formatPct(pct) + ")"
      ]);
    } else {
      groups.push("$" + ticker + "  " + formatMaPrice(close) + "  0 sh");
    }
  });
  groups.push("$CASH  " + formatMoney(p.cash));
  spaceDcBook.SOLD.forEach(function (sold) {
    groups.push("$" + sold.ticker + "  Sold @ $54");
  });
  return fieldsFromGroups("Watchlist", groups);
}

function buildMainWatchlistFields(scanResults) {
  var tickersMod = require("./tickers");
  scanResults = scanResults || {};
  var groups = tickersMod.getMainBriefingTickers().map(function (ticker) {
    var row = scanResults[ticker] || {};
    return [
      "$" + tickersMod.getDisplayTicker(ticker) + "  " + formatMaPrice(priorClose(row, null)),
      "21D: " + formatMaPrice(levelValue(row, "d_ema21")) + " · 55D: " + formatMaPrice(levelValue(row, "d_sma55"))
    ];
  });
  return fieldsFromGroups("Watchlist", groups);
}

function livePricesFromState() {
  var stateMod = require("./state");
  var livePricesByPool = {};
  pools.getAllPools().forEach(function (pool) {
    var s = stateMod.getState(pool.id);
    livePricesByPool[pool.id] = {};
    Object.values(s.scanResults || {}).forEach(function (r) {
      if (r && r.price) livePricesByPool[pool.id][r.ticker] = { price: r.price };
    });
  });
  return livePricesByPool;
}

function scheduleDailySummary() {
  async function runAfterBell() {
    var scannerMod = require("./scanner");
    await scannerMod.runScan(true);
    await postStockDailySummary(livePricesFromState());
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

function scheduleSundayPremarket() {
  async function runSunday() {
    var scannerMod = require("./scanner");
    await scannerMod.runScan(true, { quotesOnly: true });
    await postSundayPremarket(livePricesFromState());
  }
  function scheduleNext() {
    setTimeout(async function () {
      await runSunday();
      scheduleNext();
    }, marketHours.msUntilSundayPremarket());
  }
  scheduleNext();
  console.log("[DISCORD] Sunday premarket scheduled (" + marketHours.sundayPremarketLabel() + " — week-ahead per pool)");
}

function scheduleWeeklyJournal() {
  async function runWeekly() {
    var journalMod = require("./journal");
    var journals = journalMod.allPoolsWeeklyJournal();
    await postWeeklyJournal(journals);
  }
  function scheduleNext() {
    setTimeout(async function () {
      await runWeekly();
      scheduleNext();
    }, marketHours.msUntilFridayClock(16, 10));
  }
  scheduleNext();
  console.log("[DISCORD] Weekly trade journal scheduled (Fri 4:10 PM ET)");
}

function scheduleNearMaDigest() {
  var hours = (process.env.NEAR_MA_DIGEST_HOURS || "12,15").split(",").map(function (h) {
    return parseInt(h.trim(), 10);
  }).filter(function (h) { return !isNaN(h) && h >= 0 && h <= 23; });

  function scheduleSlot(hour) {
    async function runDigest() {
      var scannerMod = require("./scanner");
      await scannerMod.runScan(true, { quotesOnly: true });
      await postNearMaDigest();
    }
    function scheduleNext() {
      setTimeout(async function () {
        await runDigest();
        scheduleNext();
      }, marketHours.msUntilNextWeekdayClock(hour, 0));
    }
    scheduleNext();
  }

  hours.forEach(scheduleSlot);
  console.log("[DISCORD] Near MA digest scheduled weekdays at " + hours.map(function (h) {
    return marketHours.formatHourEt(h);
  }).join(", "));
}

function howToReadGuideText() {
  return [
    "**How to read Argus MA alerts**",
    "",
    "• **Title score (0–100)** = setup quality. Focus **70+**, consider **55–69**, skip **<55**.",
    "• **Near 21D** = primary swing entry zone. **Near 55D** = context / watch, not the main buy trigger.",
    "• Prefer names near **21D**, score **≥70**, in a bullish regime (SPY/QQQ above 200D).",
    "• Same ticker may ping twice (21D + 55D) — treat it as **one** setup, use the score once.",
    "• Higher **VIX** = smaller size / more caution. Low score usually means weak RS, regime, or risk filters."
  ].join("\n");
}

async function postHowToReadGuide() {
  await sendDiscord({
    embeds: [{
      color: 0x4da6ff,
      title: "📖 HOW TO READ ARGUS — Premarket reminder",
      description: howToReadGuideText(),
      footer: { text: "Argus · Daily premarket · Weekdays" },
      timestamp: new Date().toISOString()
    }]
  }, "everyone");
}

function scheduleHowToPremarket() {
  var hour = parseInt(process.env.HOWTO_PREMARKET_HOUR || "8", 10);
  var minute = parseInt(process.env.HOWTO_PREMARKET_MIN || "45", 10);
  if (isNaN(hour) || hour < 0 || hour > 23) hour = 8;
  if (isNaN(minute) || minute < 0 || minute > 59) minute = 45;

  async function runGuide() {
    await postHowToReadGuide();
  }

  function scheduleNext() {
    setTimeout(async function () {
      await runGuide();
      scheduleNext();
    }, marketHours.msUntilNextWeekdayClock(hour, minute));
  }
  scheduleNext();
  console.log("[DISCORD] How-to-read guide scheduled weekdays " + hour + ":" + (minute < 10 ? "0" : "") + minute + " ET (@everyone)");
}

function scheduleSectorRankDaily() {
  var hour = parseInt(process.env.SECTOR_RANK_HOUR || "9", 10);
  var minute = parseInt(process.env.SECTOR_RANK_MIN || "35", 10);

  async function runDaily() {
    var sectorsMod = require("./sectors");
    var vixMod = require("./vix");
    var ranks = await sectorsMod.fetchSectorRanks();
    var vix = await vixMod.fetchVix();
    await postSectorRankDaily(ranks, vix);
  }

  function scheduleNext() {
    setTimeout(async function () {
      await runDaily();
      scheduleNext();
    }, marketHours.msUntilNextWeekdayClock(hour, minute));
  }
  scheduleNext();
  console.log("[DISCORD] Sector rank daily scheduled weekdays " + hour + ":" + (minute < 10 ? "0" : "") + minute + " ET");
}

function scheduleSectorRankWeekly() {
  async function runWeekly() {
    var sectorsMod = require("./sectors");
    var ranks = await sectorsMod.fetchSectorRanks();
    await postSectorRankWeekly(ranks);
  }

  function scheduleSunday() {
    setTimeout(async function () {
      await runWeekly();
      scheduleSunday();
    }, marketHours.msUntilSundayPremarket());
  }

  function scheduleFriday() {
    setTimeout(async function () {
      await runWeekly();
      scheduleFriday();
    }, marketHours.msUntilFridayClock(16, 15));
  }

  scheduleSunday();
  scheduleFriday();
  console.log("[DISCORD] Sector rank weekly scheduled Sun premarket + Fri 4:15 PM ET");
}

async function postWeeklyJournal(journals) {
  var journalMod = require("./journal");
  journals = journals || journalMod.allPoolsWeeklyJournal();
  var body = journalMod.formatWeeklyJournalText(journals);
  await sendDiscord({ embeds: [{
    color: 0x4da6ff,
    title: "📒 WEEKLY TRADE JOURNAL",
    description: body.slice(0, 4000),
    footer: { text: "Argus · Closed trades last 7 days · Main + Space DC" },
    timestamp: new Date().toISOString()
  }] }, "weekly");
}

async function postNearMaDigest() {
  var stateMod = require("./state");
  var tickersMod = require("./tickers");
  var alphaMod = require("./alpha");
  var scannerMod = require("./scanner");
  var ctx = scannerMod.getLastScanContext() || {};
  var lines = [];
  pools.getAllPools().forEach(function (pool) {
    var s = stateMod.getState(pool.id);
    Object.values(s.scanResults || {}).forEach(function (r) {
      if (!r || !r.levels) return;
      r.levels.forEach(function (l) {
        if (!l.near || tickersMod.PROXIMITY_ALERT_KEYS.indexOf(l.key) === -1) return;
        var rs = ctx.rsRanks && ctx.rsRanks[pool.id] && ctx.rsRanks[pool.id].byTicker
          ? ctx.rsRanks[pool.id].byTicker[r.ticker]
          : null;
        var setup = alphaMod.computeSetupScore(r, {
          regimeBullish: ctx.regimeBullish,
          vix: ctx.vix,
          rsInfo: rs,
          themeOk: true
        });
        lines.push({
          text: poolTag(pool.id) + "**" + r.ticker + "** · score **" + setup.score + "** · " + l.label + " · $" + r.price.toFixed(2),
          score: setup.score
        });
      });
    });
  });
  if (!lines.length) return;
  lines.sort(function (a, b) { return b.score - a.score; });
  await sendDiscord({ embeds: [{
    color: 0x4da6ff,
    title: "📋 NEAR MA — Setup queue",
    description: lines.slice(0, 25).map(function (l) { return l.text; }).join("\n"),
    footer: { text: "Argus · Ranked by setup score · min " + alphaMod.SETUP_SCORE_MIN + " to auto-enter" },
    timestamp: new Date().toISOString()
  }] }, "proximity");
}

async function postSectorRankDaily(ranks, vixData) {
  var sectorsMod = require("./sectors");
  var vixMod = require("./vix");
  ranks = ranks || await sectorsMod.fetchSectorRanks();
  vixData = vixData || await vixMod.fetchVix();
  if (!ranks.ok) return;
  await sendDiscord({ embeds: [{
    color: 0x00e5a0,
    title: "📊 SECTOR RANK — Daily",
    description: sectorsMod.formatSectorRankLines(ranks, "week").slice(0, 4000),
    fields: [
      { name: "VIX", value: vixData.vix != null ? vixData.vix + " · " + vixData.zone + " · size ×" + vixData.riskMult : "—", inline: false }
    ],
    footer: { text: "Argus · SPDR sectors vs SPY · week RS rank" },
    timestamp: new Date().toISOString()
  }] }, "daily");
}

async function postSectorRankWeekly(ranks) {
  var sectorsMod = require("./sectors");
  ranks = ranks || await sectorsMod.fetchSectorRanks();
  if (!ranks.ok) return;
  await sendDiscord({ embeds: [{
    color: 0x4da6ff,
    title: "📊 SECTOR RANK — Weekly recap",
    description: (
      sectorsMod.formatSectorRankLines(ranks, "week") + "\n\n" +
      sectorsMod.formatSectorRankLines(ranks, "month")
    ).slice(0, 4000),
    footer: { text: "Argus · Leading sectors this week & month vs SPY" },
    timestamp: new Date().toISOString()
  }] }, "daily");
}

async function postOptionsOverlay(poolId, ticker, price, ema21, overlay) {
  await sendDiscord({ embeds: [{
    color: 0xf5a623,
    title: poolTag(poolId) + "📊 OPTIONS — " + ticker + " near 21D · low IV",
    description: ticker + " is near **21-Day EMA** with favorable implied volatility.",
    fields: [
      { name: "Price", value: "$" + price.toFixed(2), inline: true },
      { name: "21D EMA", value: "$" + ema21.value.toFixed(2), inline: true },
      { name: "IV", value: overlay.iv + "%", inline: true },
      { name: "IV Rank", value: overlay.ivRank + "%", inline: true },
      { name: "Expiry", value: overlay.expiry || "—", inline: true }
    ],
    footer: { text: accountFooter(poolId) + " · IV rank ≤ " + require("./tickers").OPTIONS_IV_RANK_MAX + "%" },
    timestamp: new Date().toISOString()
  }] }, "options");
}

async function postProximityAlert(poolId, ticker, price, level, setup) {
  var scoreLine = setup ? "Setup score **" + setup.score + "**" : "";
  await sendDiscord({ embeds: [{
    color: 0x4da6ff,
    title: poolTag(poolId) + "📍 MA — " + ticker + (setup ? " · " + setup.score : ""),
    description: ticker + " is near **" + level.label + "**" + (scoreLine ? " · " + scoreLine : ""),
    fields: [
      { name: "Price", value: "$" + price.toFixed(2), inline: true },
      { name: level.label, value: "$" + level.value.toFixed(2), inline: true }
    ],
    footer: { text: accountFooter(poolId) },
    timestamp: new Date().toISOString()
  }] }, "proximity");
}

async function postStockEntry(poolId, ticker, maLabel, price, shares, total, proximityPct, riskUsd, setup) {
  await sendDiscord({ embeds: [{
    color: 0x00e5a0,
    title: poolTag(poolId) + "📈 STOCK BUY — " + ticker + (setup ? " · score " + setup.score : ""),
    fields: [
      { name: "Trigger", value: formatTriggerLabel(maLabel), inline: true },
      { name: "Shares", value: String(shares), inline: true },
      { name: "Price", value: "$" + price.toFixed(2), inline: true },
      { name: "Cost", value: formatMoney(total), inline: true },
      { name: "Risk Size", value: formatMoney(riskUsd) + " (" + (parseFloat(process.env.RISK_PCT || "2")) + "% equity)", inline: true },
      { name: "Setup", value: setup ? setup.score + " · " + setup.parts.slice(0, 4).join(", ") : "—", inline: false },
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
      { name: "Entry MA", value: formatTriggerLabel(maLabel), inline: true },
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
      { name: "Entry MA", value: formatTriggerLabel(maLabel), inline: true },
      { name: "Remaining", value: remaining != null ? remaining + " shares" : "Closed", inline: true }
    ],
    footer: { text: accountFooter(poolId) },
    timestamp: new Date().toISOString()
  }] }, "profit");
}

async function postStockDailySummary(livePricesByPool) {
  var paperMod = require("./paper");
  var vixMod = require("./vix");
  var sectorsMod = require("./sectors");
  var scannerMod = require("./scanner");
  var riskPct = (parseFloat(process.env.RISK_PCT || "2")).toFixed(0);
  var fields = [];
  var totalNet = 0;
  var totalEquity = 0;
  var vix = await vixMod.fetchVix();
  var sectorRanks = await sectorsMod.fetchSectorRanks();
  var ctx = scannerMod.getLastScanContext() || {};

  pools.getAllPools().forEach(function (pool) {
    var livePrices = (livePricesByPool && livePricesByPool[pool.id]) || {};
    var p = paperMod.getPortfolio(pool.id);
    var unreal = paperMod.getUnrealizedPnL(pool.id, livePrices);
    var pnlSum = paperMod.getPnlSummary(pool.id);
    var equity = paperMod.getEquity(pool.id, livePrices);
    var netPnl = equity - p.startingBalance;
    totalNet += netPnl;
    totalEquity += equity;

    var todayEt = marketHours.etDateKey(new Date());
    var closedToday = p.trades.filter(function (t) {
      return t.type === "sell" && marketHours.etDateKey(new Date(t.time)) === todayEt;
    });
    var tradeLines = closedToday.map(function (t) {
      var e = t.pnl >= 0 ? "✅" : "🔴";
      return e + " " + t.ticker + ": " + formatMoney(t.pnl) + " (" + formatPct(t.pct) + ") — " + t.reason;
    }).join("\n") || "No closed trades today";

    var allowed = {};
    pool.getTickers().forEach(function (t) { allowed[t] = true; });
    fields.push(
      { name: pool.shortLabel + " — Equity", value: formatMoney(equity), inline: true },
      { name: pool.shortLabel + " — Cash", value: formatMoney(p.cash), inline: true },
      { name: pool.shortLabel + " — Unrealized", value: formatMoney(unreal.total), inline: true },
      { name: pool.shortLabel + " — Realized Today", value: pnlSum.daily != null ? formatMoney(pnlSum.daily) : "—", inline: true },
      { name: pool.shortLabel + " — Net P&L", value: formatMoney(netPnl), inline: true },
      { name: pool.shortLabel + " — W / L", value: p.wins + " / " + p.losses, inline: true },
      { name: pool.shortLabel + " — Closed Today", value: tradeLines.slice(0, 1000), inline: false }
    );
    if (pool.id === "space_dc") {
      var stateMod = require("./state");
      buildSpaceDcWatchlistFields(livePrices, stateMod.getState(pool.id).scanResults || {}).forEach(function (f) {
        fields.push({ name: pool.shortLabel + " — " + f.name, value: f.value, inline: false });
      });
    } else {
      var openLines = Object.values(p.positions).filter(function (pos) {
        return allowed[pos.ticker];
      }).map(function (pos) {
        var px = livePrices[pos.ticker] ? livePrices[pos.ticker].price : pos.entryPrice;
        var u = (px - pos.entryPrice) * pos.shares;
        return "• " + formatPositionName(pos) + " " + pos.shares + "sh · uP&L " + formatMoney(u);
      }).join("\n") || "No open positions";
      fields.push(
        { name: pool.shortLabel + " — Open Positions", value: openLines.slice(0, 1000), inline: false },
        { name: pool.shortLabel + " — Next Entry", value: formatMoney(paperMod.getPositionSizeUSD(pool.id, livePrices)) + " (" + riskPct + "% equity)", inline: false }
      );
    }
  });

  var color = totalNet >= 0 ? 0x00e5a0 : 0xff4d6a;
  var regimeLine = ctx.regimeBullish === false ? "Regime: **risk-off** (SPY/QQQ below 200D)" : "Regime: **bullish** (SPY/QQQ above 200D)";
  var sectorLine = sectorRanks.leadersWeek && sectorRanks.leadersWeek.length
    ? "Sectors leading: **" + sectorRanks.leadersWeek.join(", ") + "** · weak: " + sectorRanks.laggardsWeek.join(", ")
    : "";

  await sendDiscord({ embeds: [{
    color: color,
    title: "🔔 AFTER THE BELL — Position summary · " + new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    description: "Combined equity " + formatMoney(totalEquity) + " · Combined net P&L " + formatMoney(totalNet) + "\n" +
      vixMod.formatVixLine(vix) + " · " + regimeLine + (sectorLine ? "\n" + sectorLine : ""),
    fields: fields,
    footer: { text: "Argus · Main + Space DC · Stop: daily close < 55 SMA · TP: +10/+20/+30%" },
    timestamp: new Date().toISOString()
  }] }, "daily");
}

function buildSundayPremarketEmbeds(livePricesByPool) {
  var paperMod = require("./paper");
  var stateMod = require("./state");
  var dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York"
  });
  var timeLabel = marketHours.sundayPremarketLabel();

  return pools.getAllPools().map(function (pool) {
    var livePrices = (livePricesByPool && livePricesByPool[pool.id]) || {};
    var p = paperMod.getPortfolio(pool.id);
    var unreal = paperMod.getUnrealizedPnL(pool.id, livePrices);
    var equity = paperMod.getEquity(pool.id, livePrices);
    var netPnl = equity - p.startingBalance;
    var s = stateMod.getState(pool.id);

    var allowed = {};
    pool.getTickers().forEach(function (t) { allowed[t] = true; });
    var knownPositions = Object.values(p.positions).filter(function (pos) { return allowed[pos.ticker]; });

    var fields = [
      { name: "Equity", value: formatMoney(equity), inline: true },
      { name: "Cash", value: formatMoney(p.cash), inline: true },
      { name: "Unrealized", value: formatMoney(unreal.total), inline: true },
      { name: "Net P&L", value: formatMoney(netPnl), inline: true }
    ];

    if (pool.id === "space_dc") {
      fields.push({ name: "Open", value: String(knownPositions.length), inline: true });
      fields.push({ name: "Names", value: String(require("./spaceDcBook").watchlistTickers().length), inline: true });
      buildSpaceDcWatchlistFields(livePrices, s.scanResults || {}).forEach(function (f) {
        fields.push(f);
      });
      return {
        color: 0x4da6ff,
        title: poolTag(pool.id) + "🌅 SUNDAY PREMARKET",
        description: "Week-ahead briefing · " + dateLabel + " · " + timeLabel,
        fields: fields,
        footer: { text: accountFooter(pool.id) },
        timestamp: new Date().toISOString()
      };
    }

    var openLines = knownPositions.map(function (pos) {
      var px = livePrices[pos.ticker] ? livePrices[pos.ticker].price : pos.entryPrice;
      var u = (px - pos.entryPrice) * pos.shares;
      var pct = pos.entryPrice ? ((px - pos.entryPrice) / pos.entryPrice) * 100 : 0;
      return "• " + formatPositionName(pos) + " " + pos.shares + "sh · " + formatMoney(u) + " (" + formatPct(pct) + ")";
    }).join("\n") || "No open positions — waiting for MA proximity";

    fields.push(
      { name: "Open", value: String(knownPositions.length), inline: true },
      { name: "Next Entry", value: formatMoney(paperMod.getPositionSizeUSD(pool.id, livePrices)), inline: true },
      { name: "Open Positions", value: openLines.slice(0, 1000), inline: false }
    );
    buildMainWatchlistFields(s.scanResults || {}).forEach(function (f) {
      fields.push(f);
    });

    return {
      color: 0x4da6ff,
      title: poolTag(pool.id) + "🌅 SUNDAY PREMARKET",
      description: "Week-ahead briefing · " + dateLabel + " · " + timeLabel,
      fields: fields,
      footer: { text: accountFooter(pool.id) },
      timestamp: new Date().toISOString()
    };
  });
}

async function postSundayPremarketPool(poolId, livePricesByPool) {
  var embed = buildSundayPremarketEmbeds(livePricesByPool).find(function (e) {
    var label = pools.getPool(poolId).shortLabel;
    return e.title.indexOf("[" + label + "]") === 0;
  });
  if (!embed) throw new Error("No embed for pool " + poolId);
  await sendDiscord({ embeds: [embed] }, "daily");
}

async function postSundayPremarket(livePricesByPool) {
  await sendDiscord({
    embeds: buildSundayPremarketEmbeds(livePricesByPool)
  }, "daily");
}

module.exports = {
  scheduleDailySummary: scheduleDailySummary,
  scheduleSundayPremarket: scheduleSundayPremarket,
  scheduleWeeklyJournal: scheduleWeeklyJournal,
  scheduleNearMaDigest: scheduleNearMaDigest,
  scheduleSectorRankDaily: scheduleSectorRankDaily,
  scheduleSectorRankWeekly: scheduleSectorRankWeekly,
  scheduleHowToPremarket: scheduleHowToPremarket,
  postProximityAlert: postProximityAlert,
  postOptionsOverlay: postOptionsOverlay,
  postWeeklyJournal: postWeeklyJournal,
  postNearMaDigest: postNearMaDigest,
  postSectorRankDaily: postSectorRankDaily,
  postSectorRankWeekly: postSectorRankWeekly,
  postHowToReadGuide: postHowToReadGuide,
  howToReadGuideText: howToReadGuideText,
  postStockEntry: postStockEntry,
  postStockExit: postStockExit,
  postTakeProfit: postTakeProfit,
  postStockDailySummary: postStockDailySummary,
  postSundayPremarket: postSundayPremarket,
  postSundayPremarketPool: postSundayPremarketPool,
  buildSundayPremarketEmbeds: buildSundayPremarketEmbeds,
  livePricesFromState: livePricesFromState
};
