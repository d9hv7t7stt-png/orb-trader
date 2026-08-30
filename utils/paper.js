var fs = require("fs");
var tickers = require("./tickers");

var PERSIST_FILE = "/tmp/paper-portfolio.json";

function loadPortfolio() {
  try {
    if (fs.existsSync(PERSIST_FILE)) {
      return JSON.parse(fs.readFileSync(PERSIST_FILE, "utf8"));
    }
  } catch (e) {}
  return {
    cash: tickers.STARTING_BALANCE,
    startingBalance: tickers.STARTING_BALANCE,
    positions: {},
    trades: [],
    wins: 0,
    losses: 0
  };
}

function savePortfolio(p) {
  try {
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(p));
  } catch (e) {}
}

var portfolio = loadPortfolio();

function getPortfolio() { return portfolio; }

function getEquity(livePrices) {
  var equity = portfolio.cash;
  Object.entries(portfolio.positions).forEach(function (entry) {
    var key = entry[0];
    var pos = entry[1];
    var px = livePrices && livePrices[pos.ticker] ? livePrices[pos.ticker].price : pos.entryPrice;
    equity += pos.shares * px;
  });
  return equity;
}

function positionKey(ticker, maKey) {
  return ticker + ":" + maKey;
}

function hasPosition(ticker, maKey) {
  return !!portfolio.positions[positionKey(ticker, maKey)];
}

function getPositionSizeUSD(livePrices) {
  var equity = getEquity(livePrices);
  var size = equity * tickers.RISK_PCT;
  if (tickers.TRADE_SIZE > 0) {
    size = Math.min(size, tickers.TRADE_SIZE);
  }
  return Math.max(100, Math.floor(size));
}

function buy(ticker, maKey, maLabel, price, shares, reason, riskUsd) {
  var cost = shares * price;
  if (cost > portfolio.cash) {
    shares = Math.floor(portfolio.cash / price);
    cost = shares * price;
  }
  if (shares < 1 || cost <= 0) return null;

  portfolio.cash -= cost;
  var key = positionKey(ticker, maKey);
  portfolio.positions[key] = {
    ticker: ticker,
    maKey: maKey,
    maLabel: maLabel,
    shares: shares,
    totalShares: shares,
    entryPrice: price,
    entryTime: new Date().toISOString(),
    costBasis: cost,
    lastProfitTier: 0
  };
  var trade = {
    type: "buy",
    ticker: ticker,
    maKey: maKey,
    maLabel: maLabel,
    shares: shares,
    price: price,
    total: cost,
    risk_usd: riskUsd || cost,
    reason: reason,
    time: new Date().toISOString()
  };
  portfolio.trades.unshift(trade);
  if (portfolio.trades.length > 500) portfolio.trades.pop();
  savePortfolio(portfolio);
  return trade;
}

function sellPartial(key, price, sellShares, reason) {
  var pos = portfolio.positions[key];
  if (!pos || sellShares < 1) return null;
  sellShares = Math.min(sellShares, pos.shares);
  if (sellShares >= pos.shares) return sell(key, price, reason);

  var proceeds = sellShares * price;
  var costPortion = pos.costBasis * (sellShares / pos.shares);
  var pnl = proceeds - costPortion;
  var pct = ((price - pos.entryPrice) / pos.entryPrice) * 100;

  portfolio.cash += proceeds;
  pos.shares -= sellShares;
  pos.costBasis -= costPortion;

  var trade = {
    type: "sell",
    partial: true,
    ticker: pos.ticker,
    maKey: pos.maKey,
    maLabel: pos.maLabel,
    shares: sellShares,
    remaining: pos.shares,
    price: price,
    entryPrice: pos.entryPrice,
    pnl: pnl,
    pct: pct,
    reason: reason,
    time: new Date().toISOString()
  };
  portfolio.trades.unshift(trade);
  savePortfolio(portfolio);
  return trade;
}

function sell(key, price, reason) {
  var pos = portfolio.positions[key];
  if (!pos) return null;
  var proceeds = pos.shares * price;
  var pnl = proceeds - pos.costBasis;
  var pct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
  portfolio.cash += proceeds;
  if (pnl >= 0) portfolio.wins++; else portfolio.losses++;
  var trade = {
    type: "sell",
    ticker: pos.ticker,
    maKey: pos.maKey,
    maLabel: pos.maLabel,
    shares: pos.shares,
    price: price,
    entryPrice: pos.entryPrice,
    pnl: pnl,
    pct: pct,
    reason: reason,
    time: new Date().toISOString()
  };
  portfolio.trades.unshift(trade);
  delete portfolio.positions[key];
  savePortfolio(portfolio);
  return trade;
}

function getUnrealizedPnL(livePrices) {
  var total = 0;
  var details = [];
  Object.entries(portfolio.positions).forEach(function (entry) {
    var pos = entry[1];
    var px = livePrices && livePrices[pos.ticker] ? livePrices[pos.ticker].price : pos.entryPrice;
    var pnl = (px - pos.entryPrice) * pos.shares;
    total += pnl;
    details.push({
      key: entry[0],
      ticker: pos.ticker,
      maLabel: pos.maLabel,
      shares: pos.shares,
      totalShares: pos.totalShares || pos.shares,
      entryPrice: pos.entryPrice,
      currentPrice: px,
      pnl: parseFloat(pnl.toFixed(2)),
      pct: parseFloat((((px - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2)),
      lastProfitTier: pos.lastProfitTier || 0
    });
  });
  return { total: parseFloat(total.toFixed(2)), details: details };
}

function getPnlSummary() {
  var now = new Date();
  var daily = 0, weekly = 0, monthly = 0, yearly = 0, hasData = false;
  portfolio.trades.filter(function (t) { return t.type === "sell"; }).forEach(function (t) {
    var d = new Date(t.time);
    var pnl = t.pnl || 0;
    if (d.toDateString() === now.toDateString()) { daily += pnl; hasData = true; }
    var weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
    if (d >= weekAgo) { weekly += pnl; hasData = true; }
    var monthAgo = new Date(now); monthAgo.setMonth(monthAgo.getMonth() - 1);
    if (d >= monthAgo) { monthly += pnl; hasData = true; }
    var yearAgo = new Date(now); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    if (d >= yearAgo) { yearly += pnl; hasData = true; }
  });
  return hasData
    ? { daily: daily, weekly: weekly, monthly: monthly, yearly: yearly }
    : { daily: null, weekly: null, monthly: null, yearly: null };
}

function getOpenPositions() {
  return Object.entries(portfolio.positions).map(function (entry) {
    return { key: entry[0], pos: entry[1] };
  });
}

function markProfitTier(key, tier) {
  if (portfolio.positions[key]) {
    portfolio.positions[key].lastProfitTier = tier;
    savePortfolio(portfolio);
  }
}

function resetPortfolio() {
  portfolio = {
    cash: tickers.STARTING_BALANCE,
    startingBalance: tickers.STARTING_BALANCE,
    positions: {},
    trades: [],
    wins: 0,
    losses: 0
  };
  savePortfolio(portfolio);
}

module.exports = {
  getPortfolio: getPortfolio,
  getEquity: getEquity,
  getPositionSizeUSD: getPositionSizeUSD,
  getOpenPositions: getOpenPositions,
  hasPosition: hasPosition,
  buy: buy,
  sell: sell,
  sellPartial: sellPartial,
  markProfitTier: markProfitTier,
  getUnrealizedPnL: getUnrealizedPnL,
  getPnlSummary: getPnlSummary,
  resetPortfolio: resetPortfolio,
  positionKey: positionKey
};
