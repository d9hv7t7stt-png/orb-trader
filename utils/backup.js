var fs = require("fs");
var path = require("path");
var paths = require("./paths");

var MAX_BACKUPS = parseInt(process.env.BACKUP_KEEP || "14", 10);

function backupDir() {
  return path.join(paths.DATA_DIR, "backups");
}

function timestampLabel(d) {
  d = d || new Date();
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function runBackup() {
  paths.ensureDataDir();
  var destRoot = backupDir();
  if (!fs.existsSync(destRoot)) fs.mkdirSync(destRoot, { recursive: true });

  var dest = path.join(destRoot, timestampLabel());
  fs.mkdirSync(dest, { recursive: true });

  var copied = [];
  paths.PERSIST_FILES.forEach(function (name) {
    var src = path.join(paths.DATA_DIR, name);
    if (!fs.existsSync(src)) return;
    fs.copyFileSync(src, path.join(dest, name));
    copied.push(name);
  });

  pruneOldBackups(destRoot);
  return { ok: true, dest: dest, files: copied, at: new Date().toISOString() };
}

function pruneOldBackups(root) {
  if (!fs.existsSync(root)) return;
  var dirs = fs.readdirSync(root).map(function (name) {
    return { name: name, path: path.join(root, name), mtime: fs.statSync(path.join(root, name)).mtimeMs };
  }).filter(function (d) { return fs.statSync(d.path).isDirectory(); })
    .sort(function (a, b) { return b.mtime - a.mtime; });
  dirs.slice(MAX_BACKUPS).forEach(function (d) {
    fs.rmSync(d.path, { recursive: true, force: true });
  });
}

function scheduleBackups() {
  var intervalH = parseInt(process.env.BACKUP_INTERVAL_HOURS || "24", 10);
  try {
    var first = runBackup();
    console.log("[Backup] Snapshot → " + first.dest + " (" + first.files.length + " files)");
  } catch (e) {
    console.error("[Backup] Startup backup failed:", e.message);
  }
  setInterval(function () {
    try {
      var result = runBackup();
      console.log("[Backup] Snapshot → " + result.dest);
    } catch (e) {
      console.error("[Backup] Scheduled backup failed:", e.message);
    }
  }, intervalH * 3600000);
}

module.exports = {
  runBackup: runBackup,
  scheduleBackups: scheduleBackups,
  backupDir: backupDir
};
