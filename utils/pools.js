// Trading pools — isolated paper accounts & watchlists

var tickers = require("./tickers");

var SPACE_DC_TICKERS = [
  "NVDA", "GOOGL", "ASTS", "RKLB", "PL", "MRAAY",
  "BE", "SMR", "OKLO", "LEU", "NVTS", "RDW",
  "LUNR", "RGTI", "ONDS"
];

var POOLS = {
  main: {
    id: "main",
    name: "Main Scanner",
    shortLabel: "Main",
    label: "Main",
    startingBalance: parseFloat(process.env.PAPER_BALANCE || "50000"),
    getTickers: function () { return tickers.getAllTickers(); },
    yahooMap: tickers.YAHOO_MAP || { SPXW: "^GSPC" }
  },
  space_dc: {
    id: "space_dc",
    name: "Data Center in Space",
    shortLabel: "Space DC",
    label: "Space DC",
    startingBalance: parseFloat(process.env.SPACE_DC_BALANCE || "108000"),
    getTickers: function () { return SPACE_DC_TICKERS.slice(); },
    yahooMap: {}
  }
};

function getPool(poolId) {
  return POOLS[poolId] || null;
}

function isValidPoolId(poolId) {
  return !!POOLS[poolId];
}

function getAllPools() {
  return Object.values(POOLS);
}

function getYahooSymbol(poolId, ticker) {
  var pool = getPool(poolId) || POOLS.main;
  if (pool.yahooMap && pool.yahooMap[ticker]) return pool.yahooMap[ticker];
  return tickers.getYahooSymbol(ticker);
}

module.exports = {
  POOLS: POOLS,
  getPool: getPool,
  isValidPoolId: isValidPoolId,
  getAllPools: getAllPools,
  getYahooSymbol: getYahooSymbol,
  SPACE_DC_TICKERS: SPACE_DC_TICKERS
};
