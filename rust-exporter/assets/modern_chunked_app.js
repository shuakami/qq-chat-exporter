/*!
 * QQ Chat Exporter Pro - Modern Chunked Viewer
 * - Streaming + Chunking + Indexing + Windowed rendering (no-OOM)
 * - 保持原 UI（toolbar/主题/时间范围/成员筛选/搜索）一致
 *
 * 数据协议（由导出器生成）：
 * - data/manifest.js: window.__QCE_MANIFEST__(manifest)
 * - data/chunks/c000001.js: window.__QCE_CHUNK__(chunk)
 * - data/index/msgid_bXX.js: window.__QCE_MSGID_INDEX__(bucket, pairs)
 */
(function () {
  'use strict';

  var manifest = null;
  var domReady = false;
  var initialized = false;

  // caches
  var chunkCache = new Map(); // chunkId -> chunkData
  var pendingChunk = new Map(); // chunkId -> { promise, resolve, reject }

  var msgIdToChunkId = new Map(); // domMsgId -> chunkId
  var loadedMsgIndexBuckets = new Set();
  var pendingMsgIndexBuckets = new Map(); // bucket -> { promise, resolve, reject }

  // active chunk list after applying chunk-level filters
  var activeChunks = [];
  var activePosByChunkId = new Map(); // chunkId -> activePos

  // rendered window state
  var rendered = []; // { pos:number, chunkId:string, el:HTMLElement|null, visibleCount:number }
  var loadedStartPos = 0;
  var loadedEndPos = -1;

  var isLoadingNext = false;
  var isLoadingPrev = false;

  // filter state
  var filterState = {
    searchTerm: '',
    searchLower: '',
    senderUid: null, // string | null
    startDate: '',
    endDate: ''
  };

  // UI refs
  var ui = {
    chatContent: null,
    topSentinel: null,
    bottomSentinel: null,

    infoTotal: null,
    infoRange: null,

    // search
    searchBtn: null,
    searchWrapper: null,
    searchInput: null,
    clearSearch: null,
    searchActive: false,

    // filter
    filterBtn: null,
    filterDropdown: null,
    filterOptionsList: null,
    filterSearchInput: null,
    filterNoResult: null,
    currentFilterUid: null,

    // time range
    timeRangeBtn: null,
    timeRangeDropdown: null,
    timeRangeLabel: null,
    startDateInput: null,
    endDateInput: null,
    applyTimeRangeBtn: null,
    clearTimeRangeBtn: null,
    minDateKey: null,
    maxDateKey: null,

    // theme
    themeToggle: null,
    themeIcon: null
  };

  function log() {
    try { console.log.apply(console, ['[QCE-Chunked]'].concat([].slice.call(arguments))); } catch (e) {}
  }
  function warn() {
    try { console.warn.apply(console, ['[QCE-Chunked]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  // ---------- JSONP callbacks ----------
  window.__QCE_MANIFEST__ = function (m) {
    manifest = m;
    tryInit();
  };

  window.__QCE_CHUNK__ = function (chunk) {
    chunkCache.set(chunk.id, chunk);
    var p = pendingChunk.get(chunk.id);
    if (p) {
      p.resolve(chunk);
      pendingChunk.delete(chunk.id);
    }
  };

  window.__QCE_MSGID_INDEX__ = function (bucket, pairs) {
    try {
      if (Array.isArray(pairs)) {
        for (var i = 0; i < pairs.length; i++) {
          var pair = pairs[i];
          if (pair && pair.length >= 2) {
            msgIdToChunkId.set(pair[0], pair[1]);
          }
        }
      }
    } finally {
      loadedMsgIndexBuckets.add(bucket);
      var p = pendingMsgIndexBuckets.get(bucket);
      if (p) {
        p.resolve();
        pendingMsgIndexBuckets.delete(bucket);
      }
    }
  };

  // ---------- image modal (保持原函数名) ----------
  window.showImageModal = function (imgSrc) {
    var modal = document.getElementById('imageModal');
    var modalImg = document.getElementById('modalImage');
    if (!modal || !modalImg) return;
    modal.style.display = 'block';
    modalImg.src = imgSrc;
  };
  window.hideImageModal = function () {
    var modal = document.getElementById('imageModal');
    if (modal) modal.style.display = 'none';
  };

  // ---------- DOM ready ----------
  document.addEventListener('DOMContentLoaded', function () {
    domReady = true;
    tryInit();
  });

  function tryInit() {
    if (initialized) return;
    if (!domReady || !manifest) return;
    initialized = true;
    init();
  }

  // ---------- helpers ----------
  function debounce(fn, wait) {
    var t = null;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^$\{\}()|\[\]\\]/g, '\\$&');
  }

  function highlightIn(root, searchTerm) {
    if (!root || !searchTerm) return;
    var escaped = escapeRegExp(searchTerm);
    if (!escaped) return;
    var regex = new RegExp('(' + escaped + ')', 'gi');
    var nodes = root.querySelectorAll('.text-content');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var text = el.textContent || '';
      if (!text) continue;
      // 只对纯文本 span 做高亮：保持与原逻辑一致
      el.innerHTML = text.replace(regex, '<mark class="highlight">$1</mark>');
    }
  }

  function setLucideIcons() {
    if (typeof lucide === 'undefined') return;
    lucide.createIcons({ attrs: { 'stroke-width': 2 } });
  }

  // ---------- Bloom filter (chunk-level indexing) ----------
  function base64ToBytes(b64) {
    if (!b64) return null;
    try {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
      return bytes;
    } catch (e) {
      return null;
    }
  }

  function fnv1a32(str, seed) {
    var h = (seed >>> 0) || 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0);
  }

  function bloomMightContain(bytes, bits, hashes, token) {
    if (!bytes || !bits || !hashes) return true;
    var h1 = fnv1a32(token, 0x811c9dc5);
    var h2 = fnv1a32(token, 0x811c9dc5 ^ 0x5bd1e995);
    for (var i = 0; i < hashes; i++) {
      var idx = (h1 + (i * h2)) % bits;
      var byteIndex = idx >>> 3;
      var mask = 1 << (idx & 7);
      if ((bytes[byteIndex] & mask) === 0) return false;
    }
    return true;
  }

  function getNgramSizeForTerm(termLower) {
    if (!termLower) return 0;
    if (termLower.length >= 3) return 3;
    if (termLower.length >= 2) return 2;
    return 0;
  }

  function ngramsOf(termLower, n) {
    var out = [];
    if (!termLower || termLower.length < n) return out;
    for (var i = 0; i <= termLower.length - n; i++) {
      out.push(termLower.slice(i, i + n));
    }
    return out;
  }

  function ensureChunkBloomDecoded(meta) {
    if (!meta) return meta;
    if (meta.textBloom && !meta._textBloomBytes) meta._textBloomBytes = base64ToBytes(meta.textBloom);
    if (meta.senderBloom && !meta._senderBloomBytes) meta._senderBloomBytes = base64ToBytes(meta.senderBloom);
    return meta;
  }

  function chunkPassesFilters(meta) {
    if (!meta) return false;

    // date range (chunk-level intersection)
    if (filterState.startDate && meta.endDate && meta.endDate < filterState.startDate) return false;
    if (filterState.endDate && meta.startDate && meta.startDate > filterState.endDate) return false;

    // sender (chunk-level bloom)
    if (filterState.senderUid && meta.senderBloom) {
      ensureChunkBloomDecoded(meta);
      var bcfg = manifest && manifest.bloom ? manifest.bloom : null;
      var bits = bcfg ? bcfg.senderBits : 0;
      var hashes = bcfg ? bcfg.senderHashes : 0;
      if (!bloomMightContain(meta._senderBloomBytes, bits, hashes, filterState.senderUid)) return false;
    }

    // search (chunk-level bloom)
    if (filterState.searchLower) {
      var n = getNgramSizeForTerm(filterState.searchLower);
      if (n > 0) {
        // 如果导出时标记该 chunk bloom 不完整，为了不漏结果，这里不做排除
        if (meta.textBloomIncomplete) return true;
        if (meta.textBloom) {
          ensureChunkBloomDecoded(meta);
          var bcfg2 = manifest && manifest.bloom ? manifest.bloom : null;
          var bits2 = bcfg2 ? bcfg2.textBits : 0;
          var hashes2 = bcfg2 ? bcfg2.textHashes : 0;
          var grams = ngramsOf(filterState.searchLower, n);
          for (var i = 0; i < grams.length; i++) {
            if (!bloomMightContain(meta._textBloomBytes, bits2, hashes2, grams[i])) return false;
          }
        }
      }
    }

    return true;
  }

  function messagePassesFilters(msg) {
    if (!msg) return false;

    // message-level date range
    if (filterState.startDate && msg.date && msg.date < filterState.startDate) return false;
    if (filterState.endDate && msg.date && msg.date > filterState.endDate) return false;

    // sender
    if (filterState.senderUid && msg.uid && msg.uid !== filterState.senderUid) return false;

    // search (exact contains)
    if (filterState.searchLower) {
      var term = filterState.searchLower;
      var hit = false;
      try {
        if (msg.text && String(msg.text).indexOf(term) >= 0) hit = true;
        else if (msg.nameLower && String(msg.nameLower).indexOf(term) >= 0) hit = true;
        else if (msg.textTruncated && msg.html) {
          // 兜底：如果 text 是截断的，避免漏结果，用 html 做全文 contains
          hit = (String(msg.html).toLowerCase().indexOf(term) >= 0);
        }
      } catch (e) {
        hit = false;
      }
      if (!hit) return false;
    }

    return true;
  }

  function computeTimeRangeText() {
    try {
      if (manifest && manifest.stats && manifest.stats.timeRangeText) return String(manifest.stats.timeRangeText);
      if (manifest && manifest.stats && manifest.stats.firstTime && manifest.stats.lastTime) {
        var a = new Date(manifest.stats.firstTime);
        var b = new Date(manifest.stats.lastTime);
        if (!isNaN(a.getTime()) && !isNaN(b.getTime())) {
          return a.toLocaleDateString('zh-CN') + ' 至 ' + b.toLocaleDateString('zh-CN');
        }
      }
    } catch (e) {}
    return '--';
  }

  function updateHeaderStats(renderedVisibleCount) {
    // total scope estimation:
    var totalScope = null;
    if (!manifest || !manifest.stats) totalScope = null;
    else totalScope = manifest.stats.totalMessages;

    // sender-only exact total
    if (filterState.senderUid && manifest && Array.isArray(manifest.senders)) {
      for (var i = 0; i < manifest.senders.length; i++) {
        if (String(manifest.senders[i].uid) === String(filterState.senderUid)) {
          totalScope = manifest.senders[i].count;
          break;
        }
      }
    } else if (filterState.startDate || filterState.endDate || filterState.searchLower) {
      // fallback: sum chunk counts (upper bound / estimate)
      var s = 0;
      for (var j = 0; j < activeChunks.length; j++) {
        s += (activeChunks[j].count || 0);
      }
      totalScope = s;
    }

    if (ui.infoTotal) {
      if (totalScope != null) ui.infoTotal.textContent = String(renderedVisibleCount) + ' / ' + String(totalScope);
      else ui.infoTotal.textContent = String(renderedVisibleCount);
    }
  }

  function init() {
    ui.chatContent = document.getElementById('chatContent') || document.querySelector('.chat-content');
    if (!ui.chatContent) {
      warn('chatContent not found');
      return;
    }

    // create sentinels (always keep)
    ui.chatContent.innerHTML = '';
    ui.topSentinel = document.createElement('div');
    ui.topSentinel.id = 'qce-top-sentinel';
    ui.bottomSentinel = document.createElement('div');
    ui.bottomSentinel.id = 'qce-bottom-sentinel';
    ui.chatContent.appendChild(ui.topSentinel);
    ui.chatContent.appendChild(ui.bottomSentinel);

    ui.infoTotal = document.getElementById('info-total');
    ui.infoRange = document.getElementById('info-range');

    // modal close
    var modal = document.getElementById('imageModal');
    if (modal) modal.addEventListener('click', window.hideImageModal);
    document.addEventListener('keydown', function (e) {
      if (e && e.key === 'Escape') window.hideImageModal();
    });

    // icons
    setLucideIcons();

    // theme
    initThemeToggle();

    // time range
    initTimeRange();

    // sender filter
    initSenderFilter();

    // search
    initSearchUI();

    // header stats init
    if (ui.infoRange) ui.infoRange.textContent = computeTimeRangeText();
    if (ui.infoTotal && manifest && manifest.stats) ui.infoTotal.textContent = String(manifest.stats.totalMessages || '--');

    // build active chunk list
    rebuildActiveChunks();

    // initial load
    resetAndLoadAround(0);

    // observers
    setupObservers();
  }

  // ---------- Theme ----------
  function initThemeToggle() {
    ui.themeToggle = document.getElementById('themeToggle');
    ui.themeIcon = document.getElementById('themeIcon');
    if (!ui.themeToggle || !ui.themeIcon) return;

    var currentTheme = localStorage.getItem('theme') || 'light';

    function setTheme(theme) {
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        ui.themeIcon.setAttribute('data-lucide', 'moon');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
        ui.themeIcon.setAttribute('data-lucide', 'sun');
        localStorage.setItem('theme', 'light');
      }
      setLucideIcons();
    }

    setTheme(currentTheme);

    ui.themeToggle.addEventListener('click', function () {
      currentTheme = localStorage.getItem('theme') || 'light';
      setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  // ---------- Time Range ----------
  function initTimeRange() {
    ui.timeRangeBtn = document.getElementById('timeRangeBtn');
    ui.timeRangeDropdown = document.getElementById('timeRangeDropdown');
    ui.timeRangeLabel = document.getElementById('timeRangeLabel');
    ui.startDateInput = document.getElementById('startDate');
    ui.endDateInput = document.getElementById('endDate');
    ui.applyTimeRangeBtn = document.getElementById('applyTimeRange');
    ui.clearTimeRangeBtn = document.getElementById('clearTimeRange');

    if (manifest && manifest.stats) {
      ui.minDateKey = manifest.stats.minDateKey || null;
      ui.maxDateKey = manifest.stats.maxDateKey || null;
    }

    function clampDateValue(value) {
      if (!value) return '';
      var normalized = value.slice(0, 10);
      if (ui.minDateKey && normalized < ui.minDateKey) return ui.minDateKey;
      if (ui.maxDateKey && normalized > ui.maxDateKey) return ui.maxDateKey;
      return normalized;
    }

    function applyDateRangeLimits() {
      if (!ui.startDateInput || !ui.endDateInput) return;
      ui.startDateInput.min = ui.minDateKey || '';
      ui.endDateInput.min = ui.minDateKey || '';
      ui.startDateInput.max = ui.maxDateKey || '';
      ui.endDateInput.max = ui.maxDateKey || '';
    }

    function enforceInputRange() {
      if (ui.startDateInput) ui.startDateInput.value = clampDateValue(ui.startDateInput.value);
      if (ui.endDateInput) ui.endDateInput.value = clampDateValue(ui.endDateInput.value);
      if (ui.startDateInput && ui.endDateInput && ui.startDateInput.value && ui.endDateInput.value && ui.startDateInput.value > ui.endDateInput.value) {
        ui.endDateInput.value = ui.startDateInput.value;
      }
    }

    function updateTimeRangeLabel() {
      if (!ui.timeRangeLabel || !ui.startDateInput || !ui.endDateInput) return;
      var start = ui.startDateInput.value;
      var end = ui.endDateInput.value;
      if (start || end) ui.timeRangeLabel.textContent = (start || '开始') + ' ~ ' + (end || '结束');
      else ui.timeRangeLabel.textContent = '全部时间';
    }

    // restore from storage
    var saved = localStorage.getItem('timeRange');
    if (saved && ui.startDateInput && ui.endDateInput) {
      try {
        var r = JSON.parse(saved);
        ui.startDateInput.value = r.start || '';
        ui.endDateInput.value = r.end || '';
      } catch (e) {}
    }

    applyDateRangeLimits();
    enforceInputRange();
    updateTimeRangeLabel();

    if (ui.startDateInput) ui.startDateInput.addEventListener('change', function () { enforceInputRange(); updateTimeRangeLabel(); });
    if (ui.endDateInput) ui.endDateInput.addEventListener('change', function () { enforceInputRange(); updateTimeRangeLabel(); });

    if (ui.timeRangeBtn && ui.timeRangeDropdown) {
      ui.timeRangeBtn.addEventListener('click', function (e) {
        if (e) e.stopPropagation();
        ui.timeRangeDropdown.classList.toggle('active');
      });
    }

    if (ui.applyTimeRangeBtn) {
      ui.applyTimeRangeBtn.addEventListener('click', function () {
        enforceInputRange();
        var start = ui.startDateInput ? ui.startDateInput.value : '';
        var end = ui.endDateInput ? ui.endDateInput.value : '';
        localStorage.setItem('timeRange', JSON.stringify({ start: start, end: end }));
        updateTimeRangeLabel();
        if (ui.timeRangeDropdown) ui.timeRangeDropdown.classList.remove('active');

        // apply
        applyFiltersAndReload();
      });
    }

    if (ui.clearTimeRangeBtn) {
      ui.clearTimeRangeBtn.addEventListener('click', function () {
        if (ui.startDateInput) ui.startDateInput.value = '';
        if (ui.endDateInput) ui.endDateInput.value = '';
        localStorage.removeItem('timeRange');
        updateTimeRangeLabel();
        if (ui.timeRangeDropdown) ui.timeRangeDropdown.classList.remove('active');

        // apply
        applyFiltersAndReload();
      });
    }

    document.addEventListener('click', function (e) {
      if (!e || !ui.timeRangeDropdown) return;
      var t = e.target;
      if (t && typeof t.closest === 'function' && !t.closest('.time-range-container')) {
        ui.timeRangeDropdown.classList.remove('active');
      }
    });
  }

  // ---------- Sender Filter ----------
  function initSenderFilter() {
    ui.filterBtn = document.getElementById('filterBtn');
    ui.filterDropdown = document.getElementById('filterDropdown');
    ui.filterOptionsList = document.getElementById('filterOptionsList');
    ui.filterSearchInput = document.getElementById('filterSearchInput');
    ui.filterNoResult = document.getElementById('filterNoResult');

    if (!ui.filterOptionsList) return;

    // populate from manifest.senders
    if (manifest && Array.isArray(manifest.senders)) {
      // sort: keep stable but prefer by count desc
      var list = manifest.senders.slice().sort(function (a, b) {
        return (b.count || 0) - (a.count || 0);
      });

      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s) continue;
        var uid = String(s.uid || '');
        if (!uid) continue;

        var option = document.createElement('div');
        option.className = 'filter-option';
        option.setAttribute('data-value', uid);

        var aliases = Array.isArray(s.aliases) ? s.aliases.filter(Boolean) : [];
        var displayName = String(s.displayName || (aliases[0] || uid));

        if (aliases.length > 1) {
          option.textContent = displayName + ' (' + String(aliases.length - 1) + '个别名)';
          option.setAttribute('title', aliases.join(', '));
        } else {
          option.textContent = displayName;
        }

        option.setAttribute('data-names', (aliases.join('|') + '|' + displayName).toLowerCase());
        ui.filterOptionsList.appendChild(option);
      }
    }

    if (ui.filterSearchInput) {
      ui.filterSearchInput.addEventListener('input', function (e) {
        var keyword = (e && e.target && e.target.value ? e.target.value : '').toLowerCase().trim();
        var options = ui.filterOptionsList.querySelectorAll('.filter-option');
        var hasVisible = false;

        for (var i = 0; i < options.length; i++) {
          var opt = options[i];
          var value = opt.getAttribute('data-value');
          var names = opt.getAttribute('data-names') || (opt.textContent || '').toLowerCase();
          if (value === 'all' || names.indexOf(keyword) >= 0 || (opt.textContent || '').toLowerCase().indexOf(keyword) >= 0) {
            opt.classList.remove('hidden');
            hasVisible = true;
          } else {
            opt.classList.add('hidden');
          }
        }

        if (ui.filterNoResult) {
          if (hasVisible) ui.filterNoResult.classList.remove('visible');
          else ui.filterNoResult.classList.add('visible');
        }
      });
    }

    if (ui.filterBtn && ui.filterDropdown) {
      ui.filterBtn.addEventListener('click', function (e) {
        if (e) e.stopPropagation();
        ui.filterDropdown.classList.toggle('active');
        if (ui.filterDropdown.classList.contains('active') && ui.filterSearchInput) {
          setTimeout(function () { ui.filterSearchInput.focus(); }, 100);
        }
      });
    }

    ui.filterOptionsList.addEventListener('click', function (e) {
      var t = e ? e.target : null;
      if (!t || !t.classList || !t.classList.contains('filter-option')) return;

      // clear active
      var opts = ui.filterOptionsList.querySelectorAll('.filter-option');
      for (var i = 0; i < opts.length; i++) opts[i].classList.remove('active');
      t.classList.add('active');

      var selected = t.getAttribute('data-value');
      if (selected === 'all') {
        ui.currentFilterUid = null;
      } else {
        ui.currentFilterUid = selected;
      }

      if (ui.filterDropdown) ui.filterDropdown.classList.remove('active');

      // clear filter search UI
      if (ui.filterSearchInput) ui.filterSearchInput.value = '';
      for (var j = 0; j < opts.length; j++) opts[j].classList.remove('hidden');
      if (ui.filterNoResult) ui.filterNoResult.classList.remove('visible');

      // apply
      applyFiltersAndReload();
    });

    document.addEventListener('click', function (e) {
      if (!e || !ui.filterDropdown) return;
      var t = e.target;
      if (t && typeof t.closest === 'function' && !t.closest('.filter-container')) {
        ui.filterDropdown.classList.remove('active');
      }
    });
  }

  // ---------- Search UI ----------
  function initSearchUI() {
    ui.searchBtn = document.getElementById('searchBtn');
    ui.searchWrapper = document.getElementById('searchWrapper');
    ui.searchInput = document.getElementById('searchInput');
    ui.clearSearch = document.getElementById('clearSearch');

    if (!ui.searchBtn || !ui.searchWrapper || !ui.searchInput) return;

    function updateClearButton() {
      if (!ui.clearSearch) return;
      ui.clearSearch.style.display = ui.searchInput.value ? 'block' : 'none';
    }

    ui.searchBtn.addEventListener('click', function () {
      ui.searchActive = !ui.searchActive;
      if (ui.searchActive) {
        ui.searchWrapper.classList.add('active');
        ui.searchInput.focus();
      } else {
        ui.searchWrapper.classList.remove('active');
        ui.searchInput.value = '';
        updateClearButton();
        applyFiltersAndReload();
      }
    });

    document.addEventListener('click', function (e) {
      if (!e || !ui.searchActive) return;
      var t = e.target;
      if (t && typeof t.closest === 'function' && !t.closest('.search-container')) {
        ui.searchActive = false;
        ui.searchWrapper.classList.remove('active');
        if (!ui.searchInput.value) {
          ui.searchInput.value = '';
          updateClearButton();
          applyFiltersAndReload();
        }
      }
    });

    var onSearchInput = debounce(function () {
      updateClearButton();
      applyFiltersAndReload();
    }, 300);

    ui.searchInput.addEventListener('input', onSearchInput);

    if (ui.clearSearch) {
      ui.clearSearch.addEventListener('click', function () {
        ui.searchInput.value = '';
        updateClearButton();
        applyFiltersAndReload();
        ui.searchInput.focus();
      });
    }

    updateClearButton();
  }

  // ---------- Apply filters and reload ----------
  function applyFiltersFromUI() {
    // time range
    var start = ui.startDateInput ? ui.startDateInput.value : '';
    var end = ui.endDateInput ? ui.endDateInput.value : '';
    filterState.startDate = start || '';
    filterState.endDate = end || '';

    // sender
    filterState.senderUid = ui.currentFilterUid ? String(ui.currentFilterUid) : null;

    // search
    var term = ui.searchInput ? String(ui.searchInput.value || '').trim() : '';
    filterState.searchTerm = term;
    filterState.searchLower = term ? term.toLowerCase() : '';
  }

  function applyFiltersAndReload() {
    applyFiltersFromUI();
    rebuildActiveChunks();
    resetAndLoadAround(0);
  }

  // ---------- Active chunk rebuild ----------
  function rebuildActiveChunks() {
    activeChunks = [];
    activePosByChunkId = new Map();

    var chunks = (manifest && Array.isArray(manifest.chunks)) ? manifest.chunks : [];
    for (var i = 0; i < chunks.length; i++) {
      var meta = chunks[i];
      if (chunkPassesFilters(meta)) {
        activePosByChunkId.set(meta.id, activeChunks.length);
        activeChunks.push(meta);
      }
    }
  }

  // ---------- Chunk loader ----------
  function loadChunk(meta) {
    if (!meta || !meta.id || !meta.file) return Promise.reject(new Error('bad chunk meta'));
    if (chunkCache.has(meta.id)) return Promise.resolve(chunkCache.get(meta.id));
    if (pendingChunk.has(meta.id)) return pendingChunk.get(meta.id).promise;

    var resolveFn, rejectFn;
    var p = new Promise(function (resolve, reject) {
      resolveFn = resolve;
      rejectFn = reject;
    });
    pendingChunk.set(meta.id, { promise: p, resolve: resolveFn, reject: rejectFn });

    var s = document.createElement('script');
    s.src = meta.file;
    s.async = true;
    s.onerror = function () {
      pendingChunk.delete(meta.id);
      rejectFn(new Error('failed to load chunk script: ' + meta.file));
    };
    // onload: actual data arrives via __QCE_CHUNK__
    document.head.appendChild(s);

    // 尽量减小 DOM 负担：加载后移除 script 标签（不影响执行）
    s.onload = function () {
      try { s.parentNode && s.parentNode.removeChild(s); } catch (e) {}
    };

    return p;
  }

  // ---------- MessageId index loader ----------
  function hashToBucket(str, bucketCount) {
    var h = fnv1a32(str, 0x811c9dc5);
    return (h % bucketCount) >>> 0;
  }

  function bucketHex2(bucket) {
    var hex = bucket.toString(16);
    if (hex.length < 2) hex = '0' + hex;
    return hex;
  }

  function loadMsgIndexBucket(bucket) {
    if (!manifest || !manifest.msgidIndex) return Promise.reject(new Error('msgid index not available'));
    var bucketCount = manifest.msgidIndex.bucketCount || 0;
    var dir = manifest.msgidIndex.dir || 'data/index';
    var prefix = manifest.msgidIndex.filePrefix || 'msgid_b';
    var ext = manifest.msgidIndex.fileExt || '.js';
    if (!bucketCount) return Promise.reject(new Error('msgid index bucketCount invalid'));

    if (loadedMsgIndexBuckets.has(bucket)) return Promise.resolve();
    if (pendingMsgIndexBuckets.has(bucket)) return pendingMsgIndexBuckets.get(bucket).promise;

    var resolveFn, rejectFn;
    var p = new Promise(function (resolve, reject) {
      resolveFn = resolve;
      rejectFn = reject;
    });
    pendingMsgIndexBuckets.set(bucket, { promise: p, resolve: resolveFn, reject: rejectFn });

    var s = document.createElement('script');
    s.src = dir + '/' + prefix + bucketHex2(bucket) + ext;
    s.async = true;
    s.onerror = function () {
      pendingMsgIndexBuckets.delete(bucket);
      rejectFn(new Error('failed to load msgid index bucket: ' + s.src));
    };
    document.head.appendChild(s);

    s.onload = function () {
      try { s.parentNode && s.parentNode.removeChild(s); } catch (e) {}
    };

    return p;
  }

  // ---------- Render window ----------
  function clearRenderedDOM() {
    // keep sentinels
    if (!ui.chatContent || !ui.topSentinel || !ui.bottomSentinel) return;
    // remove everything between sentinels
    while (ui.chatContent.children.length > 2) {
      ui.chatContent.removeChild(ui.chatContent.children[1]);
    }
  }

  function resetWindowState() {
    rendered = [];
    loadedStartPos = 0;
    loadedEndPos = -1;
    isLoadingNext = false;
    isLoadingPrev = false;
  }

  function getMaxWindowChunks() {
    // 你可以在导出 manifest 里扩展设置；这里先固定 3
    return 3;
  }

  function renderChunkAtEnd(pos, chunk, meta) {
    var container = document.createElement('div');
    container.className = 'qce-chunk';
    container.setAttribute('data-chunk-id', chunk.id);
    container.setAttribute('data-chunk-pos', String(pos));

    var html = '';
    var visible = 0;
    var msgs = Array.isArray(chunk.messages) ? chunk.messages : [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (messagePassesFilters(m)) {
        visible++;
        html += m.html || '';
      }
    }

    if (visible === 0) {
      // 不插入空 chunk（避免空白占位影响滚动），但仍记录到 rendered
      return { el: null, visibleCount: 0 };
    }

    container.innerHTML = html;
    ui.chatContent.insertBefore(container, ui.bottomSentinel);

    if (filterState.searchTerm) highlightIn(container, filterState.searchTerm);

    return { el: container, visibleCount: visible };
  }

  function renderChunkAtStart(pos, chunk, meta) {
    var container = document.createElement('div');
    container.className = 'qce-chunk';
    container.setAttribute('data-chunk-id', chunk.id);
    container.setAttribute('data-chunk-pos', String(pos));

    var html = '';
    var visible = 0;
    var msgs = Array.isArray(chunk.messages) ? chunk.messages : [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (messagePassesFilters(m)) {
        visible++;
        html += m.html || '';
      }
    }

    if (visible === 0) {
      return { el: null, visibleCount: 0 };
    }

    container.innerHTML = html;
    ui.chatContent.insertBefore(container, ui.topSentinel.nextSibling);

    if (filterState.searchTerm) highlightIn(container, filterState.searchTerm);

    return { el: container, visibleCount: visible };
  }

  function sumRenderedVisibleCount() {
    var s = 0;
    for (var i = 0; i < rendered.length; i++) s += (rendered[i].visibleCount || 0);
    return s;
  }

  function trimTopIfNeeded() {
    var maxChunks = getMaxWindowChunks();
    var loadedCount = loadedEndPos - loadedStartPos + 1;
    if (loadedCount <= maxChunks) return;

    // remove first rendered entry (loadedStartPos)
    var first = rendered.shift();
    loadedStartPos++;

    if (first && first.el) {
      var h = first.el.getBoundingClientRect().height || 0;
      try { first.el.parentNode && first.el.parentNode.removeChild(first.el); } catch (e) {}
      // 删除上方内容会导致视图跳动：向上补偿
      if (h) window.scrollBy(0, -h);
    }

    // memory: allow GC
    if (first && first.chunkId) chunkCache.delete(first.chunkId);
  }

  function trimBottomIfNeeded() {
    var maxChunks = getMaxWindowChunks();
    var loadedCount = loadedEndPos - loadedStartPos + 1;
    if (loadedCount <= maxChunks) return;

    // remove last rendered entry (loadedEndPos)
    var last = rendered.pop();
    loadedEndPos--;

    if (last && last.el) {
      try { last.el.parentNode && last.el.parentNode.removeChild(last.el); } catch (e) {}
    }
    if (last && last.chunkId) chunkCache.delete(last.chunkId);
  }

  function resetAndLoadAround(pos) {
    // pos: active chunk position
    clearRenderedDOM();
    resetWindowState();

    // clear chunk cache aggressively to keep memory bounded
    chunkCache.clear();
    pendingChunk.clear();

    if (!activeChunks || activeChunks.length === 0) {
      // show hint
      var hint = document.createElement('div');
      hint.className = 'scroll-loader';
      hint.textContent = '没有匹配的消息';
      ui.chatContent.insertBefore(hint, ui.bottomSentinel);
      if (ui.infoTotal) ui.infoTotal.textContent = '0';
      return;
    }

    // clamp pos
    if (pos < 0) pos = 0;
    if (pos > activeChunks.length - 1) pos = activeChunks.length - 1;

    // compute window [start..end]
    var maxChunks = getMaxWindowChunks();
    var half = Math.floor(maxChunks / 2);
    var start = pos - half;
    if (start < 0) start = 0;
    var end = start + maxChunks - 1;
    if (end > activeChunks.length - 1) {
      end = activeChunks.length - 1;
      start = Math.max(0, end - maxChunks + 1);
    }

    loadedStartPos = start;
    loadedEndPos = start - 1;

    // scroll to top when filter changes
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { window.scrollTo(0, 0); }

    // load sequentially
    (async function () {
      for (var p = start; p <= end; p++) {
        await loadNextInternal();
      }
      updateHeaderStats(sumRenderedVisibleCount());
    })().catch(function (e) {
      warn('initial load error', e);
    });
  }

  async function loadNextInternal() {
    var nextPos = loadedEndPos + 1;
    if (nextPos < loadedStartPos) nextPos = loadedStartPos;
    if (nextPos >= activeChunks.length) return;

    var meta = activeChunks[nextPos];
    var chunk = await loadChunk(meta);
    var renderedChunk = renderChunkAtEnd(nextPos, chunk, meta);

    rendered.push({ pos: nextPos, chunkId: meta.id, el: renderedChunk.el, visibleCount: renderedChunk.visibleCount });
    loadedEndPos = nextPos;

    // trim
    trimTopIfNeeded();
  }

  async function loadPrevInternal() {
    var prevPos = loadedStartPos - 1;
    if (prevPos < 0) return;

    var meta = activeChunks[prevPos];
    var beforeHeight = 0;

    // we will render first, then scroll compensation by added height
    var chunk = await loadChunk(meta);
    var renderedChunk = renderChunkAtStart(prevPos, chunk, meta);

    // measure added height
    if (renderedChunk.el) beforeHeight = renderedChunk.el.getBoundingClientRect().height || 0;

    rendered.unshift({ pos: prevPos, chunkId: meta.id, el: renderedChunk.el, visibleCount: renderedChunk.visibleCount });
    loadedStartPos = prevPos;

    // compensate scroll because we inserted content above viewport
    if (beforeHeight) window.scrollBy(0, beforeHeight);

    // trim bottom
    trimBottomIfNeeded();
  }

  // ---------- Infinite scroll observers ----------
  function setupObservers() {
    // IntersectionObserver preferred
    if ('IntersectionObserver' in window && ui.topSentinel && ui.bottomSentinel) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (!e.isIntersecting) continue;
          if (e.target === ui.bottomSentinel) {
            if (!isLoadingNext) {
              isLoadingNext = true;
              (async function () {
                try {
                  await loadNextInternal();
                  updateHeaderStats(sumRenderedVisibleCount());
                } finally {
                  isLoadingNext = false;
                }
              })();
            }
          } else if (e.target === ui.topSentinel) {
            if (!isLoadingPrev) {
              isLoadingPrev = true;
              (async function () {
                try {
                  await loadPrevInternal();
                  updateHeaderStats(sumRenderedVisibleCount());
                } finally {
                  isLoadingPrev = false;
                }
              })();
            }
          }
        }
      }, { root: null, rootMargin: '1200px 0px 1200px 0px', threshold: 0.01 });

      io.observe(ui.bottomSentinel);
      io.observe(ui.topSentinel);
      return;
    }

    // fallback scroll listener
    window.addEventListener('scroll', debounce(function () {
      var st = window.pageYOffset || document.documentElement.scrollTop || 0;
      var docH = document.documentElement.scrollHeight || 0;
      var winH = window.innerHeight || 0;

      if (!isLoadingNext && (docH - (st + winH) < 1200)) {
        isLoadingNext = true;
        (async function () {
          try { await loadNextInternal(); updateHeaderStats(sumRenderedVisibleCount()); }
          finally { isLoadingNext = false; }
        })();
      }

      if (!isLoadingPrev && (st < 600)) {
        isLoadingPrev = true;
        (async function () {
          try { await loadPrevInternal(); updateHeaderStats(sumRenderedVisibleCount()); }
          finally { isLoadingPrev = false; }
        })();
      }
    }, 80), { passive: true });
  }

  // ---------- Reply jump: scrollToMessage (跨 chunk 定位能力：msgid index buckets) ----------
  window.scrollToMessage = function (msgId) {
    if (!msgId) return;

    // 1) if already in DOM
    var el = document.getElementById(msgId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      try {
        el.style.transition = 'background 0.3s';
        var originalBg = window.getComputedStyle(el).backgroundColor;
        el.style.background = 'rgba(0, 122, 255, 0.1)';
        setTimeout(function () {
          el.style.background = originalBg;
          setTimeout(function () { el.style.transition = ''; }, 300);
        }, 1000);
      } catch (e) {}
      return;
    }

    // 2) locate by msgid index bucket (on-demand)
    if (!manifest || !manifest.msgidIndex) {
      warn('msgid index not available');
      return;
    }

    var bucketCount = manifest.msgidIndex.bucketCount || 0;
    if (!bucketCount) {
      warn('msgid index bucketCount invalid');
      return;
    }

    var bucket = hashToBucket(String(msgId), bucketCount);

    loadMsgIndexBucket(bucket).then(function () {
      var chunkId = msgIdToChunkId.get(String(msgId));
      if (!chunkId) {
        warn('msgId not found in index:', msgId);
        return;
      }

      // chunk must be in activeChunks (filtered scope), otherwise we should not change filters automatically
      var targetPos = activePosByChunkId.get(chunkId);
      if (typeof targetPos !== 'number') {
        warn('target chunk not in current filtered scope:', chunkId);
        return;
      }

      // jump window to that pos
      resetAndLoadAround(targetPos);

      // wait a bit for DOM insertion, then scroll
      setTimeout(function () {
        var e2 = document.getElementById(msgId);
        if (e2) {
          e2.scrollIntoView({ behavior: 'smooth', block: 'center' });
          try {
            e2.style.transition = 'background 0.3s';
            var originalBg = window.getComputedStyle(e2).backgroundColor;
            e2.style.background = 'rgba(0, 122, 255, 0.1)';
            setTimeout(function () {
              e2.style.background = originalBg;
              setTimeout(function () { e2.style.transition = ''; }, 300);
            }, 1000);
          } catch (e) {}
        } else {
          warn('message still not found after jump:', msgId);
        }
      }, 400);
    }).catch(function (e) {
      warn('load msgid index bucket failed:', e);
    });
  };

  // done
  log('viewer initialized');
})();
