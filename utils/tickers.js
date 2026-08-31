// Watchlist — Yahoo Finance symbols
// SPXW maps to S&P 500 index; sector ETFs are State Street SPDR Select Sector funds

var CORE = [
  "SPY", "SPXW", "QQQ", "IWM",
  "AAPL", "AMZN", "META", "NVDA", "MSFT", "TSLA", "GOOG",
  "GLD", "SLV", "SMH", "SPCX"
];

// User requested DRAM — also include MU (Micron) as DRAM sector proxy if DRAM illiquid
var EXTRA = ["DRAM", "MU"];

var MAG7 = ["AAPL", "AMZN", "GOOG", "META", "MSFT", "NVDA", "TSLA"];

// Sunday briefing Near MA list: indexes, Mag7, metals, then sector SPDRs A–Z
var BRIEFING_DAILY_MA_KEYS = ["d_ema21", "d_sma55"];
var BRIEFING_DISPLAY_NAMES = { SPXW: "SPX" };
var MAIN_BRIEFING_ORDER = ["SPXW", "SPY", "QQQ", "IWM"]
  .concat(MAG7)
  .concat(["SPCX", "GLD", "SLV"]);

var SECTOR_SPDR = [
  "XLC",  // Communication Services
  "XLY",  // Consumer Discretionary
  "XLP",  // Consumer Staples
  "XLE",  // Energy
  "XLF",  // Financials
  "XLV",  // Health Care
  "XLI",  // Industrials
  "XLB",  // Materials
  "XLRE", // Real Estate
  "XLK",  // Technology
  "XLU"   // Utilities
];

// Map display ticker → Yahoo symbol
var YAHOO_MAP = {
  SPXW: "^GSPC"
};

function getAllTickers() {
  var seen = {};
  var list = CORE.concat(EXTRA).concat(SECTOR_SPDR);
  return list.filter(function (t) {
    if (seen[t]) return false;
    seen[t] = true;
    return true;
  });
}

function isAlertOnly(ticker) {
  return SECTOR_SPDR.indexOf(ticker) !== -1;
}

function getYahooSymbol(ticker) {
  return YAHOO_MAP[ticker] || ticker;
}

function getDisplayTicker(ticker) {
  return BRIEFING_DISPLAY_NAMES[ticker] || ticker;
}

function briefingRank(ticker) {
  var i = MAIN_BRIEFING_ORDER.indexOf(ticker);
  if (i !== -1) return i;
  if (isAlertOnly(ticker)) {
    var sectors = SECTOR_SPDR.slice().sort();
    var si = sectors.indexOf(ticker);
    return 1000 + (si < 0 ? 99 : si);
  }
  return 500;
}

function isBriefingTicker(ticker) {
  return MAIN_BRIEFING_ORDER.indexOf(ticker) !== -1 || isAlertOnly(ticker);
}

function getMainBriefingTickers() {
  var seen = {};
  var list = MAIN_BRIEFING_ORDER.concat(SECTOR_SPDR.slice().sort());
  return list.filter(function (t) {
    if (seen[t]) return false;
    seen[t] = true;
    return true;
  });
}

function isBriefingMa(level) {
  var key = level && (level.key || level.maKey);
  return BRIEFING_DAILY_MA_KEYS.indexOf(key) !== -1;
}

function getDisplayName(ticker) {
  var names = {
    SPY: "S&P 500 ETF", SPXW: "S&P 500 Index", QQQ: "Nasdaq 100", IWM: "Russell 2000",
    XLC: "Comm Services", XLY: "Cons Disc", XLP: "Cons Staples", XLE: "Energy",
    XLF: "Financials", XLV: "Health Care", XLI: "Industrials", XLB: "Materials",
    XLRE: "Real Estate", XLK: "Technology", XLU: "Utilities",
    GLD: "Gold", SLV: "Silver", SMH: "Semiconductors", SPCX: "SPAC ETF",
    DRAM: "DRAM", MU: "Micron"
  };
  return names[ticker] || ticker;
}

// Moving average levels monitored for entries
var MA_LEVELS = [
  { key: "d_ema21", label: "21-Day EMA", timeframe: "daily", type: "ema", period: 21 },
  { key: "d_sma55", label: "55-Day SMA", timeframe: "daily", type: "sma", period: 55 },
  { key: "d_sma200", label: "200-Day SMA", timeframe: "daily", type: "sma", period: 200 },
  { key: "w_ema21", label: "21-Week EMA", timeframe: "weekly", type: "ema", period: 21 },
  { key: "w_sma50", label: "50-Week SMA", timeframe: "weekly", type: "sma", period: 50 }
];

var PROXIMITY_PCT = parseFloat(process.env.MA_PROXIMITY_PCT || "1") / 100;
var RISK_PCT = parseFloat(process.env.RISK_PCT || "2") / 100; // 2% of equity per entry
var TRADE_SIZE = parseFloat(process.env.TRADE_SIZE_USD || "0"); // 0 = use risk % only
var STARTING_BALANCE = parseFloat(process.env.PAPER_BALANCE || "50000");
var STOP_MA_KEY = "d_sma55"; // stop loss: daily close below 55 SMA
var ENTRY_MA_KEY = "d_ema21"; // scanner entries only on 21-Day EMA proximity
var PROXIMITY_ALERT_KEYS = ["d_ema21", "d_sma55"];
var EARNINGS_BLACKOUT_DAYS = parseInt(process.env.EARNINGS_BLACKOUT_DAYS || "5", 10);
var OPTIONS_IV_RANK_MAX = parseFloat(process.env.OPTIONS_IV_RANK_MAX || "35");

// Take profit tiers: at gain % → sell % of original shares (last tier sells all remaining)
var TAKE_PROFIT_TIERS = [
  { pct: parseFloat(process.env.TP_TIER1_PCT || "10"), sellPct: parseFloat(process.env.TP_TIER1_SELL || "25") / 100, label: "+10% — sell 25%" },
  { pct: parseFloat(process.env.TP_TIER2_PCT || "20"), sellPct: parseFloat(process.env.TP_TIER2_SELL || "25") / 100, label: "+20% — sell 25%" },
  { pct: parseFloat(process.env.TP_TIER3_PCT || "30"), sellPct: 1.0, label: "+30% — exit remaining" }
];

module.exports = {
  YAHOO_MAP: YAHOO_MAP,
  getAllTickers: getAllTickers,
  getYahooSymbol: getYahooSymbol,
  getDisplayName: getDisplayName,
  getDisplayTicker: getDisplayTicker,
  briefingRank: briefingRank,
  isBriefingMa: isBriefingMa,
  isBriefingTicker: isBriefingTicker,
  getMainBriefingTickers: getMainBriefingTickers,
  MAG7: MAG7,
  BRIEFING_DAILY_MA_KEYS: BRIEFING_DAILY_MA_KEYS,
  MAIN_BRIEFING_ORDER: MAIN_BRIEFING_ORDER,
  isAlertOnly: isAlertOnly,
  MA_LEVELS: MA_LEVELS,
  PROXIMITY_PCT: PROXIMITY_PCT,
  RISK_PCT: RISK_PCT,
  TRADE_SIZE: TRADE_SIZE,
  STARTING_BALANCE: STARTING_BALANCE,
  STOP_MA_KEY: STOP_MA_KEY,
  ENTRY_MA_KEY: ENTRY_MA_KEY,
  PROXIMITY_ALERT_KEYS: PROXIMITY_ALERT_KEYS,
  EARNINGS_BLACKOUT_DAYS: EARNINGS_BLACKOUT_DAYS,
  OPTIONS_IV_RANK_MAX: OPTIONS_IV_RANK_MAX,
  TAKE_PROFIT_TIERS: TAKE_PROFIT_TIERS,
  SECTOR_SPDR: SECTOR_SPDR
};
