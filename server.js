const express = require("express");
const path = require("path");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "dashboard")));

const { handleAlert } = require("./routes/alert");
const { getState, setContractSize, toggleTicker } = require("./utils/state");
const { ensureLoggedIn, submitSmsCode, getPendingWorkflow, scheduleDailyReauth } = require("./utils/reauth");
const rh = require("./utils/robinhood");
const discord = require("./utils/discord");

// PWA files
app.get("/manifest.json", (req, res) => res.sendFile(path.join(__dirname, "dashboard", "manifest.json")));
app.get("/sw.js", (req, res) => { res.setHeader("Service-Worker-Allowed", "/"); res.sendFile(path.join(__dirname, "dashboard", "sw.js")); });
app.get("/icon.svg", (req, res) => res.sendFile(path.join(__dirname, "dashboard", "icon.svg")));

app.get("/health", (req, res) => {
  res.json({ status: "running", time: new Date().toISOString(), auth: rh.getToken() ? "connected" : "disconnected" });
});

app.get("/api/state", (req, res) => {
  var s = getState();
  s.auth = { logged_in: !!rh.getToken(), pending: !!getPendingWorkflow() };
  res.json(s);
});

app.post("/api/reauth", async (req, res) => {
  rh.setToken(null);
  var ok = await ensureLoggedIn();
  var pending = getPendingWorkflow();
  res.json({ ok: ok, pending_type: pending ? pending.challenge_type : null, message: ok ? "Connected" : "Login failed" });
});

app.post("/api/sms", async (req, res) => {
  var code = req.body.code;
  if (!code) return res.status(400).json({ error: "code required" });
  res.json(await submitSmsCode(code));
});

app.post("/api/contracts", (req, res) => {
  var data = req.body;
  ["SPY","SPXW","IWM","QQQ"].forEach(function(t) {
    if (data[t] !== undefined) setContractSize(t, data[t]);
  });
  res.json({ ok: true, contracts: getState().contracts });
});

app.post("/api/toggle", (req, res) => {
  var { ticker, enabled } = req.body;
  if (!ticker) return res.status(400).json({ error: "ticker required" });
  toggleTicker(ticker.toUpperCase(), !!enabled);
  res.json({ ok: true, tickers: getState().tickers });
});

// Test Discord
app.get("/test/discord/:type", async (req, res) => {
  var type = req.params.type;
  if (type === "20") await discord.postGoodMorning(20);
  if (type === "5")  await discord.postGoodMorning(5);
  if (type === "1")  await discord.postGoodMorning(1);
  if (type === "summary") await discord.postDailySummary();
  if (type === "entry") await discord.postSwingEntry("SPY", "call", 761, "2026-06-20", 3.40, 2);
  if (type === "flip") await discord.postSwingFlip("SPY", "call", "put", 753, "2026-06-20", 2.80, 2);
  if (type === "stop") await discord.postSwingClose("SPY", 2.10, -1300, -19.1, "Stop Loss");
  if (type === "profit") await discord.postProfitTier("SPY", "+20% Tier — Sell 10%", 1, 4.08, 20);
  res.json({ ok: true, tested: type });
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

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "dashboard", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log("Argus Swing Trader listening on port " + PORT);
  await ensureLoggedIn();
  scheduleDailyReauth();
  discord.scheduleMarketOpenMessages();
  discord.scheduleDailySummary();
});
