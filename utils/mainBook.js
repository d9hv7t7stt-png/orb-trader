// Main swing book: $1,000 notional per tradeable name at its April 2026 low.
// Sector SPDRs stay watch-only. SPXW (index) and SPCX (no April bars) are skipped.
// Positions are live — same stop / take-profit / one-per-ticker entry rules as scanner.

var paper = require("./paper");
var pools = require("./pools");

var BUY_USD = 1000;
var BOOK_VERSION = 2;
var STARTING_BALANCE = pools.POOLS.main.startingBalance;

var LOTS = [
  { ticker: "SPY", aprilLow: 645.11, aprilDate: "2026-04-02" },
  { ticker: "QQQ", aprilLow: 571.92, aprilDate: "2026-04-02" },
  { ticker: "IWM", aprilLow: 244.87, aprilDate: "2026-04-02" },
  { ticker: "AAPL", aprilLow: 245.70, aprilDate: "2026-04-07" },
  { ticker: "AMZN", aprilLow: 204.90, aprilDate: "2026-04-02" },
  { ticker: "META", aprilLow: 559.70, aprilDate: "2026-04-02" },
  { ticker: "NVDA", aprilLow: 171.37, aprilDate: "2026-04-02" },
  { ticker: "MSFT", aprilLow: 364.15, aprilDate: "2026-04-02" },
  { ticker: "TSLA", aprilLow: 337.24, aprilDate: "2026-04-07" },
  { ticker: "GOOG", aprilLow: 287.57, aprilDate: "2026-04-02" },
  { ticker: "GLD", aprilLow: 414.16, aprilDate: "2026-04-29" },
  { ticker: "SLV", aprilLow: 63.20, aprilDate: "2026-04-07" },
  { ticker: "SMH", aprilLow: 378.00, aprilDate: "2026-04-02" },
  { ticker: "DRAM", aprilLow: 26.14, aprilDate: "2026-04-02" },
  { ticker: "MU", aprilLow: 340.20, aprilDate: "2026-04-02" }
];

function lotsWithShares() {
  return LOTS.map(function (lot) {
    var shares = Math.max(1, Math.floor(BUY_USD / lot.aprilLow));
    var entryPrice = lot.aprilLow;
    var cost = shares * entryPrice;
    return {
      ticker: lot.ticker,
      aprilLow: lot.aprilLow,
      aprilDate: lot.aprilDate,
      shares: shares,
      entryPrice: entryPrice,
      cost: cost
    };
  });
}

function applyBook(p) {
  var lots = lotsWithShares();
  p.startingBalance = STARTING_BALANCE;
  p.positions = {};
  var invested = 0;
  lots.forEach(function (lot) {
    var key = paper.positionKey(lot.ticker, "april_low");
    p.positions[key] = {
      ticker: lot.ticker,
      maKey: "april_low",
      maLabel: "",
      shares: lot.shares,
      totalShares: lot.shares,
      entryPrice: parseFloat(lot.entryPrice.toFixed(4)),
      entryTime: lot.aprilDate + "T16:00:00.000Z",
      costBasis: parseFloat(lot.cost.toFixed(2)),
      lastProfitTier: 0
    };
    invested += lot.cost;
  });
  p.cash = parseFloat((STARTING_BALANCE - invested).toFixed(2));
  p.seededFromAprilLows = true;
  p.seededBookVersion = BOOK_VERSION;
  p.wins = p.wins || 0;
  p.losses = p.losses || 0;
  p.trades = p.trades || [];
  return p;
}

function seedMainBook(force) {
  var p = paper.getPortfolio("main");
  if (!force && p.seededBookVersion === BOOK_VERSION && p.seededFromAprilLows) return p;
  return paper.replacePortfolio("main", applyBook);
}

module.exports = {
  BUY_USD: BUY_USD,
  BOOK_VERSION: BOOK_VERSION,
  LOTS: LOTS,
  lotsWithShares: lotsWithShares,
  seedMainBook: seedMainBook,
  applyBook: applyBook
};
