const {
  getState, resetDay, setORB, getPosition,
  openHalfPosition, addSecondHalf, markProfitTier,
  closePosition, logEvent,
} = require("../utils/state");
const { placeOrder, closePartialPosition } = require("../utils/trayd");

/*
  TradingView webhook payloads:

  ORB set (fires at 9:44 close):
  { "ticker":"SPY", "event":"orb_set", "orb_high":532.50, "orb_low":530.00 }

  5-min bar close (fires on every 5-min close after 9:44):
  { "ticker":"SPY", "event":"bar_close", "close":533.10, "option_price":2.45 }

  IWM expected move hit:
  { "ticker":"IWM", "event":"expected_move_hit", "option_price":1.80 }
*/

async function handleAlert(payload) {
  resetDay();
  const { ticker, event } = payload;
  if (!ticker || !event) throw new Error("Missing ticker or event");
  const T = ticker.toUpperCase();
  if (!["SPY", "IWM"].includes(T)) throw new Error(`Unknown ticker: ${T}`);

  // ── ORB levels set
  if (event === "orb_set") {
    const { orb_high, orb_low } = payload;
    if (!orb_high || !orb_low) throw new Error("orb_set requires orb_high and orb_low");
    setORB(T, orb_high, orb_low);
    return { ok: true, message: `ORB set for ${T}: High=${orb_high}, Low=${orb_low}, Mid=${getState().orb[T].mid}` };
  }

  // ── IWM expected move hit → sell 90%
  if (event === "expected_move_hit") {
    const pos = getPosition(T);
    if (!pos || pos.stopped) return { ok: true, message: `${T} no active position` };
    const sellQty = Math.floor(pos.contracts * 0.9);
    if (sellQty < 1) return { ok: true, message: `${T} not enough contracts to sell 90%` };
    logEvent("PROFIT_TIER_3", `${T} expected move hit → selling 90% (${sellQty} contracts)`);
    await closePartialPosition({ ticker: T, contracts: sellQty, reason: "Expected move hit — 90% exit" });
    markProfitTier(T, 3);
    return { ok: true, message: `${T} 90% profit exit executed` };
  }

  // ── 5-min bar close — main logic
  if (event === "bar_close") {
    const { close, option_price } = payload;
    if (!close) throw new Error("bar_close requires close price");
    const price = parseFloat(close);
    const optPrice = option_price ? parseFloat(option_price) : null;
    const state = getState();
    const orb = state.orb[T];

    if (!orb.set) return { ok: true, message: `${T} ORB not set yet` };

    const pos = getPosition(T);

    // ── STOP LOSS CHECK (takes priority over everything)
    if (pos && !pos.stopped) {
      const stopHit =
        (pos.side === "call" && price < orb.mid) ||
        (pos.side === "put"  && price > orb.mid);

      if (stopHit) {
        logEvent("STOP_LOSS", `${T} ${pos.side} stopped — 5-min close ${price} beyond ORB mid ${orb.mid}`);
        await closePartialPosition({ ticker: T, contracts: pos.contracts, reason: `Stop loss — closed beyond ORB midpoint` });
        closePosition(T, "stop loss");
        return { ok: true, message: `${T} stop loss triggered, full position closed` };
      }
    }

    // ── PROFIT TAKING (if position open)
    if (pos && !pos.stopped && optPrice) {
      const results = await checkProfitTiers(T, pos, optPrice);
      if (results.length > 0) return { ok: true, profitTiers: results };
    }

    // ── RETEST ADD (second half, if half position open)
    if (pos && pos.halfIn && !pos.stopped && optPrice) {
      const withinRetest = isWithinRetest(T, price, pos.side, orb);
      if (withinRetest) {
        const addContracts = pos.totalContracts; // second half = same as first half
        logEvent("RETEST", `${T} retest confirmed @ ${price} — adding ${addContracts} contracts`);
        await placeOrder({ ticker: T, side: pos.side, contracts: addContracts, orderType: "market" });
        addSecondHalf(T, addContracts, optPrice || price);
        return { ok: true, message: `${T} second half added on retest` };
      }
    }

    // ── INITIAL ENTRY (no position yet)
    if (!pos) {
      const signal = getSignal(T, price, orb);
      if (!signal) return { ok: true, message: `${T} no signal — price ${price} inside ORB` };

      const totalContracts = state.contracts[T];
      const halfContracts = Math.ceil(totalContracts / 2);

      logEvent("ENTRY", `${T} ${signal} signal @ ${price} — entering half (${halfContracts}/${totalContracts} contracts)`);
      const order = await placeOrder({ ticker: T, side: signal, contracts: halfContracts, orderType: "market" });
      openHalfPosition(T, signal, halfContracts, optPrice || price);

      // Cross-entry rule: IWM breaks before SPY
      const cross = await checkCrossEntry(T, signal, state);

      return { ok: true, entry: order, cross: cross || null };
    }

    return { ok: true, message: `${T} no action on this bar` };
  }

  throw new Error(`Unknown event: ${event}`);
}

// ── Signal detection
function getSignal(ticker, closePrice, orb) {
  if (closePrice > orb.high) return "call";
  if (closePrice < orb.low)  return "put";
  return null;
}

// ── Retest detection
function isWithinRetest(ticker, closePrice, side, orb) {
  const threshold = side === "call" ? orb.high : orb.low;
  const pct = Math.abs(closePrice - threshold) / threshold;
  if (pct > 0.001) return false; // outside 0.1%

  // Must bounce in the correct direction
  if (side === "call" && closePrice >= threshold * 0.999) return true;
  if (side === "put"  && closePrice <= threshold * 1.001) return true;
  return false;
}

// ── Profit tier logic
async function checkProfitTiers(ticker, pos, currentOptionPrice) {
  const results = [];
  const gainPct = ((currentOptionPrice - pos.entryPrice) / pos.entryPrice) * 100;
  const tier = pos.lastProfitTier;

  // Tier 1: every +20% → sell 10%
  // We track how many 20% increments have occurred
  const twentyPctIncrements = Math.floor(gainPct / 20);
  if (twentyPctIncrements > tier && gainPct < 100) {
    const sellQty = Math.max(1, Math.floor(pos.contracts * 0.10));
    logEvent("PROFIT_TIER_1", `${ticker} +${gainPct.toFixed(1)}% → selling 10% (${sellQty} contracts)`);
    await closePartialPosition({ ticker, contracts: sellQty, reason: `+20% profit tier — sell 10%` });
    markProfitTier(ticker, twentyPctIncrements);
    results.push({ tier: 1, sold: sellQty, gainPct });
  }

  // Tier 2: +100% → sell 50%
  if (gainPct >= 100 && tier < 100) {
    const sellQty = Math.max(1, Math.floor(pos.contracts * 0.50));
    logEvent("PROFIT_TIER_2", `${ticker} +100% → selling 50% (${sellQty} contracts)`);
    await closePartialPosition({ ticker, contracts: sellQty, reason: `+100% profit tier — sell 50%` });
    markProfitTier(ticker, 100);
    results.push({ tier: 2, sold: sellQty, gainPct });
  }

  return results;
}

// ── Cross-entry: IWM breaks before SPY
async function checkCrossEntry(breakoutTicker, direction, state) {
  if (breakoutTicker !== "IWM") return null;
  if (getPosition("SPY")) return null;
  if (!state.orb.SPY.set) return null;

  const spyORB = state.orb.SPY;
  const contracts = Math.ceil(state.contracts.SPY / 2); // half position
  const stopLevel = direction === "call" ? spyORB.low : spyORB.high;

  logEvent("CROSS_ENTRY", `IWM broke ${direction} first → entering SPY ${direction} half (${contracts} contracts) | stop: ${stopLevel}`);
  const order = await placeOrder({ ticker: "SPY", side: direction, contracts, orderType: "market" });
  openHalfPosition("SPY", direction, contracts, null);
  return { order, stopLevel };
}

module.exports = { handleAlert };
