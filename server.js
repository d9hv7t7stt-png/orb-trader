app.get("/api/prices", async (req, res) => {
  try {
    var tickers = { "SPY": "SPY", "IWM": "IWM", "QQQ": "QQQ", "SPX": "^GSPC" };
    async function getYahooPrice(display, symbol) {
      return new Promise((resolve) => {
        var options = {
          hostname: "query1.finance.yahoo.com",
          path: "/v8/finance/chart/" + encodeURIComponent(symbol) + "?interval=1d&range=1d",
          headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
        };
        var req2 = https.request(options, (r) => {
          var raw = "";
          r.on("data", c => raw += c);
          r.on("end", () => {
            try {
              var parsed = JSON.parse(raw);
              var meta = parsed.chart && parsed.chart.result && parsed.chart.result[0] && parsed.chart.result[0].meta;
              resolve([display, {
                price: meta ? (meta.regularMarketPrice || meta.previousClose || null) : null,
                prev_close: meta ? (meta.chartPreviousClose || meta.previousClose || null) : null
              }]);
            } catch(e) { resolve([display, { price: null, prev_close: null }]); }
          });
        });
        req2.on("error", () => resolve([display, { price: null, prev_close: null }]));
        req2.end();
      });
    }
    var results = await Promise.all(Object.entries(tickers).map(([d, s]) => getYahooPrice(d, s)));
    res.json({ prices: Object.fromEntries(results) });
  } catch(e) {
    console.log("[PRICES_ERROR]", e.message);
    res.json({ prices: {} });
  }
});
