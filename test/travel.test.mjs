import assert from "node:assert/strict";
import test from "node:test";
import {
  CALIBRATION_MILES,
  TRAVEL_MODES,
  formatMiles,
  formatTravelTime,
  milesLabel,
  parseScale,
  plural,
  routeLength,
  routeMiles,
  scaleFromCalibration,
  travelEstimates,
  travelTime,
} from "../public/travel.js";

const mode = (id) => TRAVEL_MODES.find((entry) => entry.id === id);

test("calibration turns a hundred-mile stretch into units per mile", () => {
  assert.equal(scaleFromCalibration({ x: 100, y: 200 }, { x: 400, y: 600 }, CALIBRATION_MILES), 5);
  assert.equal(scaleFromCalibration({ x: 10, y: 10 }, { x: 10, y: 10 }), null);
  assert.equal(scaleFromCalibration({ x: 0, y: 0 }, { x: 100, y: 0 }, 0), null);
});

test("a stored scale is only trusted when it is a positive number", () => {
  assert.equal(parseScale("12.5"), 12.5);
  assert.equal(parseScale(null), null);
  assert.equal(parseScale("0"), null);
  assert.equal(parseScale("-3"), null);
  assert.equal(parseScale("далеко"), null);
});

test("the route adds up its segments and stays silent without a scale", () => {
  const points = [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 140 }];
  assert.equal(routeLength(points), 150);
  assert.equal(routeLength([{ x: 5, y: 5 }]), 0);
  assert.equal(routeMiles(points, 5), 30);
  assert.equal(routeMiles(points, null), null);
});

test("travel paces keep the book numbers, day column included", () => {
  assert.deepEqual(
    ["foot-slow", "foot", "foot-fast"].map((id) => [mode(id).milesPerHour, mode(id).milesPerDay]),
    [[2, 18], [3, 24], [4, 30]],
  );
  assert.deepEqual([mode("wagon").milesPerHour, mode("wagon").milesPerDay], [3, 24]);
  // Кораблі йдуть цілодобово, тож добовий шлях — це швидкість судна на 24.
  for (const id of ["sailing-ship", "longship", "galley"]) {
    assert.equal(mode(id).hoursPerDay, 24);
    assert.equal(mode(id).milesPerDay, mode(id).milesPerHour * 24);
  }
});

test("whole days come from the day column and the tail from the hour column", () => {
  assert.deepEqual(travelTime(24, mode("foot")), { days: 1, hours: 0, minutes: 0 });
  assert.deepEqual(travelTime(30, mode("foot")), { days: 1, hours: 2, minutes: 120 });
  assert.deepEqual(travelTime(9, mode("foot")), { days: 0, hours: 3, minutes: 180 });
  // Швидкий темп — 4 милі/год, але 30 за день: залишок не 32-мильний.
  assert.deepEqual(travelTime(34, mode("foot-fast")), { days: 1, hours: 1, minutes: 60 });
});

test("a tail that no longer fits into a marching day rounds up to one", () => {
  assert.equal(formatTravelTime(17, mode("foot-slow")), "1 день");
  assert.equal(formatTravelTime(23, mode("foot")), "1 день");
});

test("duration counts days of marching, not calendar days", () => {
  assert.equal(formatTravelTime(1.5, mode("foot")), "30 хв");
  assert.equal(formatTravelTime(6, mode("foot")), "2 год");
  assert.equal(formatTravelTime(48, mode("foot")), "2 дні");
  assert.equal(formatTravelTime(24 * 5, mode("foot")), "5 днів");
  assert.equal(formatTravelTime(24 * 11, mode("foot")), "11 днів");
  // Ходовий день корабля — ціла доба, тому та сама відстань дається дешевше.
  assert.equal(formatTravelTime(48, mode("galley")), "12 год");
  assert.equal(formatTravelTime(96, mode("galley")), "1 день");
  assert.equal(formatTravelTime(200, mode("sailing-ship")), "4 дні 4 год");
});

test("short routes keep a decimal, long ones round to whole miles", () => {
  assert.equal(formatMiles(3.42), "3,4");
  assert.equal(formatMiles(0), "0,0");
  assert.equal(formatMiles(146.7), "147");
  assert.equal(milesLabel(3.42), "3,4 милі");
  assert.equal(milesLabel(21), "21 миля");
  assert.equal(milesLabel(24), "24 милі");
  assert.equal(milesLabel(147), "147 миль");
  assert.equal(milesLabel(112), "112 миль");
});

test("plural picks the Ukrainian form", () => {
  assert.deepEqual(
    [1, 2, 5, 11, 14, 21, 22, 25].map((count) => plural(count, "день", "дні", "днів")),
    ["день", "дні", "днів", "днів", "днів", "день", "дні", "днів"],
  );
});

test("estimates keep every mode and hang a duration on each", () => {
  const rows = travelEstimates(48);
  assert.equal(rows.length, TRAVEL_MODES.length);
  assert.equal(rows.find((row) => row.id === "foot").duration, "2 дні");
  assert.equal(rows.find((row) => row.id === "galley").duration, "12 год");
});
