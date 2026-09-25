// Мініатюри картинок полотна. Оригінали карт — тисячі пікселів завбільшки, і
// браузер тримає кожен у пам'яті розпакованим: ширина × висота × 4 байти. На
// загальному плані з них видно кілька сотень пікселів, тож полотно показує
// зменшену копію, а оригінал бере лише тоді, коли картинку справді розглядають.

// Карти й зображення дошки: той самий розмір, що й мініатюра при вставці, —
// тож уже збережені в кеші на диску підходять як є.
export const BOARD_THUMBNAIL_SIZE = 1200;
// Портрет займає лише частину картки, тож йому досить меншої копії.
export const PORTRAIT_THUMBNAIL_SIZE = 512;
// Оригінал потрібен, коли на екрані картинка вже майже така, як мініатюра:
// далі та почала б розмиватися.
const FULL_IMAGE_COVERAGE = 0.75;

export function wantsFullImage(screenWidth, thumbnailSize) {
  return screenWidth >= thumbnailSize * FULL_IMAGE_COVERAGE;
}

// Кожне зменшення розпаковує оригінал цілком, тож робимо їх по одному: інакше
// на старті всі карти розпакувалися б разом — той самий пік пам'яті, від
// якого мініатюри й рятують. Готова мініатюра за шляхом і розміром одна на
// сесію; `persist` ще й кладе її в кеш на диску, щоб наступного разу не
// зменшувати наново.
export function createThumbnails({ readCached, saveCached, readOriginal, shrink, toUrl = (blob) => URL.createObjectURL(blob) }) {
  const urls = new Map();
  let queue = Promise.resolve();

  async function load(path, size, persist) {
    const cached = persist ? await readCached(path).catch(() => null) : null;
    if (cached) return toUrl(cached);
    const task = queue.then(async () => shrink(await readOriginal(path), size));
    queue = task.catch(() => {});
    const blob = await task;
    if (persist) saveCached(path, blob).catch((error) => console.warn(error));
    return toUrl(blob);
  }

  return {
    url(path, size, { persist = false } = {}) {
      const key = `${size}:${path}`;
      if (!urls.has(key)) {
        const pending = load(path, size, persist);
        // Невдачу не запам'ятовуємо: наступний запит спробує ще раз.
        pending.catch(() => urls.delete(key));
        urls.set(key, pending);
      }
      return urls.get(key);
    },
  };
}
