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

process.on("unhandledRejection", (err) => {
  console.error("[UNHANDLED_REJECTION]", err && err.message ? err.message : err);
});

function requireAuth(req, res, next) {
  var key = process.env.API_KEY;
  if (!key) return next();
  var provided = req.headers["x-api-key"] || req.query.api_key;
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
      return { id: p.id, label: p.shortLabel, balance: p.startingBalance };
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
  var p = paper.getPortfolio(poolId);
  var livePrices = {};
  Object.values(s.scanResults || {}).forEach(function (r) {
    if (r && r.price) livePrices[r.ticker] = { price: r.price };
  });
  var unreal = paper.getUnrealizedPnL(poolId, livePrices);
  var equity = paper.getEquity(poolId, livePrices);

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
    startingBalance: p.startingBalance,
    state: s,
    portfolio: {
      cash: p.cash,
      startingBalance: p.startingBalance,
      equity: equity,
      unrealized: unreal.total,
      open_positions: Object.keys(p.positions).length,
      wins: p.wins,
      losses: p.losses
    },
    positions: unreal.details,
    pnl: paper.getPnlSummary(poolId),
    near_hits: nearHits,
    tickers: pool.getTickers(),
    trade_size: paper.getPositionSizeUSD(poolId, livePrices)
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
      portfolio: poolOverview.portfolio,
      positions: poolOverview.positions,
      pnl: poolOverview.pnl,
      near_hits: poolOverview.near_hits,
      tickers: poolOverview.tickers,
      ma_levels: tickers.MA_LEVELS,
      alert_only: tickers.SECTOR_SPDR,
      proximity_pct: tickers.PROXIMITY_PCT * 100,
      risk_pct: tickers.RISK_PCT * 100,
      trade_size: poolOverview.trade_size,
      strategy: {
        data_source: "Yahoo Finance",
        entry: "Paper buy when price within " + (tickers.PROXIMITY_PCT * 100) + "% of any monitored MA (one position per ticker per pool). Sector SPDRs (XLC–XLU) are watch-only — Discord alerts, no paper trades.",
        sizing: (tickers.RISK_PCT * 100) + "% of equity per entry (~" + formatUsd(poolOverview.trade_size) + " at current equity)",
        exit: "Stop loss when daily close is below 55-Day SMA",
        take_profit: tickers.TAKE_PROFIT_TIERS.map(function (t) { return t.label; }).join(" → "),
        levels: tickers.MA_LEVELS.map(function (l) { return l.label; }),
        account: pools.getAllPools().map(function (p) {
          return p.shortLabel + " $" + p.startingBalance.toLocaleString("en-US");
        }).join(" + "),
        discord_roles: {
          DISCORD_ROLE_ENTRIES: "Ping on paper buys (e.g. @Traders)",
          DISCORD_ROLE_STOPS: "Ping on stop-loss exits (e.g. @Risk)",
          DISCORD_ROLE_TAKEPROFIT: "Ping on take-profit sells (e.g. @Profits)",
          DISCORD_ROLE_PROXIMITY: "Ping on MA proximity alerts (e.g. @Alerts)",
          DISCORD_ROLE_DAILY: "Ping on after-the-bell P&L (e.g. @Daily)",
          DISCORD_ROLE_ALERTS: "Fallback ping for all alert types"
        }
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function formatUsd(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

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
  scanner.scheduleScanner();
  discord.scheduleDailySummary();
});
