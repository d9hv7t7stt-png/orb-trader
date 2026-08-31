#!/usr/bin/env node
"use strict";

var assert = require("assert");
var path = require("path");
var fs = require("fs");

var passed = 0;
var failed = 0;

function test(name, fn) {
  return Promise.resolve().then(fn).then(function () {
    passed++;
    console.log("  \u2713 " + name);
  }).catch(function (e) {
    failed++;
    console.error("  \u2717 " + name);
    console.error("    " + (e.message || e));
  });
}

process.env.DATA_DIR = path.join(__dirname, ".test-data");

function resetTestData() {
  var dir = process.env.DATA_DIR;
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(function (f) {
      fs.unlinkSync(path.join(dir, f));
    });
  }
}

async function main() {
  console.log("\nArgus Paper Stock Trader — tests\n");

  console.log("pools");
  var pools = require("../utils/pools");

  await test("defines main and space_dc pools", function () {
    assert.strictEqual(pools.getAllPools().length, 2);
    assert.ok(pools.isValidPoolId("main"));
    assert.ok(pools.isValidPoolId("space_dc"));
    assert.strictEqual(pools.isValidPoolId("bogus"), false);
  });

  await test("space_dc has 15 tickers", function () {
    assert.strictEqual(pools.getPool("space_dc").getTickers().length, 15);
  });

  await test("NVDA in both pools", function () {
    assert.ok(pools.getPool("main").getTickers().includes("NVDA"));
    assert.ok(pools.getPool("space_dc").getTickers().includes("NVDA"));
  });

  console.log("\ntickers");
  var tickers = require("../utils/tickers");

  await test("sector SPDRs are alert-only", function () {
    ["XLC", "XLY", "XLP", "XLE", "XLF", "XLV", "XLI", "XLB", "XLRE", "XLK", "XLU"].forEach(function (t) {
      assert.strictEqual(tickers.isAlertOnly(t), true, t);
    });
    assert.strictEqual(tickers.isAlertOnly("NVDA"), false);
    assert.strictEqual(tickers.isAlertOnly("SPY"), false);
  });

  await test("main briefing watchlist is indexes, Mag7, metals, then sectors", function () {
    var list = tickers.getMainBriefingTickers();
    assert.strictEqual(list[0], "SPXW");
    assert.strictEqual(tickers.getDisplayTicker("SPXW"), "SPX");
    assert.ok(list.indexOf("NVDA") !== -1);
    assert.ok(list.indexOf("XLC") !== -1);
    assert.ok(list.indexOf("DRAM") === -1);
    assert.ok(list.indexOf("MU") === -1);
    assert.ok(list.indexOf("SMH") === -1);
    assert.ok(list.indexOf("SPXW") < list.indexOf("SPY"));
    assert.ok(list.indexOf("SLV") < list.indexOf("XLB"));
    assert.ok(list.indexOf("XLB") < list.indexOf("XLY"));
  });

  console.log("\nmarketHours");
  var marketHours = require("../utils/marketHours");

  await test("Sunday is closed", function () {
    assert.strictEqual(marketHours.isMarketHours(new Date("2026-08-30T15:00:00Z")), false);
  });

  await test("Monday 11am ET is open", function () {
    assert.strictEqual(marketHours.isMarketHours(new Date("2026-08-31T15:00:00Z")), true);
  });

  await test("Monday 8am ET is closed", function () {
    assert.strictEqual(marketHours.isMarketHours(new Date("2026-08-31T12:00:00Z")), false);
  });

  await test("msUntilAfterBell returns positive ms", function () {
    assert.ok(marketHours.msUntilAfterBell() > 0);
  });

  await test("msUntilSundayPremarket hits Sunday 3:00 PM ET", function () {
    // Sunday Aug 30 2026 2:00 PM ET = 18:00 UTC (EDT)
    var ms = marketHours.msUntilSundayPremarket(new Date("2026-08-30T18:00:00Z"));
    assert.ok(ms > 50 * 60 * 1000 && ms < 70 * 60 * 1000, "expected ~1h, got " + ms);
  });

  await test("msUntilSundayPremarket rolls to next week after 3:00 PM", function () {
    // Sunday Aug 30 2026 3:01 PM ET = 19:01 UTC → next Sunday Sep 6 3:00 PM ET
    var ms = marketHours.msUntilSundayPremarket(new Date("2026-08-30T19:01:00Z"));
    assert.ok(ms > 6.9 * 86400000 && ms < 7.1 * 86400000, "expected ~7d, got " + ms);
  });

  await test("sundayPremarketLabel is 3:00 PM ET", function () {
    assert.strictEqual(marketHours.sundayPremarketHour(), 15);
    assert.strictEqual(marketHours.sundayPremarketLabel(), "3:00 PM ET");
  });

  await test("etDateKey uses America/New_York", function () {
    // 2026-08-31 02:00 UTC is still Aug 30 in ET (EDT UTC-4)
    assert.strictEqual(marketHours.etDateKey(new Date("2026-08-31T02:00:00Z")), "2026-08-30");
  });

  console.log("\nscanner");
  var scanner = require("../utils/scanner");

  await test("startupScanForced is false outside forced deploy scans", function () {
    assert.strictEqual(scanner.startupScanForced(), false);
  });

  await test("canProcessTradeLogic skips pre-market unless after bell", function () {
    assert.strictEqual(marketHours.canProcessTradeLogic(false, {}), marketHours.isAfterBell());
    assert.strictEqual(marketHours.canProcessTradeLogic(true, {}), true);
    assert.strictEqual(marketHours.canProcessTradeLogic(false, { quotesOnly: true }), false);
  });

  await test("runScan(false) skips outside market hours", function () {
    var orig = marketHours.isMarketHours;
    marketHours.isMarketHours = function () { return false; };
    return scanner.runScan(false).then(function (result) {
      assert.strictEqual(result.skipped, true);
      assert.strictEqual(result.reason, "outside market hours");
      marketHours.isMarketHours = orig;
    });
  });

  await test("quotes-only scan also skips outside market hours unless forced", function () {
    var orig = marketHours.isMarketHours;
    marketHours.isMarketHours = function () { return false; };
    return scanner.runScan(false, { quotesOnly: true }).then(function (result) {
      assert.strictEqual(result.skipped, true);
      marketHours.isMarketHours = orig;
    });
  });

  await test("isBelowStopMA blocks entry when daily close is under 55 SMA", function () {
    var data = {
      ticker: "TEST",
      price: 100,
      stopPrice: 95,
      levels: [
        { key: "d_sma55", label: "55-Day SMA", value: 100, near: true, proximity_pct: 0.5 },
        { key: "d_ema21", label: "21-Day EMA", value: 99, near: true, proximity_pct: 0.8 }
      ]
    };
    assert.strictEqual(scanner.isBelowStopMA(data), true);
    data.stopPrice = 105;
    assert.strictEqual(scanner.isBelowStopMA(data), false);
  });

  console.log("\npaper");
  resetTestData();
  delete require.cache[require.resolve("../utils/paper")];
  delete require.cache[require.resolve("../utils/state")];
  var paper = require("../utils/paper");

  await test("one position per ticker enforced at buy layer check", function () {
    paper.resetPortfolio("main");
    var alreadyIn = false;
    ["d_ema21", "d_sma55", "w_ema21"].forEach(function (maKey) {
      if (alreadyIn) return;
      if (!paper.hasPosition("main", "AAPL", maKey)) {
        var trade = paper.buy("main", "AAPL", maKey, maKey, 100, 5, "test", 500);
        if (trade) alreadyIn = true;
      }
    });
    assert.strictEqual(paper.getOpenPositions("main").length, 1);
  });

  await test("pools have separate portfolios", function () {
    paper.resetPortfolio("main");
    paper.resetPortfolio("space_dc");
    paper.buy("main", "NVDA", "d_ema21", "21-Day EMA", 100, 1, "test", 1000);
    paper.buy("space_dc", "NVDA", "d_ema21", "21-Day EMA", 100, 1, "test", 1000);
    assert.strictEqual(paper.getOpenPositions("main").length, 1);
    assert.strictEqual(paper.getOpenPositions("space_dc").length, 1);
  });

  await test("buy refuses a second position in the same ticker", function () {
    paper.resetPortfolio("main");
    var first = paper.buy("main", "AAPL", "d_ema21", "21D", 100, 5, "test", 500);
    var second = paper.buy("main", "AAPL", "d_sma55", "55D", 100, 5, "test", 500);
    assert.ok(first);
    assert.strictEqual(second, null);
    assert.strictEqual(paper.getOpenPositions("main").length, 1);
  });

  await test("getPositionSizeUSD is at least $100", function () {
    paper.resetPortfolio("main");
    assert.ok(paper.getPositionSizeUSD("main", {}) >= 100);
  });

  await test("replacePortfolio updates cache and disk", function () {
    paper.resetPortfolio("main");
    paper.replacePortfolio("main", function (p) {
      p.cash = 12345;
      p.note = "patched";
      return p;
    });
    assert.strictEqual(paper.getPortfolio("main").cash, 12345);
    delete require.cache[require.resolve("../utils/paper")];
    delete require.cache[require.resolve("../utils/scanner")];
    delete require.cache[require.resolve("../utils/spaceDcBook")];
    delete require.cache[require.resolve("../utils/mainBook")];
    delete require.cache[require.resolve("../utils/discord")];
    var paper2 = require("../utils/paper");
    assert.strictEqual(paper2.getPortfolio("main").cash, 12345);
    paper = paper2;
  });

  console.log("\nspaceDcBook");
  var spaceDcBook = require("../utils/spaceDcBook");

  await test("rebalance weights plus cash equal 100%", function () {
    var stock = spaceDcBook.LOTS.reduce(function (s, l) { return s + l.weight; }, 0);
    assert.ok(Math.abs(stock + spaceDcBook.CASH_WEIGHT - 1) < 1e-9);
    assert.strictEqual(spaceDcBook.LOTS.length, 15);
    assert.strictEqual(spaceDcBook.SOLD[0].ticker, "IRDM");
  });

  await test("share counts come from 6/30/26 closes and $200k weights", function () {
    var lots = spaceDcBook.lotsWithShares();
    var byTicker = {};
    lots.forEach(function (l) { byTicker[l.ticker] = l; });
    assert.strictEqual(byTicker.NVDA.shares, 160);
    assert.strictEqual(byTicker.GOOGL.shares, 78);
    assert.strictEqual(byTicker.ASTS.shares, 180);
    assert.strictEqual(byTicker.ONDS.shares, 728);
    assert.strictEqual(spaceDcBook.REBALANCE_EQUITY, 200000);
  });

  await test("every Space DC entry is the April 2026 low", function () {
    var lots = spaceDcBook.lotsWithShares();
    lots.forEach(function (lot) {
      assert.strictEqual(lot.entryPrice, lot.aprilLow, lot.ticker + " entry");
      assert.ok(Math.abs(lot.cost - lot.shares * lot.aprilLow) < 0.01);
    });
    var nvda = lots.find(function (l) { return l.ticker === "NVDA"; });
    assert.strictEqual(nvda.entryPrice, 171.37);
    var invested = lots.reduce(function (s, l) { return s + l.cost; }, 0);
    var cash = spaceDcBook.REBALANCE_EQUITY - invested;
    assert.ok(cash > 60000 && cash < 70000, "April-low cash leftover, got " + cash);
  });

  await test("seedSpaceDcBook writes 15 live lots at April lows", function () {
    paper.resetPortfolio("space_dc");
    var p = spaceDcBook.seedSpaceDcBook(true);
    assert.strictEqual(Object.keys(p.positions).length, 15);
    assert.strictEqual(p.seededFromRebalance, true);
    assert.strictEqual(p.seededBookVersion, spaceDcBook.BOOK_VERSION);
    assert.ok(p.cash > 60000 && p.cash < 70000);
    Object.values(p.positions).forEach(function (pos) {
      assert.strictEqual(pos.maLabel, "");
      assert.ok(pos.shares >= 1);
    });
    assert.strictEqual(p.positions["NVDA:rebalance"].entryPrice, 171.37);
    var again = spaceDcBook.seedSpaceDcBook(false);
    assert.strictEqual(again.positions["NVDA:rebalance"].shares, 160);
  });

  console.log("\nmainBook");
  var mainBook = require("../utils/mainBook");

  await test("Main seeds ~$1k April-low lots on tradeable names", function () {
    paper.resetPortfolio("main");
    var p = mainBook.seedMainBook(true);
    assert.strictEqual(Object.keys(p.positions).length, mainBook.LOTS.length);
    assert.strictEqual(p.seededFromAprilLows, true);
    assert.strictEqual(mainBook.BUY_USD, 1000);
    Object.values(p.positions).forEach(function (pos) {
      assert.strictEqual(pos.maLabel, "");
      assert.ok(!pos.heldBook);
      assert.ok(pos.costBasis <= mainBook.BUY_USD + pos.entryPrice + 0.01);
      assert.ok(pos.shares >= 1);
    });
    assert.strictEqual(p.positions["NVDA:april_low"].entryPrice, 171.37);
    assert.strictEqual(p.positions["NVDA:april_low"].shares, 5);
    assert.ok(p.cash > 30000 && p.cash < 50000, "cash leftover " + p.cash);
    assert.ok(!p.positions["SPCX:april_low"]);
    assert.ok(!p.positions["XLF:april_low"]);
  });

  await test("Space DC stop loss fires on live April-low lots", function () {
    paper.resetPortfolio("space_dc");
    var p = spaceDcBook.seedSpaceDcBook(true);
    assert.ok(p.positions["ASTS:rebalance"]);
    var scanner = require("../utils/scanner");
    var results = {
      ASTS: {
        ticker: "ASTS",
        price: 50,
        stopPrice: 50,
        levels: [{ key: "d_sma55", label: "55-Day SMA", value: 55 }]
      }
    };
    var exits = scanner.processStopLosses("space_dc", results);
    assert.strictEqual(exits, 1);
    assert.ok(!paper.getPortfolio("space_dc").positions["ASTS:rebalance"]);
    assert.strictEqual(paper.hasAnyPosition("space_dc", "ASTS"), false);
  });

  console.log("\ndiscord");
  var discord = require("../utils/discord");

  await test("Sunday premarket builds one embed per pool", function () {
    paper.resetPortfolio("main");
    paper.resetPortfolio("space_dc");
    mainBook.seedMainBook(true);
    spaceDcBook.seedSpaceDcBook(true);
    var embeds = discord.buildSundayPremarketEmbeds({});
    assert.strictEqual(embeds.length, 2);
    assert.ok(embeds[0].title.indexOf("Main") !== -1);
    assert.ok(embeds[1].title.indexOf("Space DC") !== -1);
    assert.ok(embeds.every(function (e) { return e.title.indexOf("SUNDAY PREMARKET") !== -1; }));
    assert.ok(embeds[0].fields.some(function (f) { return f.name === "Equity"; }));
    assert.ok(embeds[0].description.indexOf("3:00 PM ET") !== -1);
    var blob = JSON.stringify(embeds).toLowerCase();
    assert.strictEqual(blob.indexOf("paper") === -1, true, "Discord copy must not mention paper trading");
    assert.strictEqual(blob.indexOf("april") === -1, true, "Discord copy must not mention April lows");
    assert.strictEqual(blob.indexOf("(watch)") === -1, true);
    assert.strictEqual(blob.indexOf("zzz") === -1, true);
    var openField = embeds[0].fields.find(function (f) { return f.name === "Open Positions"; });
    assert.ok(openField.value.indexOf("SPY") !== -1);
    assert.ok(openField.value.indexOf("(April") === -1);
    assert.ok(openField.value.indexOf("• SPY ") !== -1);
  });

  await test("Sunday briefing omits unknown tickers like ZZZ", function () {
    paper.resetPortfolio("main");
    var p = paper.getPortfolio("main");
    p.positions["ZZZ:d_ema21"] = {
      ticker: "ZZZ", maKey: "d_ema21", maLabel: "21-Day EMA",
      shares: 10, totalShares: 10, entryPrice: 50, costBasis: 500, lastProfitTier: 0
    };
    var embeds = discord.buildSundayPremarketEmbeds({});
    var main = embeds[0];
    var openField = main.fields.find(function (f) { return f.name === "Open Positions"; });
    assert.ok(openField.value.indexOf("ZZZ") === -1);
    assert.ok(openField.value.indexOf("No open positions") !== -1);
  });

  await test("Sunday Main lists the full watchlist with prior close and 21/55", function () {
    var stateMod = require("../utils/state");
    stateMod.setScanResults("main", {
      DRAM: { ticker: "DRAM", stopPrice: 12, price: 12, levels: [{ key: "d_ema21", label: "21-Day EMA", near: true, value: 50 }] },
      XLY: { ticker: "XLY", stopPrice: 118.5, price: 118.5, levels: [{ key: "d_ema21", label: "21-Day EMA", near: true, value: 117 }, { key: "w_ema21", label: "21-Week EMA", near: true, value: 116 }, { key: "d_sma55", label: "55-Day SMA", value: 116.27 }] },
      XLB: { ticker: "XLB", stopPrice: 53.1, price: 53.1, levels: [{ key: "d_ema21", label: "21-Day EMA", near: true, value: 53 }, { key: "d_sma55", label: "55-Day SMA", value: 52 }] },
      SPY: { ticker: "SPY", stopPrice: 766.2, price: 766.2, levels: [{ key: "d_ema21", label: "21-Day EMA", near: true, value: 765 }, { key: "d_sma55", label: "55-Day SMA", value: 750 }] },
      SPXW: { ticker: "SPXW", stopPrice: 7680, price: 7680, levels: [{ key: "d_ema21", label: "21-Day EMA", near: true, value: 7669 }, { key: "d_sma200", label: "200-Day SMA", near: true, value: 7000 }, { key: "d_sma55", label: "55-Day SMA", value: 7400 }] },
      NVDA: { ticker: "NVDA", stopPrice: 217.55, price: 217.55, levels: [{ key: "d_sma55", label: "55-Day SMA", near: true, value: 210 }, { key: "d_ema21", label: "21-Day EMA", value: 215.49 }] }
    });
    var main = discord.buildSundayPremarketEmbeds({}).find(function (e) { return e.title.indexOf("Main") !== -1; });
    assert.ok(!main.fields.some(function (f) { return f.name === "Near MA"; }));
    var watch = main.fields.filter(function (f) { return f.name.indexOf("Watchlist") === 0; })
      .map(function (f) { return f.value; }).join("\n");
    tickers.getMainBriefingTickers().forEach(function (t) {
      var label = tickers.getDisplayTicker(t);
      assert.ok(watch.indexOf(label) !== -1, "missing " + label);
    });
    assert.ok(watch.indexOf("```") === -1);
    assert.ok(watch.indexOf("│") === -1 && watch.indexOf("┼") === -1);
    assert.ok(watch.indexOf("21D:") !== -1 && watch.indexOf("55D:") !== -1);
    assert.ok(watch.indexOf("$SPX") !== -1);
    assert.ok(watch.indexOf("$7,680.00") !== -1);
    assert.ok(watch.indexOf("$7,669.00") !== -1);
    assert.ok(watch.indexOf("$7,400.00") !== -1);
    assert.ok(watch.indexOf("SPXW") === -1);
    assert.ok(watch.indexOf("21-Week") === -1);
    assert.ok(watch.indexOf("200-Day") === -1);
    assert.ok(watch.indexOf("DRAM") === -1);
    var spxAt = watch.indexOf("$SPX");
    var spyAt = watch.indexOf("$SPY");
    var nvdaAt = watch.indexOf("$NVDA");
    var xlbAt = watch.indexOf("$XLB");
    var xlyAt = watch.indexOf("$XLY");
    assert.ok(spxAt < spyAt && spyAt < nvdaAt && nvdaAt < xlbAt && xlbAt < xlyAt);
    assert.ok(watch.indexOf("$AAPL") !== -1);
    assert.ok(watch.indexOf("$XLU") !== -1);
    var maLines = watch.split("\n").filter(function (line) {
      return line.indexOf("21D:") !== -1;
    });
    assert.ok(maLines.length >= 10);
    maLines.forEach(function (line) {
      assert.ok(line.indexOf("55D:") !== -1, "21D/55D should stay on one line: " + line);
      assert.ok(line.length <= 40, "line too long for Discord mobile: " + line.length + " " + line);
    });
    main.fields.filter(function (f) { return f.name.indexOf("Watchlist") === 0; }).forEach(function (f) {
      assert.ok(f.value.length <= 1024, "embed field too long: " + f.value.length);
    });
  });

  await test("Space DC Sunday uses $TICKER - close - shares - entry - P&L", function () {
    var stateMod = require("../utils/state");
    paper.resetPortfolio("space_dc");
    spaceDcBook.seedSpaceDcBook(true);
    var scan = {};
    pools.SPACE_DC_TICKERS.forEach(function (t) {
      scan[t] = {
        ticker: t,
        price: 50,
        stopPrice: 49.25,
        levels: [
          { key: "d_ema21", label: "21-Day EMA", value: 48.1, near: true },
          { key: "d_sma55", label: "55-Day SMA", value: 47.2, near: false }
        ]
      };
    });
    stateMod.setScanResults("space_dc", scan);
    var space = discord.buildSundayPremarketEmbeds({
      space_dc: { NVDA: { price: 217.55 } }
    }).find(function (e) { return e.title.indexOf("Space DC") !== -1; });
    var blob = space.fields.map(function (f) { return f.name + "\n" + f.value; }).join("\n");
    pools.SPACE_DC_TICKERS.forEach(function (t) {
      assert.ok(blob.indexOf("$" + t) !== -1, "missing $" + t);
    });
    assert.ok(blob.indexOf("```") === -1 && blob.indexOf("│") === -1);
    assert.ok(blob.indexOf("Entry ") !== -1 && blob.indexOf("P&L ") !== -1);
    assert.ok(blob.indexOf("$NVDA") !== -1);
    assert.ok(blob.indexOf("$49.25") !== -1);
    assert.ok(blob.indexOf("160 sh") !== -1);
    assert.ok(blob.indexOf("$171.37") !== -1);
    assert.ok(blob.indexOf("$CASH") !== -1);
    assert.ok(blob.indexOf("$IRDM") !== -1);
    assert.ok(blob.indexOf("Sold @ $54") !== -1);
    assert.ok(blob.indexOf("21-Day") === -1);
    assert.ok(!space.fields.some(function (f) { return f.name === "Near MA" || f.name === "Cash & sold"; }));
    space.fields.filter(function (f) { return f.name.indexOf("Watchlist") === 0; }).forEach(function (f) {
      assert.ok(f.value.length <= 1024, "embed field too long: " + f.value.length);
    });
    assert.strictEqual(JSON.stringify(space).toLowerCase().indexOf("paper") === -1, true);
  });

  console.log("\nexpansion");
  var indicators = require("../utils/indicators");
  var journalMod = require("../utils/journal");
  var backupMod = require("../utils/backup");
  var optionsMod = require("../utils/options");
  var backtestMod = require("../utils/backtest");

  await test("journal summarizes weekly closed trades", function () {
    paper.resetPortfolio("main");
    paper.buy("main", "AAPL", "d_ema21", "21-Day EMA", 100, 5, "test", 500);
    paper.sell("main", "AAPL:d_ema21", 110, "test exit");
    var j = journalMod.weeklyJournal("main");
    assert.ok(j.summary.sells >= 1);
    assert.ok(j.closedLines.length >= 1);
  });

  await test("backup snapshots persist files", function () {
    paper.resetPortfolio("main");
    var result = backupMod.runBackup();
    assert.ok(result.ok);
    assert.ok(fs.existsSync(result.dest));
  });

  await test("entry gates: above 55D required, earnings blackout blocks", function () {
    var scanner = require("../utils/scanner");
    var above = {
      price: 110,
      stopPrice: 105,
      levels: [{ key: "d_sma55", value: 100 }],
      daysToEarnings: 2
    };
    assert.strictEqual(scanner.isAboveStopMA(above), true);
    assert.strictEqual(scanner.isEarningsBlackout(above), true);
    var below = { price: 90, stopPrice: 95, levels: [{ key: "d_sma55", value: 100 }] };
    assert.strictEqual(scanner.isAboveStopMA(below), false);
  });

  await test("options IV rank from mock chain", function () {
    var stats = optionsMod.ivRankFromChain(
      [{ strike: 100, impliedVolatility: 0.25 }, { strike: 105, impliedVolatility: 0.45 }],
      [{ strike: 100, impliedVolatility: 0.30 }],
      100
    );
    assert.ok(stats.ivRank >= 0 && stats.ivRank <= 100);
    assert.ok(stats.iv > 0);
  });

  await test("backtest simulateTicker on synthetic bars", function () {
    var bars = [];
    for (var i = 0; i < 120; i++) {
      bars.push({ time: i * 86400, close: 100 + Math.sin(i / 10) * 5 });
    }
    var weekly = bars.filter(function (_, idx) { return idx % 5 === 0; });
    var r = backtestMod.simulateTicker("TEST", bars, weekly, 60, 119);
    assert.strictEqual(r.ticker, "TEST");
  });

  await test("buildIndicatorsFromBars returns MA levels", function () {
    var bars = [];
    for (var i = 0; i < 80; i++) bars.push({ time: i, close: 100 + i * 0.01 });
    var data = indicators.buildIndicatorsFromBars("TEST", bars, bars, 79, false);
    assert.ok(data.price > 0);
    assert.ok(data.levels.length >= 5);
  });

  console.log("\nalpha");

  var alphaMod = require("../utils/alpha");
  var vixMod = require("../utils/vix");
  var sectorsMod = require("../utils/sectors");
  var themesMod = require("../utils/themes");

  await test("VIX danger zones scale risk", function () {
    var calm = vixMod.zoneForVix(12);
    assert.strictEqual(calm.riskMult, 1);
    var high = vixMod.zoneForVix(25);
    assert.ok(high.riskMult < calm.riskMult);
    var crisis = vixMod.zoneForVix(55);
    assert.strictEqual(crisis.blockEntries, true);
  });

  await test("regime requires SPY and QQQ above 200D", function () {
    var results = {
      SPY: { price: 500, levels: [{ key: "d_sma200", value: 400 }] },
      QQQ: { price: 400, levels: [{ key: "d_sma200", value: 350 }] }
    };
    assert.strictEqual(alphaMod.isRegimeBullish(results), true);
    results.QQQ.price = 300;
    assert.strictEqual(alphaMod.isRegimeBullish(results), false);
  });

  await test("setup score ranks near 21D above 55D", function () {
    var data = {
      price: 110,
      levels: [
        { key: "d_ema21", near: true, value: 108 },
        { key: "d_sma55", value: 100 },
        { key: "d_sma200", value: 90 }
      ]
    };
    var setup = alphaMod.computeSetupScore(data, {
      regimeBullish: true,
      vix: { blockEntries: false, riskMult: 1, zone: "Calm" },
      rsInfo: { percentile: 80, rank: 2 },
      themeOk: true
    });
    assert.ok(setup.score >= alphaMod.SETUP_SCORE_MIN);
    assert.strictEqual(setup.tradeable, true);
  });

  await test("theme cap blocks more than max per theme", function () {
    paper.resetPortfolio("main");
    paper.buy("main", "MU", "d_ema21", "21-Day EMA", 100, 1, "test", 100);
    paper.buy("main", "SMH", "d_ema21", "21-Day EMA", 100, 1, "test", 100);
    assert.strictEqual(themesMod.canAddThemePosition("main", "DRAM"), false);
    assert.strictEqual(themesMod.canAddThemePosition("main", "AAPL"), true);
  });

  await test("sector rank sorts by week RS", function () {
    var ranks = {
      ok: true,
      sectors: [
        { ticker: "XLK", weekRs: 2, monthRs: 1, weekRank: 1, monthRank: 1, weekReturn: 3, monthReturn: 5 },
        { ticker: "XLE", weekRs: -1, monthRs: 0, weekRank: 2, monthRank: 2, weekReturn: 1, monthReturn: 2 }
      ],
      leadersWeek: ["XLK"],
      laggardsWeek: ["XLE"],
      spyWeekReturn: 1
    };
    var text = sectorsMod.formatSectorRankLines(ranks, "week");
    assert.ok(text.indexOf("XLK") !== -1);
    assert.ok(text.indexOf("Leading") !== -1);
  });

  console.log("\nindicators");

  await test("SPY has price, stopPrice, and MA levels", async function () {
    var r = await indicators.fetchTickerIndicators("SPY", null, false);
    assert.ok(r.price > 0);
    assert.ok(r.levels.length >= 5);
    assert.ok(r.stopPrice > 0);
  });

  if (fs.existsSync(process.env.DATA_DIR)) {
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
