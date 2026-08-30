// Space DC book:
// Share counts from 6/30/26 weights on a $200,000 book (IRDM out, NVDA/GOOGL anchors)
// Every lot is entered at its April 2026 low — no blend with the rebalance close
// Cash = $200,000 − sum(shares × April low)
// Live book — same stop / take-profit / MA-entry rules as Main

var paper = require("./paper");
var pools = require("./pools");

var REBALANCE_EQUITY = 200000;
var BOOK_VERSION = 6;
var REBALANCE_TIME = "2026-06-30T19:52:00.000Z"; // 3:52 PM ET — share-count basis

var LOTS = [
  { ticker: "NVDA", weight: 0.16, rebalancePrice: 200.09, aprilLow: 171.37, aprilDate: "2026-04-02" },
  { ticker: "GOOGL", weight: 0.14, rebalancePrice: 357.37, aprilLow: 289.45, aprilDate: "2026-04-02" },
  { ticker: "ASTS", weight: 0.08, rebalancePrice: 88.86, aprilLow: 67.49, aprilDate: "2026-04-29" },
  { ticker: "RKLB", weight: 0.07, rebalancePrice: 101.65, aprilLow: 61.86, aprilDate: "2026-04-02" },
  { ticker: "PL", weight: 0.06, rebalancePrice: 33.13, aprilLow: 28.52, aprilDate: "2026-04-01" },
  { ticker: "MRAAY", weight: 0.06, rebalancePrice: 36.20, aprilLow: 10.75, aprilDate: "2026-04-02" },
  { ticker: "BE", weight: 0.04, rebalancePrice: 302.70, aprilLow: 123.16, aprilDate: "2026-04-02" },
  { ticker: "SMR", weight: 0.04, rebalancePrice: 10.03, aprilLow: 8.85, aprilDate: "2026-04-13" },
  { ticker: "OKLO", weight: 0.04, rebalancePrice: 52.33, aprilLow: 44.91, aprilDate: "2026-04-07" },
  { ticker: "LEU", weight: 0.04, rebalancePrice: 167.87, aprilLow: 165.67, aprilDate: "2026-04-07" },
  { ticker: "NVTS", weight: 0.04, rebalancePrice: 17.92, aprilLow: 8.05, aprilDate: "2026-04-02" },
  { ticker: "RDW", weight: 0.04, rebalancePrice: 12.23, aprilLow: 8.47, aprilDate: "2026-04-29" },
  { ticker: "LUNR", weight: 0.03, rebalancePrice: 21.39, aprilLow: 19.10, aprilDate: "2026-04-01" },
  { ticker: "RGTI", weight: 0.03, rebalancePrice: 19.32, aprilLow: 12.81, aprilDate: "2026-04-02" },
  { ticker: "ONDS", weight: 0.03, rebalancePrice: 8.24, aprilLow: 8.46, aprilDate: "2026-04-02" }
];

var CASH_WEIGHT = 0.10;
var SOLD = [{ ticker: "IRDM", note: "Sold @ $54 — out at rebalance" }];

function lotsWithShares() {
  return LOTS.map(function (lot) {
    var target = REBALANCE_EQUITY * lot.weight;
    var shares = Math.max(1, Math.round(target / lot.rebalancePrice));
    var entryPrice = lot.aprilLow;
    var cost = shares * entryPrice;
    return {
      ticker: lot.ticker,
      weight: lot.weight,
      rebalancePrice: lot.rebalancePrice,
      aprilLow: lot.aprilLow,
      aprilDate: lot.aprilDate,
      target: target,
      shares: shares,
      cost: cost,
      entryPrice: entryPrice
    };
  });
}

function applyBook(p) {
  var lots = lotsWithShares();
  p.startingBalance = REBALANCE_EQUITY;
  p.positions = {};
  var invested = 0;
  lots.forEach(function (lot) {
    var key = paper.positionKey(lot.ticker, "rebalance");
    p.positions[key] = {
      ticker: lot.ticker,
      maKey: "rebalance",
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
  p.cash = parseFloat((REBALANCE_EQUITY - invested).toFixed(2));
  p.seededFromRebalance = true;
  p.seededBookVersion = BOOK_VERSION;
  p.wins = p.wins || 0;
  p.losses = p.losses || 0;
  p.trades = p.trades || [];
  return p;
}

function seedSpaceDcBook(force) {
  var p = paper.getPortfolio("space_dc");
  if (!force && p.seededBookVersion === BOOK_VERSION) return p;
  return paper.replacePortfolio("space_dc", applyBook);
}

function positionByTicker(portfolio) {
  var map = {};
  Object.values((portfolio && portfolio.positions) || {}).forEach(function (pos) {
    map[pos.ticker] = pos;
  });
  return map;
}

function watchlistTickers() {
  return pools.SPACE_DC_TICKERS.slice();
}

module.exports = {
  REBALANCE_EQUITY: REBALANCE_EQUITY,
  BOOK_VERSION: BOOK_VERSION,
  REBALANCE_TIME: REBALANCE_TIME,
  LOTS: LOTS,
  CASH_WEIGHT: CASH_WEIGHT,
  SOLD: SOLD,
  lotsWithShares: lotsWithShares,
  seedSpaceDcBook: seedSpaceDcBook,
  applyBook: applyBook,
  positionByTicker: positionByTicker,
  watchlistTickers: watchlistTickers
};
