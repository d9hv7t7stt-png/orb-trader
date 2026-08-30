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
      if (!paper.hasPosition("main", "TEST", maKey)) {
        var trade = paper.buy("main", "TEST", maKey, maKey, 100, 5, "test", 500);
        if (trade) alreadyIn = true;
      }
    });
    assert.strictEqual(paper.getOpenPositions("main").length, 1);
  });

  await test("pools have separate portfolios", function () {
    paper.resetPortfolio("main");
    paper.resetPortfolio("space_dc");
    paper.buy("main", "SPY", "d_ema21", "21-Day EMA", 500, 1, "test", 1000);
    paper.buy("space_dc", "SPY", "d_ema21", "21-Day EMA", 500, 1, "test", 1000);
    assert.strictEqual(paper.getOpenPositions("main").length, 1);
    assert.strictEqual(paper.getOpenPositions("space_dc").length, 1);
  });

  await test("getPositionSizeUSD is at least $100", function () {
    paper.resetPortfolio("main");
    assert.ok(paper.getPositionSizeUSD("main", {}) >= 100);
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
