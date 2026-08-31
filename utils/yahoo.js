var https = require("https");

function getJson(hostname, path, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  return new Promise(function (resolve) {
    var req = https.request({
      hostname: hostname,
      path: path,
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" }
    }, function (res) {
      var raw = "";
      res.on("data", function (c) { raw += c; });
      res.on("end", function () {
        try {
          if (res.statusCode && res.statusCode >= 400) return resolve(null);
          resolve(JSON.parse(raw));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on("error", function () { resolve(null); });
    req.setTimeout(timeoutMs, function () { req.destroy(); resolve(null); });
    req.end();
  });
}

module.exports = {
  getJson: getJson
};
