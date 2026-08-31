var fs = require("fs");
var path = require("path");

var DATA_DIR = process.env.DATA_DIR || "/data";
var EPHEMERAL_DIR = "/tmp";
var PERSIST_FILES = [
  "paper-portfolio.json",
  "paper-portfolio-main.json",
  "paper-portfolio-space_dc.json",
  "stock-trader-state.json"
];

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error("[Paths] Cannot create DATA_DIR:", DATA_DIR, e.message);
  }
}

function migrateFromEphemeralDir() {
  if (path.resolve(DATA_DIR) !== path.resolve("/data")) return 0;
  ensureDataDir();
  var migrated = 0;
  PERSIST_FILES.forEach(function (name) {
    var src = path.join(EPHEMERAL_DIR, name);
    var dest = path.join(DATA_DIR, name);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      migrated++;
      console.log("[Paths] Migrated " + name + " from " + EPHEMERAL_DIR + " → " + DATA_DIR);
    }
  });
  return migrated;
}

function dataPath(filename) {
  ensureDataDir();
  return path.join(DATA_DIR, filename);
}

module.exports = {
  DATA_DIR: DATA_DIR,
  EPHEMERAL_DIR: EPHEMERAL_DIR,
  PERSIST_FILES: PERSIST_FILES,
  dataPath: dataPath,
  ensureDataDir: ensureDataDir,
  migrateFromEphemeralDir: migrateFromEphemeralDir
};

if (path.resolve(DATA_DIR) === path.resolve("/data")) {
  migrateFromEphemeralDir();
}
