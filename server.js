const express = require("express");
const path = require("path");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "dashboard")));

const state = require("./utils/state");
const paper = require("./utils/paper");
const tickers = require("./utils/tickers");
const scanner = require("./utils/scanner");
const discord = require("./utils/discord");

process.on("unhandledRejection", (err) => {
  console.error("[UNHANDLED_REJECTION]", err && err.message ? err.message : err);
});

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

app.get("/health", (req, res) => {
  res.json({
    status: "running",
    mode: "paper_stock",
    time: new Date().toISOString()
  });
});

app.get("/api/state", (req, res) => {
  res.json(state.getState());
});

app.get("/api/overview", async (req, res) => {
  try {
    var s = state.getState();
    var p = paper.getPortfolio();
    var livePrices = {};
    Object.values(s.scanResults || {}).forEach(function (r) {
      if (r && r.price) livePrices[r.ticker] = { price: r.price };
    });
    var unreal = paper.getUnrealizedPnL(livePrices);
    var equity = paper.getEquity(livePrices);

    var nearHits = [];
    Object.values(s.scanResults || {}).forEach(function (r) {
      if (!r || !r.levels) return;
      r.levels.filter(function (l) { return l.near; }).forEach(function (l) {
        nearHits.push({
          ticker: r.ticker,
          price: r.price,
          level: l.label,
          ma: l.value,
          proximity_pct: l.proximity_pct
        });
      });
    });

    res.json({
      mode: "paper_stock",
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
      pnl: paper.getPnlSummary(),
      near_hits: nearHits,
      tickers: tickers.getAllTickers(),
      ma_levels: tickers.MA_LEVELS,
      proximity_pct: tickers.PROXIMITY_PCT * 100,
      risk_pct: tickers.RISK_PCT * 100,
      trade_size: paper.getPositionSizeUSD(livePrices),
      strategy: {
        data_source: "Yahoo Finance",
        entry: "Paper buy when price within " + (tickers.PROXIMITY_PCT * 100) + "% of any monitored MA",
        sizing: (tickers.RISK_PCT * 100) + "% of equity per entry (~" + formatUsd(paper.getPositionSizeUSD(livePrices)) + " at current equity)",
        exit: "Stop loss when price closes below 55-Day SMA",
        levels: tickers.MA_LEVELS.map(function (l) { return l.label; }),
        account: "$50,000 paper",
        discord_roles: {
          DISCORD_ROLE_ENTRIES: "Ping on paper buys (e.g. @Traders)",
          DISCORD_ROLE_STOPS: "Ping on stop-loss exits (e.g. @Risk)",
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

app.post("/api/scan", async (req, res) => {
  try {
    res.json(await scanner.runScan(true));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/toggle", (req, res) => {
  try {
    var { ticker, enabled } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker required" });
    state.toggleTicker(ticker.toUpperCase(), !!enabled);
    res.json({ ok: true, tickers: state.getState().tickers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/reset-paper", (req, res) => {
  paper.resetPortfolio();
  state.logEvent("RESET", "Paper portfolio reset to $50,000");
  res.json({ ok: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Argus Paper Stock Trader listening on port " + PORT);
  console.log("Watchlist: " + tickers.getAllTickers().length + " tickers · $" + tickers.STARTING_BALANCE + " paper account");
  scanner.scheduleScanner();
  discord.scheduleDailySummary();
});
