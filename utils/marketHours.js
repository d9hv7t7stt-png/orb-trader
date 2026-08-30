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
  var hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // some runtimes emit 24 for midnight
  return {
    hour: hour,
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

function etDateKey(date) {
  date = date || new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
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

function msUntilEtClock(weekday, hour, minute, from) {
  from = from || new Date();
  hour = parseInt(hour, 10);
  minute = parseInt(minute, 10);
  for (var addMs = 60000; addMs <= 8 * 86400000; addMs += 60000) {
    var t = new Date(from.getTime() + addMs);
    var p = etParts(t);
    if (weekday && p.weekday !== weekday) continue;
    if (p.hour === hour && p.minute === minute) return addMs;
  }
  return 86400000;
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

function formatHourEt(hour24) {
  hour24 = parseInt(hour24, 10);
  if (isNaN(hour24)) hour24 = 0;
  var suffix = hour24 >= 12 ? "PM" : "AM";
  var h12 = hour24 % 12;
  if (h12 === 0) h12 = 12;
  return h12 + ":00 " + suffix + " ET";
}

// Sunday week-ahead briefing (default 3:00 PM ET)
function sundayPremarketHour() {
  var h = parseInt(process.env.SUNDAY_PREMARKET_HOUR || "15", 10);
  if (isNaN(h) || h < 0 || h > 23) return 15;
  return h;
}

function sundayPremarketLabel() {
  return formatHourEt(sundayPremarketHour());
}

function msUntilSundayPremarket(from) {
  return msUntilEtClock("Sun", sundayPremarketHour(), 0, from);
}

module.exports = {
  isMarketHours: isMarketHours,
  isAfterBell: isAfterBell,
  isWeekday: isWeekday,
  msUntilAfterBell: msUntilAfterBell,
  msUntilSundayPremarket: msUntilSundayPremarket,
  sundayPremarketHour: sundayPremarketHour,
  sundayPremarketLabel: sundayPremarketLabel,
  formatHourEt: formatHourEt,
  etDateKey: etDateKey,
  etParts: etParts
};
