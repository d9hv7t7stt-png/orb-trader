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

function formatMaPrice(v) {
  return v != null ? "$" + Number(v).toFixed(2) : "—";
}

function levelValue(scanRow, key) {
  if (!scanRow || !scanRow.levels) return null;
  var found = scanRow.levels.find(function (l) { return l.key === key; });
  return found && found.value != null ? found.value : null;
}

function fieldsFromLines(baseName, lines, limit) {
  limit = limit || 1024;
  var fields = [];
  var buf = [];
  var len = 0;
  function flush() {
    if (!buf.length) return;
    var name = fields.length === 0 ? baseName : baseName + " (" + (fields.length + 1) + ")";
    fields.push({ name: name, value: buf.join("\n").slice(0, limit), inline: false });
    buf = [];
    len = 0;
  }
  lines.forEach(function (line) {
    var add = (buf.length ? 1 : 0) + line.length;
    if (len + add > limit) flush();
    buf.push(line);
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

  var lines = [];
  spaceDcBook.watchlistTickers().forEach(function (ticker) {
    var row = scanResults[ticker] || {};
    var pos = byTicker[ticker];
    var close = priorClose(row, pos ? pos.entryPrice : null);
    var ema21 = levelValue(row, "d_ema21");
    var sma55 = levelValue(row, "d_sma55");
    var px = livePrices[ticker] && livePrices[ticker].price != null
      ? livePrices[ticker].price
      : (close != null ? close : (pos ? pos.entryPrice : null));
    lines.push(
      ticker.padEnd(5) + "  " + formatMaPrice(close)
        + "  21 " + formatMaPrice(ema21)
        + "  55 " + formatMaPrice(sma55)
    );
    if (pos && pos.shares) {
      var value = pos.shares * (px != null ? px : pos.entryPrice);
      var pct = pos.entryPrice ? (((px != null ? px : pos.entryPrice) - pos.entryPrice) / pos.entryPrice) * 100 : 0;
      lines.push("     " + pos.shares + "sh  " + formatMoney(value) + "  " + formatPct(pct));
    } else {
      lines.push("     no position");
    }
  });
  lines.push("CASH  " + formatMoney(p.cash));
  spaceDcBook.SOLD.forEach(function (sold) {
    lines.push(sold.ticker + "  " + sold.note);
  });
  return fieldsFromLines("Watchlist", lines);
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

async function postProximityAlert(poolId, ticker, price, level) {
  await sendDiscord({ embeds: [{
    color: 0x4da6ff,
    title: poolTag(poolId) + "📍 MA — " + ticker,
    description: ticker + " is near **" + level.label + "**",
    fields: [
      { name: "Price", value: "$" + price.toFixed(2), inline: true },
      { name: level.label, value: "$" + level.value.toFixed(2), inline: true }
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
      { name: "Risk Size", value: formatMoney(riskUsd) + " (" + (parseFloat(process.env.RISK_PCT || "2")) + "% equity)", inline: true },
      { name: "MA", value: maLabel, inline: true },
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
        return "• " + pos.ticker + " (" + pos.maLabel + ") " + pos.shares + "sh · uP&L " + formatMoney(u);
      }).join("\n") || "No open positions";
      fields.push(
        { name: pool.shortLabel + " — Open Positions", value: openLines.slice(0, 1000), inline: false },
        { name: pool.shortLabel + " — Next Entry", value: formatMoney(paperMod.getPositionSizeUSD(pool.id, livePrices)) + " (" + riskPct + "% equity)", inline: false }
      );
    }
  });

  var color = totalNet >= 0 ? 0x00e5a0 : 0xff4d6a;

  await sendDiscord({ embeds: [{
    color: color,
    title: "🔔 AFTER THE BELL — Position summary · " + new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    description: "One message, both pools. Combined equity " + formatMoney(totalEquity) + " · Combined net P&L " + formatMoney(totalNet),
    fields: fields,
    footer: { text: "Argus · Main + Space DC · Stop: daily close < 55 SMA · TP: +10/+20/+30%" },
    timestamp: new Date().toISOString()
  }] }, "daily");
}

function groupNearHits(hits, ordered) {
  var map = {};
  hits.forEach(function (h) {
    if (!map[h.ticker]) map[h.ticker] = [];
    map[h.ticker].push(h);
  });
  var tickersMod = require("./tickers");
  var keys = Object.keys(map);
  if (ordered) {
    keys.sort(function (a, b) {
      return tickersMod.briefingRank(a) - tickersMod.briefingRank(b);
    });
  } else {
    keys.sort();
  }
  return keys.map(function (ticker) {
    return { ticker: ticker, levels: map[ticker] };
  });
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
        description: "Week-ahead briefing · " + dateLabel + " · " + timeLabel + " · Book from 6/30/26 rebalance",
        fields: fields,
        footer: { text: accountFooter(pool.id) },
        timestamp: new Date().toISOString()
      };
    }

    var openLines = knownPositions.map(function (pos) {
      var px = livePrices[pos.ticker] ? livePrices[pos.ticker].price : pos.entryPrice;
      var u = (px - pos.entryPrice) * pos.shares;
      var pct = pos.entryPrice ? ((px - pos.entryPrice) / pos.entryPrice) * 100 : 0;
      return "• " + pos.ticker + " (" + pos.maLabel + ") " + pos.shares + "sh · " + formatMoney(u) + " (" + formatPct(pct) + ")";
    }).join("\n") || "No open positions — waiting for MA proximity";

    var tickersMod = require("./tickers");
    var nearHits = [];
    Object.values(s.scanResults || {}).forEach(function (r) {
      if (!r || !r.levels) return;
      r.levels.filter(function (l) { return l.near && tickersMod.isBriefingMa(l); }).forEach(function (l) {
        if (!tickersMod.isBriefingTicker(r.ticker)) return;
        nearHits.push({ ticker: r.ticker, key: l.key, level: l.label, ma: l.value });
      });
    });
    var nearLines = groupNearHits(nearHits, true).map(function (g) {
      var chips = g.levels.map(function (l) {
        return l.level + " " + (l.ma != null ? formatMoney(l.ma) : "—");
      }).join(", ");
      return "• " + tickersMod.getDisplayTicker(g.ticker) + " — " + chips;
    }).join("\n") || "Nothing within 1% of the 21-Day EMA or 55-Day SMA";

    fields.push(
      { name: "Open", value: String(knownPositions.length), inline: true },
      { name: "Next Entry", value: formatMoney(paperMod.getPositionSizeUSD(pool.id, livePrices)), inline: true },
      { name: "Open Positions", value: openLines.slice(0, 1000), inline: false },
      { name: "Near MA", value: nearLines.slice(0, 1000), inline: false }
    );

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
  postProximityAlert: postProximityAlert,
  postStockEntry: postStockEntry,
  postStockExit: postStockExit,
  postTakeProfit: postTakeProfit,
  postStockDailySummary: postStockDailySummary,
  postSundayPremarket: postSundayPremarket,
  postSundayPremarketPool: postSundayPremarketPool,
  buildSundayPremarketEmbeds: buildSundayPremarketEmbeds,
  livePricesFromState: livePricesFromState
};
