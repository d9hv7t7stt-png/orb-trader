var fs = require("fs");
var path = require("path");

var DATA_DIR = process.env.DATA_DIR || "/tmp";

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error("[Paths] Cannot create DATA_DIR:", DATA_DIR, e.message);
  }
}

function dataPath(filename) {
  ensureDataDir();
  return path.join(DATA_DIR, filename);
}

module.exports = {
  DATA_DIR: DATA_DIR,
  dataPath: dataPath,
  ensureDataDir: ensureDataDir
};
