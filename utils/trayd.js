var rh = require("./robinhood");

function getSwingExpiry() {
  var tradingDays = 0;
  var current = new Date();
  current.setDate(current.getDate() + 1);

  var bestExpiry = null;
  var closestTo10 = null;
  var closestDiff = 999;

  while (tradingDays <= 20) {
    var day = current.getDay();
    if (day !== 0 && day !== 6) {
      tradingDays++;

      if (tradingDays >= 10 && tradingDays <= 14) {
        var dateStr = current.toISOString().split("T")[0];
        if (day === 5 || day === 1) {
          if (!bestExpiry) bestExpiry = dateStr;
        }
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

function getOTMStrike(ticker, currentPrice, side) {
  if (ticker === "SPXW") {
    if (side === "call") {
      return Math.ceil((currentPrice + 1) / 50) * 50;
    }
    return Math.floor((currentPrice - 1) / 50) * 50;
  }

  if (side === "call") {
    return Math.round(currentPrice) + 4;
  }
  return Math.round(currentPrice) - 4;
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
