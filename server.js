const express = require("express");
const path = require("path");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "dashboard")));

const state = require("./utils/state");
const paper = require("./utils/paper");
const tickers = require("./utils/tickers");
const pools = require("./utils/pools");
const paths = require("./utils/paths");
const scanner = require("./utils/scanner");
const discord = require("./utils/discord");
const backup = require("./utils/backup");
const journal = require("./utils/journal");
const backtest = require("./utils/backtest");

process.on("unhandledRejection", (err) => {
  console.error("[UNHANDLED_REJECTION]", err && err.message ? err.message : err);
});

function requireAuth(req, res, next) {
  var key = process.env.API_KEY;
  if (!key) return next();
  var provided = req.headers["x-api-key"];
  if (provided === key) return next();
  return res.status(401).json({ error: "Unauthorized — set x-api-key header" });
}

function parsePoolId(raw) {
  var poolId = raw || "main";
  if (!pools.isValidPoolId(poolId)) return null;
  return poolId;
}

app.get("/manifest.json", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard", "manifest.json"));
});
app.get("/sw.js", (req, res) => {
  res.setHeader("Service-Worker-Allowed", "/");
  res.sendFile(path.join(__dirname, "dashboard", "sw.js"));
});
app.get("/icon.svg", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard", "icon.svg"));
});

app.get("/api/config", (req, res) => {
  res.json({
    requiresAuth: !!process.env.API_KEY,
    pools: pools.getAllPools().map(function (p) {
      return { id: p.id, label: p.shortLabel };
    })
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "running",
    mode: "paper_stock",
    data_dir: paths.DATA_DIR,
    pools: pools.getAllPools().map(function (p) { return p.id; }),
    time: new Date().toISOString()
  });
});

app.get("/api/state", (req, res) => {
  var poolId = parsePoolId(req.query.pool);
  if (!poolId) return res.status(400).json({ error: "Invalid pool" });
  res.json(state.getState(poolId));
});

function buildPoolOverview(poolId) {
  var pool = pools.getPool(poolId);
  var s = state.getState(poolId);

  var nearHits = [];
  Object.values(s.scanResults || {}).forEach(function (r) {
    if (!r || !r.levels) return;
    r.levels.filter(function (l) { return l.near; }).forEach(function (l) {
      nearHits.push({
        poolId: poolId,
        ticker: r.ticker,
        price: r.price,
        level: l.label,
        ma: l.value,
        proximity_pct: l.proximity_pct
      });
    });
  });

  return {
    poolId: poolId,
    poolLabel: pool.shortLabel,
    poolName: pool.name,
    state: s,
    near_hits: nearHits,
    tickers: pool.getTickers()
  };
}

app.get("/api/overview", async (req, res) => {
  try {
    var poolId = parsePoolId(req.query.pool);
    if (!poolId) return res.status(400).json({ error: "Invalid pool" });
    var allPools = pools.getAllPools().map(function (p) { return buildPoolOverview(p.id); });
    var poolOverview = allPools.find(function (p) { return p.poolId === poolId; }) || allPools[0];

    res.json({
      mode: "paper_stock",
      activePool: poolId,
      pools: allPools,
      pool: poolOverview,
      state: poolOverview.state,
      near_hits: poolOverview.near_hits,
      tickers: poolOverview.tickers,
      ma_levels: tickers.MA_LEVELS,
      alert_only: tickers.SECTOR_SPDR,
      proximity_pct: tickers.PROXIMITY_PCT * 100,
      risk_pct: tickers.RISK_PCT * 100,
      strategy: {
        data_source: "Yahoo Finance",
        entry: "Buy when price within " + (tickers.PROXIMITY_PCT * 100) + "% of 21-Day EMA while live price is above 55-Day SMA. Blocked " + tickers.EARNINGS_BLACKOUT_DAYS + " days around earnings. Sector SPDRs are watch-only.",
        sizing: (tickers.RISK_PCT * 100) + "% of equity per entry",
        exit: "Stop loss when daily close is below 55-Day SMA",
        take_profit: tickers.TAKE_PROFIT_TIERS.map(function (t) { return t.label; }).join(" → "),
        levels: tickers.MA_LEVELS.map(function (l) { return l.label; }),
        options_overlay: "Near 21D + IV rank ≤ " + tickers.OPTIONS_IV_RANK_MAX + "% (Yahoo options chain)",
        near_ma_digest: "Weekday digests at " + (process.env.NEAR_MA_DIGEST_HOURS || "12,15") + ":00 ET",
        weekly_journal: "Friday 4:10 PM ET closed-trade rollup",
        backup: "Daily snapshot of /data to backups/ (keep " + (process.env.BACKUP_KEEP || "14") + ")",
        account: pools.getAllPools().map(function (p) {
          return p.shortLabel;
        }).join(" + "),
        discord_roles: {
          DISCORD_ROLE_ENTRIES: "Ping on paper buys (e.g. @Traders)",
          DISCORD_ROLE_STOPS: "Ping on stop-loss exits (e.g. @Risk)",
          DISCORD_ROLE_TAKEPROFIT: "Ping on take-profit sells (e.g. @Profits)",
          DISCORD_ROLE_PROXIMITY: "Ping on MA proximity alerts (e.g. @Alerts)",
          DISCORD_ROLE_DAILY: "Ping on after-the-bell P&L and Sunday 3:00 PM ET briefing (e.g. @Daily)",
          DISCORD_ROLE_WEEKLY: "Ping on Friday weekly trade journal",
          DISCORD_ROLE_OPTIONS: "Ping on low-IV options overlay near 21D",
          DISCORD_ROLE_ALERTS: "Fallback ping for all alert types"
        }
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/portfolio", (req, res) => {
  try {
    var poolId = parsePoolId(req.query.pool);
    if (!poolId) return res.status(400).json({ error: "Invalid pool" });
    var livePrices = discord.livePricesFromState()[poolId] || {};
    var p = paper.getPortfolio(poolId);
    var unreal = paper.getUnrealizedPnL(poolId, livePrices);
    var equity = paper.getEquity(poolId, livePrices);
    res.json({
      poolId: poolId,
      poolLabel: pools.getPool(poolId).shortLabel,
      cash: p.cash,
      equity: equity,
      startingBalance: p.startingBalance,
      netPnl: equity - p.startingBalance,
      unrealized: unreal.total,
      positions: unreal.details,
      pnl: paper.getPnlSummary(poolId),
      recentTrades: (p.trades || []).slice(0, 30)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/journal", (req, res) => {
  try {
    var poolId = parsePoolId(req.query.pool);
    if (poolId) {
      return res.json(journal.weeklyJournal(poolId));
    }
    res.json({ pools: journal.allPoolsWeeklyJournal() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/backtest", requireAuth, async (req, res) => {
  try {
    var poolId = parsePoolId((req.query && req.query.pool) || (req.body && req.body.pool) || "main");
    if (!poolId) return res.status(400).json({ error: "Invalid pool" });
    var days = parseInt((req.query && req.query.days) || (req.body && req.body.days) || process.env.BACKTEST_DAYS || "90", 10);
    res.json(await backtest.runBacktest({ poolId: poolId, days: days }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/backup", requireAuth, (req, res) => {
  try {
    res.json(backup.runBackup());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/test-premarket", requireAuth, async (req, res) => {
  try {
    var poolId = parsePoolId((req.query && req.query.pool) || (req.body && req.body.pool) || "main");
    if (!poolId) return res.status(400).json({ error: "Invalid pool" });
    await scanner.runScan(true, { quotesOnly: true });
    await discord.postSundayPremarketPool(poolId, discord.livePricesFromState());
    res.json({ ok: true, pool: poolId, message: "Sunday premarket test sent to Discord" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/scan", requireAuth, async (req, res) => {
  try {
    res.json(await scanner.runScan(true));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/toggle", requireAuth, (req, res) => {
  try {
    var { ticker, enabled, pool } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker required" });
    var poolId = parsePoolId(pool);
    if (!poolId) return res.status(400).json({ error: "Invalid pool" });
    state.toggleTicker(poolId, ticker.toUpperCase(), !!enabled);
    res.json({ ok: true, pool: poolId, tickers: state.getState(poolId).tickers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/reset-paper", requireAuth, (req, res) => {
  try {
    var poolId = parsePoolId(req.body && req.body.pool);
    if (!poolId) return res.status(400).json({ error: "Invalid pool" });
    paper.resetPortfolio(poolId);
    if (poolId === "space_dc") {
      require("./utils/spaceDcBook").seedSpaceDcBook(true);
    }
    if (poolId === "main") {
      require("./utils/mainBook").seedMainBook(true);
    }
    var pool = pools.getPool(poolId);
    state.logEvent("RESET", "Paper portfolio reset to $" + pool.startingBalance.toLocaleString("en-US"), poolId);
    res.json({ ok: true, pool: poolId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Argus Paper Stock Trader listening on port " + PORT);
  console.log("Data directory:", paths.DATA_DIR);
  pools.getAllPools().forEach(function (pool) {
    console.log("  Pool " + pool.shortLabel + ": " + pool.getTickers().length + " tickers · $" + pool.startingBalance.toLocaleString("en-US"));
  });
  if (process.env.API_KEY) console.log("API_KEY auth enabled on write endpoints");
  var flattened = scanner.flattenAllAlertOnlyPositions();
  if (flattened) console.log("[Scanner] Flattened " + flattened + " alert-only sector position(s) on startup");
  var dropped = paper.dropUnknownPositionsAllPools();
  if (dropped) console.log("[Paper] Dropped " + dropped + " unknown ticker position(s) on startup");
  var spaceDcBook = require("./utils/spaceDcBook");
  var seeded = spaceDcBook.seedSpaceDcBook();
  if (seeded && seeded.seededFromRebalance) {
    console.log("[Paper] Space DC book: " + Object.keys(seeded.positions).length + " names at April lows, cash $" + seeded.cash.toFixed(2));
  }
  var mainBook = require("./utils/mainBook");
  var mainSeeded = mainBook.seedMainBook();
  if (mainSeeded && mainSeeded.seededFromAprilLows) {
    console.log("[Paper] Main book: " + Object.keys(mainSeeded.positions).length + " names × ~$1k at April lows, cash $" + mainSeeded.cash.toFixed(2));
  }
  scanner.scheduleScanner();
  discord.scheduleDailySummary();
  discord.scheduleSundayPremarket();
  discord.scheduleWeeklyJournal();
  discord.scheduleNearMaDigest();
  backup.scheduleBackups();
});
