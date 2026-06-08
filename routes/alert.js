var stateModule = require("../utils/state");
var trayd = require("../utils/trayd");
var discord = require("../utils/discord");

/*
  TradingView webhook payloads:

  30-min bar close (fires on every 30-min bar):
  {"ticker":"SPY","event":"bar_close","close":757.50,"sma55":754.20,"option_price":3.40}

  Weekly expected move hit:
  {"ticker":"SPY","event":"weekly_move_hit","option_price":5.20}
*/

async function handleAlert(payload) {
  var ticker = ((payload.ticker) || "").toUpperCase();
  var event = payload.event;

  if (!ticker || !event) throw new Error("Missing ticker or event");
  if (!["SPY","SPXW","IWM","QQQ"].includes(ticker)) throw new Error("Unknown ticker: " + ticker);

  var s = stateModule.getState();

  // Skip if ticker is disabled
  if (!s.tickers[ticker]) {
    return { ok: true, message: ticker + " is disabled" };
  }

  // ── Weekly expected move hit → sell 30%
  if (event === "weekly_move_hit") {
    var pos = stateModule.getPosition(ticker);
    if (!pos || pos.stopped || pos.weeklyMoveSold) return { ok: true, message: ticker + " no active position or already sold" };
    var qty = Math.max(1, Math.floor(pos.contracts * 0.30));
    stateModule.logEvent("WEEKLY_MOVE", ticker + " weekly move hit, selling 30% (" + qty + "c)");
    await trayd.closeSwingPosition(ticker, qty, "Weekly expected move — sell 30%");
    stateModule.updatePosition(ticker, { contracts: pos.contracts - qty, weeklyMoveSold: true });
    var optPrice = payload.option_price ? parseFloat(payload.option_price) : pos.entryPrice * 1.3;
    var gain = ((optPrice - pos.entryPrice) / pos.entryPrice) * 100;
    discord.postProfitTier(ticker, "Weekly Move — Sell 30%", qty, optPrice, gain).catch(function(){});
    return { ok: true, message: ticker + " 30% sold at weekly move" };
  }

  // ── 30-min bar close — main logic
  if (event === "bar_close") {
    var close = parseFloat(payload.close);
    var sma55 = parseFloat(payload.sma55);
    var optPrice = payload.option_price ? parseFloat(payload.option_price) : null;

    if (!close || !sma55) throw new Error("bar_close requires close and sma55");

    var pos = stateModule.getPosition(ticker);

    // ── SMA signal
    var aboveSMA = close > sma55;
    var belowSMA = close < sma55;

    // ── STOP LOSS CHECK (price-based stop after breakeven activated)
    if (pos && !pos.stopped && pos.stopLevel !== null && optPrice) {
      var stopHit = optPrice <= pos.stopLevel;
      if (stopHit) {
        stateModule.logEvent("STOP_HIT", ticker + " stop hit @ $" + optPrice + " stop=$" + pos.stopLevel);
        await trayd.closeSwingPosition(ticker, pos.contracts, "Stop loss hit");
        var pnl = (optPrice - pos.entryPrice) * pos.contracts * 100;
        var pct = ((optPrice - pos.entryPrice) / pos.entryPrice) * 100;
        discord.postSwingClose(ticker, optPrice, pnl, pct, "Stop Loss").catch(function(){});
        stateModule.closePosition(ticker, "stop loss");
        return { ok: true, message: ticker + " stopped out" };
      }
    }

    // ── SMA-based exit (no breakeven yet — original stop)
    if (pos && !pos.stopped && pos.stopLevel === null) {
      var smaExit = (pos.side === "call" && belowSMA) || (pos.side === "put" && aboveSMA);
      if (smaExit) {
        stateModule.logEvent("SMA_EXIT", ticker + " SMA exit: close=" + close + " sma=" + sma55);
        await trayd.closeSwingPosition(ticker, pos.contracts, "SMA crossover exit");
        var exitPrice = optPrice || pos.entryPrice * 0.8;
        var exitPnl = (exitPrice - pos.entryPrice) * pos.contracts * 100;
        var exitPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        discord.postSwingClose(ticker, exitPrice, exitPnl, exitPct, "SMA Crossover Exit").catch(function(){});
        stateModule.closePosition(ticker, "SMA exit");
        pos = null; // fall through to open new position
      }
    }

    // ── PROFIT TIERS (if position open and we have option price)
    if (pos && !pos.stopped && optPrice && pos.entryPrice > 0) {
      var gainPct = ((optPrice - pos.entryPrice) / pos.entryPrice) * 100;

      // Stop ratchet: +50% → breakeven, every +50% after → stop moves up 40%
      if (gainPct >= 50) {
        var stopMultiplier = Math.floor(gainPct / 50);
        var newStop;
        if (stopMultiplier === 1) {
          newStop = pos.entryPrice; // breakeven
        } else {
          newStop = pos.entryPrice * (1 + (stopMultiplier - 1) * 0.40);
        }
        if (!pos.stopLevel || newStop > pos.stopLevel) {
          stateModule.updatePosition(ticker, { stopLevel: newStop, breakEvenActivated: true });
          stateModule.logEvent("STOP_RATCHET", ticker + " stop moved to $" + newStop.toFixed(2) + " (+" + gainPct.toFixed(0) + "%)");
          discord.postBreakeven(ticker, newStop).catch(function(){});
        }
      }

      // Every +20% → sell 10%
      var twentyIncrements = Math.floor(gainPct / 20);
      if (twentyIncrements > pos.lastProfitTier && gainPct < 100) {
        var sell10 = Math.max(1, Math.floor(pos.contracts * 0.10));
        stateModule.logEvent("PROFIT_20", ticker + " +" + gainPct.toFixed(1) + "% selling 10% (" + sell10 + "c)");
        await trayd.closeSwingPosition(ticker, sell10, "+20% sell 10%");
        stateModule.updatePosition(ticker, { contracts: pos.contracts - sell10, lastProfitTier: twentyIncrements });
        discord.postProfitTier(ticker, "+20% Tier — Sell 10%", sell10, optPrice, gainPct).catch(function(){});
      }

      // +100% → sell 50%
      if (gainPct >= 100 && !pos.hundredPctSold) {
        var sell50 = Math.max(1, Math.floor(pos.contracts * 0.50));
        stateModule.logEvent("PROFIT_100", ticker + " +100% selling 50% (" + sell50 + "c)");
        await trayd.closeSwingPosition(ticker, sell50, "+100% sell 50%");
        stateModule.updatePosition(ticker, { contracts: pos.contracts - sell50, hundredPctSold: true });
        discord.postProfitTier(ticker, "+100% — Sell 50%", sell50, optPrice, gainPct).catch(function(){});
      }
    }

    // ── ENTRY / FLIP LOGIC
    var newSignal = aboveSMA ? "call" : belowSMA ? "put" : null;

    if (newSignal && (!pos || pos.stopped)) {
      // Fresh entry
      var contracts = s.contracts[ticker];
      var expiry = trayd.getSwingExpiry();
      var strike = trayd.getOTMStrike(ticker, close, newSignal);

      stateModule.logEvent("ENTRY", ticker + " " + newSignal + " @ " + close + " sma=" + sma55 + " strike=" + strike + " exp=" + expiry);
      var order = await trayd.placeSwingOrder(ticker, newSignal, contracts);
      stateModule.openPosition(ticker, newSignal, contracts, optPrice || close, strike, expiry);

      if (optPrice) discord.postSwingEntry(ticker, newSignal, strike, expiry, optPrice, contracts).catch(function(){});
      return { ok: true, entry: order };
    }

    if (newSignal && pos && !pos.stopped && newSignal !== pos.side) {
      // Flip — close current, open opposite
      var oldSide = pos.side;
      stateModule.logEvent("FLIP", ticker + " flipping " + oldSide + " → " + newSignal);

      await trayd.closeSwingPosition(ticker, pos.contracts, "SMA flip — close " + oldSide);
      var flipPrice = optPrice || pos.entryPrice;
      var flipPnl = (flipPrice - pos.entryPrice) * pos.contracts * 100;
      var flipPct = ((flipPrice - pos.entryPrice) / pos.entryPrice) * 100;
      discord.postSwingClose(ticker, flipPrice, flipPnl, flipPct, "SMA Flip").catch(function(){});
      stateModule.closePosition(ticker, "SMA flip");

      // Open new side
      var flipContracts = s.contracts[ticker];
      var flipExpiry = trayd.getSwingExpiry();
      var flipStrike = trayd.getOTMStrike(ticker, close, newSignal);

      var flipOrder = await trayd.placeSwingOrder(ticker, newSignal, flipContracts);
      stateModule.openPosition(ticker, newSignal, flipContracts, optPrice || close, flipStrike, flipExpiry);

      if (optPrice) discord.postSwingFlip(ticker, oldSide, newSignal, flipStrike, flipExpiry, optPrice, flipContracts).catch(function(){});
      return { ok: true, flip: flipOrder };
    }

    return { ok: true, message: ticker + " no action this bar" };
  }

  throw new Error("Unknown event: " + event);
}

module.exports = { handleAlert: handleAlert };
