var rh = require("./robinhood");
var stateModule = require("./state");

// Get target expiry — prefer Friday/Monday, min 10 sessions, max 14 sessions
function getSwingExpiry() {
  var now = new Date();
  var tradingDays = 0;
  var current = new Date(now);
  current.setDate(current.getDate() + 1); // start from tomorrow

  var bestExpiry = null;
  var closestTo10 = null;
  var closestDiff = 999;

  while (tradingDays <= 20) {
    var day = current.getDay();
    // Skip weekends
    if (day !== 0 && day !== 6) {
      tradingDays++;

      if (tradingDays >= 10 && tradingDays <= 14) {
        var dateStr = current.toISOString().split("T")[0];
        // Prefer Friday (5) or Monday (1)
        if (day === 5 || day === 1) {
          if (!bestExpiry) bestExpiry = dateStr;
        }
        // Track closest to 10 days as fallback
        var diff = Math.abs(tradingDays - 10);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestTo10 = dateStr;
        }
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return bestExpiry || closestTo10;
}

// Calculate OTM strike
function getOTMStrike(ticker, currentPrice, side) {
  if (ticker === "SPXW") {
    // Round to nearest $50 OTM
    if (side === "call") {
      return Math.ceil((currentPrice + 1) / 50) * 50;
    } else {
      return Math.floor((currentPrice - 1) / 50) * 50;
    }
  } else {
    // SPY, IWM, QQQ — 4 strikes at $1 increments
    if (side === "call") {
      return Math.round(currentPrice) + 4;
    } else {
      return Math.round(currentPrice) - 4;
    }
  }
}

async function callTrayd(message) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  var MCP_URL = "https://mcp.trayd.ai/mcp";
  var res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: message }],
      mcp_servers: [{ type: "url", url: MCP_URL, name: "trayd" }]
    })
  });
  var data = await res.json();
  var block = data.content && data.content.find(function(b) { return b.type === "mcp_tool_result"; });
  if (block && block.content && block.content[0]) {
    try { return JSON.parse(block.content[0].text); } catch(e) { return { raw: block.content[0].text }; }
  }
  return { message: "no result" };
}

async function placeSwingOrder(ticker, side, contracts) {
  var expiry = getSwingExpiry();
  var price = await rh.getQuote(ticker === "SPXW" ? "SPX" : ticker);
  var strike = getOTMStrike(ticker, price, side);
  var optionType = side === "call" ? "call" : "put";
  var rhTicker = ticker === "SPXW" ? "SPXW" : ticker;

  console.log("[SWING_ORDER] " + ticker + " " + optionType + " x" + contracts + " strike=" + strike + " expiry=" + expiry);

  var result = await rh.placeOptionOrder(rhTicker, side, contracts, expiry, strike, optionType);
  return { ticker: ticker, side: optionType, strike: strike, expiry: expiry, contracts: contracts, result: result };
}

async function closeSwingPosition(ticker, contracts, reason) {
  console.log("[SWING_CLOSE] " + ticker + " selling " + contracts + "c: " + reason);
  var result = await rh.closeOptionPosition(ticker === "SPXW" ? "SPXW" : ticker, contracts, reason);
  return { ticker: ticker, contracts: contracts, reason: reason, result: result };
}

module.exports = {
  placeSwingOrder: placeSwingOrder,
  closeSwingPosition: closeSwingPosition,
  getSwingExpiry: getSwingExpiry,
  getOTMStrike: getOTMStrike
};
