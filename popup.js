// popup.js — Yandex Music Track Collector v1.3

let isCollecting = false;

// ---- Утилиты ----
function esc(str) {
  return (str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildTxt(tracks) {
  return tracks.map(t => `${t.artists || 'Unknown'} — ${t.title || 'Unknown'}`).join('\n');
}

function buildCsv(tracks) {
  const rows = tracks.map(t => {
    const a = `"${(t.artists || '').replace(/"/g,'""')}"`;
    const b = `"${(t.title   || '').replace(/"/g,'""')}"`;
    return `${a},${b}`;
  });
  return 'Artist,Title\n' + rows.join('\n');
}

function triggerDownload(content, filename, mime) {
  const blob = new Blob(['\uFEFF' + content], { type: mime + ';charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
}

// ---- Статус ----
function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

// ---- Рендер списка (в порядке массива) ----
function renderList(tracks) {
  document.getElementById('count').textContent = tracks.length;
  const container = document.getElementById('trackContainer');

  if (!tracks.length) {
    container.innerHTML = '<div class="empty">Нет треков.<br>Откройте плейлист, нажмите «Начать сбор»<br>и медленно прокручивайте вниз.</div>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'track-list';

  tracks.forEach((t, i) => {
    const item = document.createElement('div');
    item.className = 'track-item';
    item.innerHTML = `
      <span class="track-num">${i + 1}.</span>
      <div class="track-text">
        <div class="track-artist">${esc(t.artists || '—')}</div>
        <div class="track-title">${esc(t.title || '—')}</div>
      </div>
    `;
    list.appendChild(item);
  });

  container.innerHTML = '';
  container.appendChild(list);
}

// ---- Кнопка Старт/Стоп ----
function setCollectState(collecting) {
  isCollecting = collecting;
  const btn   = document.getElementById('btnCollect');
  const label = document.getElementById('collectLabel');

  if (collecting) {
    btn.className = 'btn-collect running';
    label.textContent = 'Остановить сбор';
    setStatus('Сбор активен — прокручивайте плейлист вниз');
  } else {
    btn.className = 'btn-collect stopped';
    label.textContent = 'Начать сбор';
  }
}

// ---- Получить активную вкладку ЯМ ----
function getYMTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab) { setStatus('⚠ Нет активной вкладки'); return; }
    if (!(tab.url || '').includes('music.yandex.')) {
      setStatus('⚠ Откройте Яндекс.Музыку в активной вкладке');
      return;
    }
    callback(tab.id);
  });
}

function sendMsg(tabId, action, cb) {
  chrome.tabs.sendMessage(tabId, { action }, resp => {
    if (chrome.runtime.lastError) {
      setStatus('⚠ Перезагрузите вкладку ЯМ (F5)');
      return;
    }
    if (cb) cb(resp);
  });
}

// ---- Сообщения от content script ----
chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'tracksUpdated') {
    document.getElementById('count').textContent = msg.count;
    // Обновляем список живым образом
    chrome.storage.local.get('tracks', data => {
      renderList(data.tracks || []);
      // Прокручиваем к последнему элементу
      const list = document.querySelector('.track-list');
      if (list) list.scrollTop = list.scrollHeight;
    });
  }
});

// ---- Инициализация ----
document.addEventListener('DOMContentLoaded', () => {

  // Загружаем треки и текущее состояние
  chrome.storage.local.get('tracks', data => {
    renderList(data.tracks || []);
  });

  // Проверяем состояние content script
  getYMTab(tabId => {
    sendMsg(tabId, 'getState', resp => {
      if (resp && resp.collecting) setCollectState(true);
    });
  });

  // ---- СТАРТ / СТОП ----
  document.getElementById('btnCollect').addEventListener('click', () => {
    getYMTab(tabId => {
      if (isCollecting) {
        sendMsg(tabId, 'stopCollect', resp => {
          if (resp && resp.ok) {
            setCollectState(false);
            chrome.storage.local.get('tracks', d => {
              const t = d.tracks || [];
              setStatus(`Остановлено. Собрано: ${t.length} треков`);
            });
          }
        });
      } else {
        sendMsg(tabId, 'startCollect', resp => {
          if (resp && resp.ok) setCollectState(true);
        });
      }
    });
  });

  // ---- СКАЧАТЬ TXT ----
  document.getElementById('downloadTxt').addEventListener('click', () => {
    chrome.storage.local.get('tracks', d => {
      const t = d.tracks || [];
      if (!t.length) { setStatus('Нет треков для скачивания'); return; }
      triggerDownload(buildTxt(t), 'tracks.txt', 'text/plain');
      setStatus(`Скачивается ${t.length} треков...`);
    });
  });

  // ---- СКАЧАТЬ CSV ----
  document.getElementById('downloadCsv').addEventListener('click', () => {
    chrome.storage.local.get('tracks', d => {
      const t = d.tracks || [];
      if (!t.length) { setStatus('Нет треков для скачивания'); return; }
      triggerDownload(buildCsv(t), 'tracks.csv', 'text/csv');
      setStatus(`Скачивается ${t.length} треков...`);
    });
  });

  // ---- СБРОС ----
  document.getElementById('resetTracks').addEventListener('click', () => {
    chrome.storage.local.get('tracks', d => {
      const count = (d.tracks || []).length;
      if (!confirm(`Удалить все ${count} треков и начать заново?`)) return;

      chrome.storage.local.remove('tracks', () => {
        renderList([]);
        setCollectState(false);
        setStatus('Сброшено. Нажмите «Начать сбор» снова.');

        getYMTab(tabId => sendMsg(tabId, 'clearTracks'));
      });
    });
  });

});
