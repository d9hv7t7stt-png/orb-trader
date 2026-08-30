var fs = require("fs");
var tickers = require("./tickers");
var pools = require("./pools");

var LEGACY_FILE = "/tmp/paper-portfolio.json";

function portfolioPath(poolId) {
  return "/tmp/paper-portfolio-" + poolId + ".json";
}

function migrateLegacyIfNeeded() {
  if (!fs.existsSync(LEGACY_FILE)) return;
  var mainPath = portfolioPath("main");
  if (!fs.existsSync(mainPath)) {
    fs.copyFileSync(LEGACY_FILE, mainPath);
    console.log("[Paper] Migrated legacy portfolio → main pool");
  }
}

function defaultPortfolio(poolId) {
  var pool = pools.getPool(poolId);
  return {
    poolId: poolId,
    cash: pool.startingBalance,
    startingBalance: pool.startingBalance,
    positions: {},
    trades: [],
    wins: 0,
    losses: 0
  };
}

function loadPortfolio(poolId) {
  migrateLegacyIfNeeded();
  try {
    var file = portfolioPath(poolId);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (e) {}
  return defaultPortfolio(poolId);
}

function savePortfolio(poolId, portfolio) {
  try {
    fs.writeFileSync(portfolioPath(poolId), JSON.stringify(portfolio));
  } catch (e) {}
}

var cache = {};

function getPortfolio(poolId) {
  if (poolId === undefined) poolId = "main";
  if (!cache[poolId]) cache[poolId] = loadPortfolio(poolId);
  return cache[poolId];
}

function getEquity(poolId, livePrices) {
  var portfolio = getPortfolio(poolId);
  var equity = portfolio.cash;
  Object.entries(portfolio.positions).forEach(function (entry) {
    var pos = entry[1];
    var px = livePrices && livePrices[pos.ticker] ? livePrices[pos.ticker].price : pos.entryPrice;
    equity += pos.shares * px;
  });
  return equity;
}

function positionKey(ticker, maKey) {
  return ticker + ":" + maKey;
}

function hasPosition(poolId, ticker, maKey) {
  return !!getPortfolio(poolId).positions[positionKey(ticker, maKey)];
}

function getPositionSizeUSD(poolId, livePrices) {
  var equity = getEquity(poolId, livePrices);
  var size = equity * tickers.RISK_PCT;
  if (tickers.TRADE_SIZE > 0) {
    size = Math.min(size, tickers.TRADE_SIZE);
  }
  return Math.max(100, Math.floor(size));
}

function buy(poolId, ticker, maKey, maLabel, price, shares, reason, riskUsd) {
  var portfolio = getPortfolio(poolId);
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
    poolId: poolId,
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
  savePortfolio(poolId, portfolio);
  return trade;
}

function sellPartial(poolId, key, price, sellShares, reason) {
  var portfolio = getPortfolio(poolId);
  var pos = portfolio.positions[key];
  if (!pos || sellShares < 1) return null;
  sellShares = Math.min(sellShares, pos.shares);
  if (sellShares >= pos.shares) return sell(poolId, key, price, reason);

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
    poolId: poolId,
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
  savePortfolio(poolId, portfolio);
  return trade;
}

function sell(poolId, key, price, reason) {
  var portfolio = getPortfolio(poolId);
  var pos = portfolio.positions[key];
  if (!pos) return null;
  var proceeds = pos.shares * price;
  var pnl = proceeds - pos.costBasis;
  var pct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
  portfolio.cash += proceeds;
  if (pnl >= 0) portfolio.wins++; else portfolio.losses++;
  var trade = {
    type: "sell",
    poolId: poolId,
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
  savePortfolio(poolId, portfolio);
  return trade;
}

function getUnrealizedPnL(poolId, livePrices) {
  var portfolio = getPortfolio(poolId);
  var total = 0;
  var details = [];
  Object.entries(portfolio.positions).forEach(function (entry) {
    var pos = entry[1];
    var px = livePrices && livePrices[pos.ticker] ? livePrices[pos.ticker].price : pos.entryPrice;
    var pnl = (px - pos.entryPrice) * pos.shares;
    total += pnl;
    details.push({
      key: entry[0],
      poolId: poolId,
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

function getPnlSummary(poolId) {
  var portfolio = getPortfolio(poolId);
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

function getOpenPositions(poolId) {
  return Object.entries(getPortfolio(poolId).positions).map(function (entry) {
    return { key: entry[0], pos: entry[1] };
  });
}

function markProfitTier(poolId, key, tier) {
  var portfolio = getPortfolio(poolId);
  if (portfolio.positions[key]) {
    portfolio.positions[key].lastProfitTier = tier;
    savePortfolio(poolId, portfolio);
  }
}

function resetPortfolio(poolId) {
  cache[poolId] = defaultPortfolio(poolId);
  savePortfolio(poolId, cache[poolId]);
}

function resetAllPortfolios() {
  pools.getAllPools().forEach(function (pool) {
    resetPortfolio(pool.id);
  });
}

function getAllPoolSummaries(livePricesByPool) {
  return pools.getAllPools().map(function (pool) {
    var livePrices = (livePricesByPool && livePricesByPool[pool.id]) || {};
    var p = getPortfolio(pool.id);
    var equity = getEquity(pool.id, livePrices);
    var unreal = getUnrealizedPnL(pool.id, livePrices);
    return {
      poolId: pool.id,
      poolLabel: pool.shortLabel,
      poolName: pool.name,
      cash: p.cash,
      startingBalance: p.startingBalance,
      equity: equity,
      unrealized: unreal.total,
      open_positions: Object.keys(p.positions).length,
      wins: p.wins,
      losses: p.losses,
      positions: unreal.details,
      pnl: getPnlSummary(pool.id),
      trade_size: getPositionSizeUSD(pool.id, livePrices)
    };
  });
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
  resetAllPortfolios: resetAllPortfolios,
  getAllPoolSummaries: getAllPoolSummaries,
  positionKey: positionKey
};
