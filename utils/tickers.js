// Watchlist — Yahoo Finance symbols
// SPXW maps to S&P 500 index; sector ETFs are State Street SPDR Select Sector funds

var CORE = [
  "SPY", "SPXW", "QQQ", "IWM",
  "AAPL", "AMZN", "META", "NVDA", "MSFT", "TSLA", "GOOG",
  "GLD", "SLV", "SMH", "SPCX"
];

// User requested DRAM — also include MU (Micron) as DRAM sector proxy if DRAM illiquid
var EXTRA = ["DRAM", "MU"];

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

function getYahooSymbol(ticker) {
  return YAHOO_MAP[ticker] || ticker;
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

// Take profit tiers: at gain % → sell % of original shares (last tier sells all remaining)
var TAKE_PROFIT_TIERS = [
  { pct: parseFloat(process.env.TP_TIER1_PCT || "10"), sellPct: parseFloat(process.env.TP_TIER1_SELL || "25") / 100, label: "+10% — sell 25%" },
  { pct: parseFloat(process.env.TP_TIER2_PCT || "20"), sellPct: parseFloat(process.env.TP_TIER2_SELL || "25") / 100, label: "+20% — sell 25%" },
  { pct: parseFloat(process.env.TP_TIER3_PCT || "30"), sellPct: 1.0, label: "+30% — exit remaining" }
];

module.exports = {
  getAllTickers: getAllTickers,
  getYahooSymbol: getYahooSymbol,
  getDisplayName: getDisplayName,
  MA_LEVELS: MA_LEVELS,
  PROXIMITY_PCT: PROXIMITY_PCT,
  RISK_PCT: RISK_PCT,
  TRADE_SIZE: TRADE_SIZE,
  STARTING_BALANCE: STARTING_BALANCE,
  STOP_MA_KEY: STOP_MA_KEY,
  TAKE_PROFIT_TIERS: TAKE_PROFIT_TIERS,
  SECTOR_SPDR: SECTOR_SPDR
};
