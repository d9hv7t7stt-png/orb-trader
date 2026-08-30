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

  await test("startupScanForced mirrors isMarketHours", function () {
    assert.strictEqual(scanner.startupScanForced(), marketHours.isMarketHours());
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

  console.log("\ndiscord");
  var discord = require("../utils/discord");

  await test("Sunday premarket builds one embed per pool", function () {
    paper.resetPortfolio("main");
    paper.resetPortfolio("space_dc");
    var embeds = discord.buildSundayPremarketEmbeds({});
    assert.strictEqual(embeds.length, 2);
    assert.ok(embeds[0].title.indexOf("Main") !== -1);
    assert.ok(embeds[1].title.indexOf("Space DC") !== -1);
    assert.ok(embeds.every(function (e) { return e.title.indexOf("SUNDAY PREMARKET") !== -1; }));
    assert.ok(embeds[0].fields.some(function (f) { return f.name === "Equity"; }));
    assert.ok(embeds[0].description.indexOf("3:00 PM ET") !== -1);
    var blob = JSON.stringify(embeds).toLowerCase();
    assert.strictEqual(blob.indexOf("paper") === -1, true, "Discord copy must not mention paper trading");
    assert.strictEqual(blob.indexOf("(watch)") === -1, true);
    assert.strictEqual(blob.indexOf("zzz") === -1, true);
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

  console.log("\nindicators");
  var indicators = require("../utils/indicators");

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
