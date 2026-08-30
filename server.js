const express = require("express");
const path = require("path");
const https = require("https");
const fs = require("fs");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "dashboard")));

const { handleAlert } = require("./routes/alert");
const { getState, setContractSize, toggleTicker } = require("./utils/state");
const { ensureLoggedIn, submitSmsCode, getPendingWorkflow, scheduleDailyReauth } = require("./utils/reauth");
const rh = require("./utils/robinhood");
const discord = require("./utils/discord");
const market = require("./utils/market");

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
    time: new Date().toISOString(),
    auth: rh.getToken() ? "connected" : "disconnected"
  });
});

app.get("/api/state", (req, res) => {
  var s = getState();
  s.auth = { logged_in: !!rh.getToken(), pending: !!getPendingWorkflow() };
  res.json(s);
});

app.get("/api/buying-power", async (req, res) => {
  try {
    var token = rh.getToken();
    if (!token) return res.json({ buying_power: null });

    var data = await new Promise((resolve) => {
      var opts = {
        hostname: "api.robinhood.com",
        path: "/accounts/" + (process.env.RH_ACCOUNT_NUMBER || "") + "/",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json",
          "X-Robinhood-API-Version": "1.431.4",
          "User-Agent": "Robinhood/823 (iPhone; iOS 16.0; Scale/3.00)"
        }
      };
      var req3 = https.request(opts, (r) => {
        var raw = "";
        r.on("data", (c) => { raw += c; });
        r.on("end", () => {
          try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
        });
      });
      req3.on("error", () => resolve({}));
      req3.end();
    });
    res.json({ buying_power: data.buying_power || data.cash || null });
  } catch (e) {
    console.log("[BUYING_POWER_ERROR]", e.message);
    res.json({ buying_power: null });
  }
});

app.get("/api/prices", async (req, res) => {
  try {
    res.json({ prices: await market.fetchPrices() });
  } catch (e) {
    console.log("[PRICES_ERROR]", e.message);
    res.json({ prices: {} });
  }
});

app.get("/api/pnl", (req, res) => {
  res.json(market.getPnlSummary());
});

app.get("/api/overview", async (req, res) => {
  try {
    var s = getState();
    s.auth = { logged_in: !!rh.getToken(), pending: !!getPendingWorkflow() };
    var openCount = Object.values(s.positions).filter(function (p) { return p && !p.stopped; }).length;
    var buyingPower = null;
    if (rh.getToken()) {
      try {
        var bpRes = await new Promise(function (resolve) {
          var opts = {
            hostname: "api.robinhood.com",
            path: "/accounts/" + (process.env.RH_ACCOUNT_NUMBER || "") + "/",
            headers: {
              Authorization: "Bearer " + rh.getToken(),
              Accept: "application/json",
              "X-Robinhood-API-Version": "1.431.4",
              "User-Agent": "Robinhood/823 (iPhone; iOS 16.0; Scale/3.00)"
            }
          };
          var req3 = https.request(opts, function (r) {
            var raw = "";
            r.on("data", function (c) { raw += c; });
            r.on("end", function () {
              try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
            });
          });
          req3.on("error", function () { resolve({}); });
          req3.end();
        });
        buyingPower = bpRes.buying_power || bpRes.cash || null;
      } catch (e) {}
    }
    res.json({
      state: s,
      prices: await market.fetchPrices(),
      pnl: market.getPnlSummary(),
      buying_power: buyingPower,
      open_positions: openCount,
      webhook_url: (req.protocol + "://" + req.get("host") + "/webhook").replace("http://", "https://"),
      strategy: {
        timeframe: "30-minute bar close (TradingView alert)",
        modes: {
          sma55: {
            entry_call: "Close > 55 SMA",
            entry_put: "Close < 55 SMA",
            exit: "Close crosses back through 55 SMA"
          },
          ema21_sma55: {
            entry_call: "Close > 21 EMA AND 21 EMA > 55 SMA",
            entry_put: "Close < 21 EMA AND 21 EMA < 55 SMA",
            exit: "Close crosses 55 SMA OR 21 EMA crosses 55 SMA against position"
          }
        },
        profit: [
          "Every +20% option gain → sell 10% of contracts",
          "+100% gain → sell 50% of remaining",
          "Weekly expected move hit → sell 30%"
        ],
        stops: [
          "+50% gain → stop moves to breakeven",
          "Every additional +50% → stop ratchets up 40% of entry"
        ]
      }
    });
  } catch (e) {
    console.log("[OVERVIEW_ERROR]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/reauth", async (req, res) => {
  try {
    rh.setToken(null);
    var ok = await ensureLoggedIn();
    var pending = getPendingWorkflow();
    res.json({
      ok: ok,
      pending_type: pending ? pending.challenge_type : null,
      message: ok ? "Connected to Robinhood" : pending ? "Check phone or enter SMS code" : "Login failed — check Railway logs"
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sms", async (req, res) => {
  try {
    var code = req.body.code;
    if (!code) return res.status(400).json({ error: "code required" });
    res.json(await submitSmsCode(code));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/contracts", (req, res) => {
  try {
    var data = req.body;
    ["SPY", "SPXW", "IWM", "QQQ"].forEach(function (t) {
      if (data[t] !== undefined) setContractSize(t, data[t]);
    });
    res.json({ ok: true, contracts: getState().contracts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/toggle", (req, res) => {
  try {
    var { ticker, enabled } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker required" });
    toggleTicker(ticker.toUpperCase(), !!enabled);
    res.json({ ok: true, tickers: getState().tickers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/test/discord/:type", async (req, res) => {
  try {
    var type = req.params.type;
    if (type === "45") await discord.postGoodMorning(45);
    if (type === "20") await discord.postGoodMorning(20);
    if (type === "5") await discord.postGoodMorning(5);
    if (type === "1") await discord.postGoodMorning(1);
    if (type === "summary") await discord.postDailySummary();
    if (type === "positions") await discord.postOpenPositions("Test");
    if (type === "entry") await discord.postSwingEntry("SPY", "call", 761, "2026-06-20", 3.40, 2);
    if (type === "flip") await discord.postSwingFlip("SPY", "call", "put", 753, "2026-06-20", 2.80, 2);
    if (type === "stop") await discord.postSwingClose("SPY", 2.10, -1300, -19.1, "Stop Loss");
    if (type === "profit") await discord.postProfitTier("SPY", "+20% Tier — Sell 10%", 1, 4.08, 20);
    res.json({ ok: true, tested: type });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/webhook", async (req, res) => {
  console.log("[WEBHOOK]", JSON.stringify(req.body));
  if (!rh.getToken()) {
    var ok = await ensureLoggedIn();
    if (!ok) return res.status(403).json({ error: "Not connected to Robinhood" });
  }
  try {
    res.json(await handleAlert(req.body));
  } catch (err) {
    console.error("[ERROR]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log("Argus Swing Trader listening on port " + PORT);
  await ensureLoggedIn();
  scheduleDailyReauth();
  discord.scheduleDailySummary();
  discord.scheduleMarketOpenMessages();
  discord.schedulePositionUpdates();
});
