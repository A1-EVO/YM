// ============================================================
// content.js — Yandex Music Track Collector v1.3
// - Парсинг только когда включён (Старт/Стоп)
// - Треки хранятся в массиве — порядок прокрутки сохраняется
// - Очистка текста от NBSP и невидимых символов
// ============================================================

// Флаг — активен ли сбор
let isCollecting = false;

// Set ID уже добавленных треков (для быстрой проверки дублей)
const seen = new Set();

// ---- Инициализация: восстанавливаем seen из storage ----
chrome.storage.local.get('tracks', data => {
  const tracks = data.tracks || [];
  tracks.forEach(t => seen.add(t.id));
  updateBadge(tracks.length);
  console.log(`[YM Collector] Loaded ${seen.size} tracks from storage`);
});

// ---- Очистка текста от мусора ----
// Убирает: неразрывный пробел (\u00A0), нулевые пробелы, мягкий дефис,
// BOM, невидимые разделители, управляющие символы
function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/\u00A0/g, ' ')                        // неразрывный пробел → обычный
    .replace(/[\u200B-\u200F\u00AD\uFEFF\u2060]/g, '') // нулевые пробелы, BOM и т.п.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // управляющие символы
    .replace(/\s+/g, ' ')                           // несколько пробелов → один
    .trim();
}

// ---- Поиск контейнеров треков в DOM ----
function findTrackElements() {
  // Основной: реальный DOM ЯМ — class содержит "HorizontalCardContainer_root"
  let items = document.querySelectorAll('[class*="HorizontalCardContainer_root"]');
  if (items.length > 0) return items;

  // Запасной 1: CommonTrack_root
  items = document.querySelectorAll('[class*="CommonTrack_root"]');
  if (items.length > 0) return items;

  // Запасной 2: структурный — ищем родителей ссылок на треки
  const links = document.querySelectorAll('a[href*="/track/"]');
  const parents = new Map();
  links.forEach(a => {
    let el = a;
    for (let i = 0; i < 6; i++) {
      el = el.parentElement;
      if (!el) break;
      if (el.querySelectorAll('a[href*="/track/"]').length === 1) {
        parents.set(el, true);
        break;
      }
    }
  });
  return [...parents.keys()];
}

// ---- Извлечение данных из элемента ----
function extractTrackId(el) {
  const a = el.querySelector('a[href*="/track/"]');
  if (!a) return null;
  return (a.getAttribute('href') || '').split('?')[0].split('#')[0];
}

function extractTitle(el) {
  // Реальный DOM: span[class*="Meta_title"]
  const titleEl = el.querySelector('[class*="Meta_title"]');
  if (titleEl) return cleanText(titleEl.textContent);
  // Запасной: текст ссылки на трек
  const a = el.querySelector('a[href*="/track/"]');
  return a ? cleanText(a.textContent) : '';
}

function extractArtists(el) {
  // Реальный DOM: a[href*="/artist/"] — может быть несколько (feat.)
  const artistLinks = el.querySelectorAll('a[href*="/artist/"]');
  if (artistLinks.length > 0) {
    const names = [...new Set(
      [...artistLinks].map(a => cleanText(a.textContent)).filter(Boolean)
    )];
    return names.join(', ');
  }
  const artistEl = el.querySelector('[class*="Meta_artists"], [class*="Meta_artistCaption"]');
  return artistEl ? cleanText(artistEl.textContent) : '';
}

// ---- Основная функция сбора ----
function extractTracks() {
  if (!isCollecting) return;

  const elements = findTrackElements();
  if (!elements.length) return;

  // Собираем новые треки в ПОРЯДКЕ DOM (порядок прокрутки)
  const newTracks = [];
  elements.forEach(el => {
    const id = extractTrackId(el);
    if (!id || seen.has(id)) return;

    const title   = extractTitle(el);
    const artists = extractArtists(el);
    if (!title) return;

    seen.add(id);
    newTracks.push({ id, title, artists });
    console.log(`[YM Collector] +1 "${artists} — ${title}"`);
  });

  if (newTracks.length === 0) return;

  // Дописываем в конец массива — порядок сохраняется
  chrome.storage.local.get('tracks', data => {
    const tracks = [...(data.tracks || []), ...newTracks];
    chrome.storage.local.set({ tracks }, () => {
      updateBadge(tracks.length);
      // Уведомляем popup о новых треках
      chrome.runtime.sendMessage({ action: 'tracksUpdated', count: tracks.length })
        .catch(() => {});
    });
  });
}

// ---- Обновление бейджа через background ----
function updateBadge(count) {
  chrome.runtime.sendMessage({ action: 'updateBadge', count }).catch(() => {});
}

// ---- Debounce ----
let debounceTimer = null;
function debouncedExtract(delay) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(extractTracks, delay);
}

// ---- Scroll listener — срабатывает только при isCollecting ----
window.addEventListener('scroll',   () => { if (isCollecting) debouncedExtract(400); }, { passive: true });
document.addEventListener('scroll', () => { if (isCollecting) debouncedExtract(400); }, { passive: true });

// ---- MutationObserver — виртуализированный список DOM ----
const observer = new MutationObserver(() => {
  if (isCollecting) debouncedExtract(600);
});
observer.observe(document.body, { childList: true, subtree: true });

// ---- Команды из popup ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'startCollect') {
    isCollecting = true;
    console.log('[YM Collector] Collection STARTED');
    extractTracks(); // сразу парсим текущий экран
    sendResponse({ ok: true, collecting: true });

  } else if (msg.action === 'stopCollect') {
    isCollecting = false;
    console.log('[YM Collector] Collection STOPPED');
    sendResponse({ ok: true, collecting: false });

  } else if (msg.action === 'clearTracks') {
    isCollecting = false;
    seen.clear();
    updateBadge(0);
    console.log('[YM Collector] Tracks CLEARED');
    sendResponse({ ok: true });

  } else if (msg.action === 'getState') {
    sendResponse({ ok: true, collecting: isCollecting });
  }

  return true; // async
});
