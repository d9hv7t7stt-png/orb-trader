var indicators = require("./indicators");

var VIX_BOTTOM = parseFloat(process.env.VIX_BOTTOM || "12.12");
var VIX_LEVELS = (process.env.VIX_DANGER_LEVELS || "15.04,16.83,20,21.51,30,36.11,50")
  .split(",")
  .map(function (v) { return parseFloat(v.trim()); })
  .filter(function (v) { return !isNaN(v); })
  .sort(function (a, b) { return a - b; });

var CACHE_MS = parseInt(process.env.VIX_CACHE_SEC || "300", 10) * 1000;
var cache = null;

function dangerZones() {
  return VIX_LEVELS.slice();
}

function zoneForVix(vix) {
  if (vix == null || isNaN(vix)) {
    return { level: 0, label: "Unknown", riskMult: 0.5, blockEntries: false };
  }
  if (vix <= VIX_BOTTOM) {
    return { level: 0, label: "Calm", riskMult: 1.0, blockEntries: false };
  }
  var idx = 0;
  for (var i = 0; i < VIX_LEVELS.length; i++) {
    if (vix <= VIX_LEVELS[i]) {
      return zoneMeta(i + 1, vix);
    }
    idx = i + 1;
  }
  return zoneMeta(idx + 1, vix, true);
}

function zoneMeta(level, vix, extreme) {
  var labels = ["Calm", "Caution", "Elevated", "High", "Very High", "Severe", "Extreme", "Crisis"];
  var mults = [1.0, 0.85, 0.7, 0.55, 0.4, 0.25, 0.15, 0];
  var label = labels[Math.min(level, labels.length - 1)] || "Crisis";
  var riskMult = mults[Math.min(level, mults.length - 1)];
  if (extreme) {
    label = "Crisis";
    riskMult = 0;
  }
  return {
    level: level,
    label: label,
    riskMult: riskMult,
    blockEntries: riskMult <= 0,
    vix: vix
  };
}

async function fetchVix() {
  if (cache && Date.now() - cache.ts < CACHE_MS) return cache.data;
  var chart = await indicators.yahooChart("^VIX", "1d", "1mo");
  var vix = chart && chart.price != null ? chart.price : null;
  if (vix == null && chart && chart.bars.length) {
    vix = chart.bars[chart.bars.length - 1].close;
  }
  var zone = zoneForVix(vix);
  var data = {
    vix: vix != null ? parseFloat(vix.toFixed(2)) : null,
    bottom: VIX_BOTTOM,
    dangerLevels: dangerZones(),
    zone: zone.label,
    zoneLevel: zone.level,
    riskMult: zone.riskMult,
    blockEntries: zone.blockEntries
  };
  cache = { data: data, ts: Date.now() };
  return data;
}

function formatVixLine(vixData) {
  if (!vixData || vixData.vix == null) return "VIX —";
  return "VIX " + vixData.vix + " · " + vixData.zone + " · size ×" + vixData.riskMult;
}

module.exports = {
  fetchVix: fetchVix,
  zoneForVix: zoneForVix,
  formatVixLine: formatVixLine,
  VIX_BOTTOM: VIX_BOTTOM,
  VIX_LEVELS: VIX_LEVELS
};
