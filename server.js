const express = require("express");
const path = require("path");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "dashboard")));

const { handleAlert } = require("./routes/alert");
const { getState, setContractSize } = require("./utils/state");
const { ensureLoggedIn, submitSmsCode, getPendingWorkflow, scheduleDailyReauth } = require("./utils/reauth");
const rh = require("./utils/robinhood");
const discord = require("./utils/discord");

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

app.get("/api/buying-power", async (req, res) => {
  try {
    var token = rh.getToken();
    if (!token) return res.json({ buying_power: null });
    var https = require("https");
    var data = await new Promise((resolve, reject) => {
      var options = {
        hostname: "api.robinhood.com",
        path: "/accounts/" + process.env.RH_ACCOUNT_NUMBER + "/",
        headers: { "Authorization": "Bearer " + token, "Accept": "application/json" }
      };
      var req2 = https.request(options, (r) => {
        var raw = ""; r.on("data", c => raw += c);
        r.on("end", () => { try { resolve(J
