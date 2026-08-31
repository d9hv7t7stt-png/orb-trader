var tickers = require("./tickers");
var pools = require("./pools");

var MAX_PER_THEME = parseInt(process.env.MAX_POSITIONS_PER_THEME || "2", 10);

var TICKER_THEME = {
  SPY: "index", SPXW: "index", QQQ: "index", IWM: "index",
  AAPL: "mag7", AMZN: "mag7", META: "mag7", NVDA: "mag7", MSFT: "mag7", TSLA: "mag7", GOOG: "mag7",
  GLD: "metal", SLV: "metal",
  SMH: "semi", MU: "semi", DRAM: "semi",
  SPCX: "alt",
  ASTS: "space", RKLB: "space", PL: "space", MRAAY: "space", BE: "space", SMR: "space",
  OKLO: "space", LEU: "space", NVTS: "space", RDW: "space", LUNR: "space", RGTI: "space", ONDS: "space",
  GOOGL: "mag7"
};

var SECTOR_THEME = {};
tickers.SECTOR_SPDR.forEach(function (s) {
  SECTOR_THEME[s] = "sector_" + s;
});

function getTheme(ticker) {
  if (TICKER_THEME[ticker]) return TICKER_THEME[ticker];
  if (SECTOR_THEME[ticker]) return SECTOR_THEME[ticker];
  if (tickers.isAlertOnly(ticker)) return SECTOR_THEME[ticker] || "sector";
  return "other";
}

function countThemePositions(poolId, theme, excludeTicker) {
  var paper = require("./paper");
  var count = 0;
  paper.getOpenPositions(poolId).forEach(function (entry) {
    var t = entry.pos.ticker;
    if (excludeTicker && t === excludeTicker) return;
    if (getTheme(t) === theme) count++;
  });
  return count;
}

function canAddThemePosition(poolId, ticker) {
  var theme = getTheme(ticker);
  if (theme.indexOf("sector_") === 0) return true;
  return countThemePositions(poolId, theme, ticker) < MAX_PER_THEME;
}

module.exports = {
  getTheme: getTheme,
  canAddThemePosition: canAddThemePosition,
  countThemePositions: countThemePositions,
  MAX_PER_THEME: MAX_PER_THEME
};
