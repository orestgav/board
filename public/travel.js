// Темпи руху — PHB «Travel Pace» (с. 182), «Mounts and Vehicles» (с. 157) і
// «Waterborne Vehicles» (с. 119); довжина ходового дня — звідти ж: пішки й
// возом день триває 8 годин переходу, а корабель із повною командою йде
// цілодобово. Тут лише числа й арифметика — вимірювання на полотні робить
// сторінка.

// Калібрування просить саме сотню миль: на масштабній лінійці карти це
// звичний відрізок, а похибка кліку розмазується на сто миль замість однієї.
export const CALIBRATION_MILES = 100;

const MINUTES_PER_HOUR = 60;

// Добова відстань не виводиться з годинної: у книжці швидкий темп — це 4 милі
// на годину, але 30 за день, а не 32. Обидві колонки взяті з таблиці як є.
export const TRAVEL_MODES = [
  { id: "foot-slow", label: "Пішки повільно", milesPerHour: 2, milesPerDay: 18, hoursPerDay: 8, note: "можна крастися" },
  { id: "foot", label: "Пішки", milesPerHour: 3, milesPerDay: 24, hoursPerDay: 8, note: "" },
  { id: "foot-fast", label: "Пішки швидко", milesPerHour: 4, milesPerDay: 30, hoursPerDay: 8, note: "−5 до пасивного Сприйняття" },
  // Власної добової швидкості книжка ні коневі, ні возу не дає — загін просто
  // обирає темп. Кінь стоїть на швидкому (його й тримає галоп), віз — на
  // звичайному; це вибір дошки, а не рядок таблиці.
  { id: "mount", label: "Верхи", milesPerHour: 4, milesPerDay: 30, hoursPerDay: 8, note: "галоп ×2, але не довше години" },
  { id: "wagon", label: "Возом", milesPerHour: 3, milesPerDay: 24, hoursPerDay: 8, note: "темп обирається як пішки" },
  // Партія ходить власним кораблем, тож решта суден лежить прихованою: числа
  // на місці, і повернути рядок — це зняти `hidden`.
  { id: "sailing-ship", label: "Вітрильник", milesPerHour: 2, milesPerDay: 48, hoursPerDay: 24, note: "", hidden: true },
  { id: "longship", label: "Довгий човен", milesPerHour: 3, milesPerDay: 72, hoursPerDay: 24, note: "", hidden: true },
  // «Росінант» — корвет, найшвидший у гавані Кардоси; власних статів картка
  // корабля не дає, тому він іде за галерою — найпрудкішим судном таблиці.
  { id: "rosinant", label: "Росінант", milesPerHour: 4, milesPerDay: 96, hoursPerDay: 24, note: "швидкість галери" },
];

// Українська форма числа: 1 день, 2 дні, 5 днів; 11–14 завжди «днів».
export function plural(count, one, few, many) {
  const tens = Math.abs(count) % 100;
  const units = Math.abs(count) % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}

export function routeLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return total;
}

// Масштаб живе в одиницях полотна на милю, а не в екранних пікселях: екранні
// змінюються з кожним зумом, а світові — ні.
export function scaleFromCalibration(first, second, miles = CALIBRATION_MILES) {
  const length = Math.hypot(second.x - first.x, second.y - first.y);
  if (!(length > 0) || !(miles > 0)) return null;
  return length / miles;
}

export function parseScale(raw) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function routeMiles(points, unitsPerMile) {
  if (!(unitsPerMile > 0)) return null;
  return routeLength(points) / unitsPerMile;
}

// Цілі дні відлічуються за добовою колонкою, залишок — за годинною: саме так
// рахує ДМ за столом, і саме тому обидві колонки потрібні окремо.
export function travelTime(miles, { milesPerHour, milesPerDay, hoursPerDay }) {
  let days = Math.floor(Math.max(0, miles) / milesPerDay);
  const minutes = Math.round((miles - days * milesPerDay) / milesPerHour * MINUTES_PER_HOUR);
  let hours = Math.round(minutes / MINUTES_PER_HOUR);
  // Залишок, що вже не влазить у ходовий день, — це просто ще один день.
  if (hours >= hoursPerDay) {
    days += 1;
    hours = 0;
  }
  return { days, hours, minutes };
}

export function formatTravelTime(miles, mode) {
  const { days, hours, minutes } = travelTime(miles, mode);
  // Менше години ще міряють хвилинами: «1 год» замість сорока хвилин збиває з
  // пантелику там, де важить кожен привал.
  if (!days && minutes < MINUTES_PER_HOUR) return `${minutes} хв`;
  if (!days) return `${hours} год`;
  const dayText = `${days} ${plural(days, "день", "дні", "днів")}`;
  return hours ? `${dayText} ${hours} год` : dayText;
}

// Коротка дорога міряється з десятою: різниця між 3 і 3,4 милі — це ще один
// привал. Довга такої точності не тримає — там бреше вже сам клік по карті.
export function formatMiles(miles) {
  return miles < 10 ? miles.toFixed(1).replace(".", ",") : String(Math.round(miles));
}

export function milesLabel(miles) {
  const text = formatMiles(miles);
  // Дробове число тягне за собою родовий однини — «3,4 милі».
  return text.includes(",") ? `${text} милі` : `${text} ${plural(Number(text), "миля", "милі", "миль")}`;
}

export function travelEstimates(miles, modes = TRAVEL_MODES) {
  return modes.filter((mode) => !mode.hidden).map((mode) => ({ ...mode, duration: formatTravelTime(miles, mode) }));
}
