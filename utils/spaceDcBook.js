// Space DC book reconstructed from the 6/30/26 rebalance chart:
// IRDM out, 10% cash, NVDA/GOOGL as anchors, remaining names at 8/7/6/4/3%.
// Book sized at $200,000. Shares = round(weight × $200,000 / 6/30/26 close). Entry = that close.

var paper = require("./paper");
var pools = require("./pools");

var REBALANCE_EQUITY = 200000;
var REBALANCE_TIME = "2026-06-30T19:52:00.000Z"; // 3:52 PM ET

var LOTS = [
  { ticker: "NVDA", weight: 0.16, entryPrice: 200.09 },
  { ticker: "GOOGL", weight: 0.14, entryPrice: 357.37 },
  { ticker: "ASTS", weight: 0.08, entryPrice: 88.86 },
  { ticker: "RKLB", weight: 0.07, entryPrice: 101.65 },
  { ticker: "PL", weight: 0.06, entryPrice: 33.13 },
  { ticker: "MRAAY", weight: 0.06, entryPrice: 36.20 },
  { ticker: "BE", weight: 0.04, entryPrice: 302.70 },
  { ticker: "SMR", weight: 0.04, entryPrice: 10.03 },
  { ticker: "OKLO", weight: 0.04, entryPrice: 52.33 },
  { ticker: "LEU", weight: 0.04, entryPrice: 167.87 },
  { ticker: "NVTS", weight: 0.04, entryPrice: 17.92 },
  { ticker: "RDW", weight: 0.04, entryPrice: 12.23 },
  { ticker: "LUNR", weight: 0.03, entryPrice: 21.39 },
  { ticker: "RGTI", weight: 0.03, entryPrice: 19.32 },
  { ticker: "ONDS", weight: 0.03, entryPrice: 8.24 }
];

var CASH_WEIGHT = 0.10;
var SOLD = [{ ticker: "IRDM", note: "Sold @ $54 — out at rebalance" }];

function lotsWithShares() {
  return LOTS.map(function (lot) {
    var target = REBALANCE_EQUITY * lot.weight;
    var shares = Math.max(1, Math.round(target / lot.entryPrice));
    var cost = shares * lot.entryPrice;
    return {
      ticker: lot.ticker,
      weight: lot.weight,
      entryPrice: lot.entryPrice,
      target: target,
      shares: shares,
      cost: cost
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
      maLabel: "Rebalance 6/30/26",
      shares: lot.shares,
      totalShares: lot.shares,
      entryPrice: lot.entryPrice,
      entryTime: REBALANCE_TIME,
      costBasis: parseFloat(lot.cost.toFixed(2)),
      lastProfitTier: 0,
      heldBook: true
    };
    invested += lot.cost;
  });
  p.cash = parseFloat((REBALANCE_EQUITY - invested).toFixed(2));
  p.seededFromRebalance = true;
  p.wins = p.wins || 0;
  p.losses = p.losses || 0;
  p.trades = p.trades || [];
  return p;
}

function seedSpaceDcBook(force) {
  var p = paper.getPortfolio("space_dc");
  if (!force && p.seededFromRebalance && p.startingBalance === REBALANCE_EQUITY) return p;
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
