// US equity session in America/New_York (handles DST automatically)

function etParts(date) {
  date = date || new Date();
  var fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short"
  });
  var parts = fmt.formatToParts(date);
  var map = {};
  parts.forEach(function (p) { map[p.type] = p.value; });
  return {
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    weekday: map.weekday
  };
}

function isWeekday(date) {
  var wd = etParts(date).weekday;
  return wd !== "Sat" && wd !== "Sun";
}

function etMinutes(date) {
  var p = etParts(date);
  return p.hour * 60 + p.minute;
}

function isMarketHours(date) {
  date = date || new Date();
  if (!isWeekday(date)) return false;
  var mins = etMinutes(date);
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function isAfterBell(date) {
  date = date || new Date();
  if (!isWeekday(date)) return false;
  return etMinutes(date) >= 16 * 60 + 5;
}

function msUntilAfterBell(from) {
  from = from || new Date();
  for (var addMs = 60000; addMs <= 8 * 86400000; addMs += 60000) {
    var t = new Date(from.getTime() + addMs);
    var p = etParts(t);
    if (isWeekday(t) && p.hour === 16 && p.minute === 5) {
      return addMs;
    }
  }
  return 86400000;
}

module.exports = {
  isMarketHours: isMarketHours,
  isAfterBell: isAfterBell,
  isWeekday: isWeekday,
  msUntilAfterBell: msUntilAfterBell,
  etParts: etParts
};
