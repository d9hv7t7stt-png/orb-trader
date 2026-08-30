// Signal engine — supports legacy (close vs 55 SMA) or EMA21 + SMA55 stack mode.

function getSignal(close, sma55, ema21) {
  if (ema21 != null && !isNaN(ema21)) {
    if (close > ema21 && ema21 > sma55) return "call";
    if (close < ema21 && ema21 < sma55) return "put";
    return null;
  }
  if (close > sma55) return "call";
  if (close < sma55) return "put";
  return null;
}

function shouldSmaExit(side, close, sma55, ema21) {
  if (side === "call") {
    if (close < sma55) return true;
    if (ema21 != null && !isNaN(ema21) && ema21 < sma55) return true;
    return false;
  }
  if (side === "put") {
    if (close > sma55) return true;
    if (ema21 != null && !isNaN(ema21) && ema21 > sma55) return true;
    return false;
  }
  return false;
}

function describeSignal(close, sma55, ema21) {
  var signal = getSignal(close, sma55, ema21);
  var mode = (ema21 != null && !isNaN(ema21)) ? "ema21_sma55" : "sma55";
  return {
    mode: mode,
    signal: signal,
    bullish: signal === "call",
    bearish: signal === "put",
    neutral: signal === null
  };
}

module.exports = { getSignal, shouldSmaExit, describeSignal };
