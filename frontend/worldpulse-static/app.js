// @ts-nocheck
// WorldPulse front-end with intro overlay + progressive painting + clear/reset + highlight

(function () {
  // ====== CONFIG ======
  const BACKEND_URL = "https://worldpulse-api-1014603752331.asia-southeast1.run.app";

  // World shapes (fallbacks)
  const WORLD_GEOJSON_SOURCES = [
    "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson",
    "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json"
  ];

  const MAX_BACKEND_RETRIES = 3;
  const HISTORY_KEY = "WP_TOPIC_HISTORY";
  const BOOKMARK_KEY = "WP_TOPIC_BOOKMARKS";
  const HISTORY_MAX = 15;
  const INTRO_SESS_KEY = "WP_INTRO_SEEN"; // sessionStorage (per tab)

  // Progressive mode knobs
  const USE_PROGRESSIVE = true;         // paint as results arrive
  const MAX_PROGRESSIVE = 100;          // ask backend for up to 100 countries
  const PROG_CONCURRENCY = 8;           // simultaneous per-country calls

  // ====== UTIL ======
  const log = (...a) => console.log("[WorldPulse]", ...a);
  const $ = (sel) => document.querySelector(sel);
  const store = {
    load(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } },
    save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
  };

  async function fetchWithRetries(url, opts = {}, retries = 2, backoffMs = 600) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, opts);
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} – ${txt || res.statusText}`);
        }
        return res;
      } catch (e) {
        lastErr = e;
        if (i < retries) {
          await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, i)));
        }
      }
    }
    throw lastErr;
  }

  function preloadImg(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res();
      img.onerror = rej;
      img.src = src;
    });
  }

  // Name aliasing (map-name -> API-short-name)
  const NAME_ALIASES = {
    "United States of America": "USA",
    "United States": "USA",
    "Russian Federation": "Russia",
    "Korea, Republic of": "South Korea",
    "Korea, Democratic People's Republic of": "North Korea",
    "Czechia": "Czech Republic",
    "Viet Nam": "Vietnam",
    "Côte d’Ivoire": "Ivory Coast",
    "Cote d'Ivoire": "Ivory Coast",
    "Syrian Arab Republic": "Syria",
    "Iran (Islamic Republic of)": "Iran",
    "Tanzania, United Republic of": "Tanzania",
    "Lao People's Democratic Republic": "Laos",
    "Bolivia (Plurinational State of)": "Bolivia",
    "Venezuela (Bolivarian Republic of)": "Venezuela",
    "Moldova, Republic of": "Moldova",
    "Brunei Darussalam": "Brunei",
    "United Kingdom": "United Kingdom",
    "Myanmar": "Myanmar"
  };
  const normName = (mapName) => (mapName ? (NAME_ALIASES[mapName] || mapName) : mapName);

  // Color thresholds
  function scoreToColor(score) {
    const s = Math.max(-1, Math.min(1, Number(score) || 0));
    if (s < -0.5) return "#FF3131";
    if (s < 0.0)  return "#FFA500";
    if (s < 0.5)  return "#FFFF00";
    return "#39FF14";
  }

  // ====== STATE ======
  let globe;
  let countryFeatures = [];
  let resultByApiKey = {};       // { shortKey: {country, topic, ...} }
  let nameToFeature = new Map();
  let busy = false;

  // highlight
  let selectedFeature = null;
  let highlightTimer = null;

  // DOM
  const elCountry = $("#countryName");
  const elScore = $("#countryScore");
  const elSummary = $("#countrySummary");
  const elKeywords = $("#countryKeywords");
  const elAnalyze = $("#analyzeBtn");
  const elTopic = $("#topicInput");
  const elBookmarkBtn = $("#bookmarkBtn");
  const elCountryInput = $("#countryInput");
  const elGoCountry = $("#goCountryBtn");
  const elCountryList = $("#countryList");
  const elHistoryList = $("#historyList");
  const elBookmarkList = $("#bookmarkList");
  const elClear = $("#clearBtn");                 // optional button (if you add one)

  // Intro DOM (optional)
  const elIntro = $("#introOverlay");
  const elEnter = $("#enterBtn");
  const elSkipIntro = $("#skipIntro");

  // ====== DATA LOADERS ======
  async function loadWorldFeatures() {
    let gj = null, lastErr = null;
    for (const url of WORLD_GEOJSON_SOURCES) {
      try {
        const resp = await fetchWithRetries(url, { cache: "no-store" }, 1, 400);
        gj = await resp.json();
        log("Loaded world GeoJSON from", url);
        break;
      } catch (e) {
        lastErr = e;
        console.warn("[WorldPulse] Failed world GeoJSON", url, e);
      }
    }
    if (!gj) throw new Error(`Couldn't fetch any world GeoJSON. Last error: ${lastErr}`);

    countryFeatures = (gj.features || []).map(f => {
      const p = f.properties || {};
      const name = p.name || p.ADMIN || p.NAME || p.NAME_LONG || p.formal_en || p.sovereignt || f.id || "Unknown";
      f.properties = { ...p, name };
      return f;
    });

    // Build name → feature lookup and datalist suggestions from the map itself
    nameToFeature.clear();
    const options = [];
    for (const f of countryFeatures) {
      const mapName = f.properties.name;
      const shortName = normName(mapName);
      nameToFeature.set(mapName.toLowerCase(), f);
      nameToFeature.set(shortName.toLowerCase(), f);
      options.push(shortName);
    }
    const uniq = [...new Set(options)].sort((a, b) => a.localeCompare(b));
    if (elCountryList) {
      elCountryList.innerHTML = uniq.map(n => `<option value="${n}"></option>`).join("");
    }
  }

  async function fetchCountriesList() {
    // pull the server’s canonical short keys (max 100)
    try {
      const res = await fetchWithRetries(`${BACKEND_URL}/countries`, { mode: "cors" }, 1, 300);
      const data = await res.json();
      const list = Array.isArray(data?.countries) ? data.countries.slice(0, MAX_PROGRESSIVE) : [];
      return list;
    } catch (e) {
      console.warn("[WorldPulse] /countries failed, will fallback to Geo names only.", e);
      return [];
    }
  }

  async function fetchSentimentBatch(topic, limit = 100) {
    const url = `${BACKEND_URL}/sentiment?topic=${encodeURIComponent(topic)}&limit=${limit}`;
    const resp = await fetchWithRetries(url, { mode: "cors" }, MAX_BACKEND_RETRIES, 700);
    return resp.json(); // {topic, results:[...]}
  }

  async function fetchSentimentCountry(topic, shortCountryKey) {
    const url = `${BACKEND_URL}/sentiment_country?topic=${encodeURIComponent(topic)}&country=${encodeURIComponent(shortCountryKey)}`;
    const resp = await fetchWithRetries(url, { mode: "cors" }, MAX_BACKEND_RETRIES, 600);
    return resp.json(); // {country, topic, sentiment_score, ...}
  }

  // ====== GLOBE ======
  function initGlobe() {
    const mount = document.getElementById("globeMount");
    const NEUTRAL = "rgba(56, 189, 248, 0.15)";
    const HIGHLIGHT_CAP = "rgba(0, 255, 255, 0.9)";
    const HIGHLIGHT_SIDE = "rgba(0, 255, 255, 0.35)";

    globe = Globe()
      .globeImageUrl("https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg")
      .bumpImageUrl("https://unpkg.com/three-globe/example/img/earth-topology.png")
      .backgroundColor("rgba(0,0,0,0)")
      .showAtmosphere(true)
      .atmosphereColor("lightskyblue")
      .atmosphereAltitude(0.18)
      .polygonsTransitionDuration(300)
      .polygonsData(countryFeatures)
      .polygonCapColor(d => {
        if (selectedFeature && d === selectedFeature) return HIGHLIGHT_CAP;
        const apiKey = normName(d.properties.name);
        const info = resultByApiKey[apiKey];
        return info ? scoreToColor(info.sentiment_score) : NEUTRAL;
      })
      .polygonSideColor(d => (selectedFeature && d === selectedFeature ? HIGHLIGHT_SIDE : "rgba(0,0,0,0.2)"))
      .polygonStrokeColor(() => "rgba(255,255,255,0.08)")
      .polygonAltitude(d => (selectedFeature && d === selectedFeature ? 0.08 : 0.01))
      .onPolygonHover(d => (mount.style.cursor = d ? "pointer" : "default"))
      .onPolygonClick(handleCountryClick)
      (mount);

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;

    // DPR clamp
    try {
      const renderer = globe.renderer && globe.renderer();
      if (renderer && renderer.setPixelRatio) {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      }
    } catch {}

    // Fit canvas to mount
    function sizeToMount() {
      const r = mount.getBoundingClientRect();
      if (r.width && r.height) {
        globe.width(r.width).height(r.height);
      }
    }
    sizeToMount();
    const ro = new ResizeObserver(sizeToMount);
    ro.observe(mount);
    window.addEventListener("resize", sizeToMount, { passive: true });
  }

  function repaintGlobe() {
    const NEUTRAL = "rgba(56, 189, 248, 0.15)";
    globe
      .polygonCapColor(d => {
        if (selectedFeature && d === selectedFeature) return "rgba(0, 255, 255, 0.9)";
        const apiKey = normName(d.properties.name);
        const info = resultByApiKey[apiKey];
        return info ? scoreToColor(info.sentiment_score) : NEUTRAL;
      })
      .polygonSideColor(d => (selectedFeature && d === selectedFeature ? "rgba(0, 255, 255, 0.35)" : "rgba(0,0,0,0.2)"))
      .polygonAltitude(d => (selectedFeature && d === selectedFeature ? 0.08 : 0.01))
      .polygonsData(countryFeatures);
  }

  // highlight helper
  function setHighlight(feature, durationMs = 2400) {
    if (!feature) return;
    selectedFeature = feature;
    repaintGlobe();
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      selectedFeature = null;
      repaintGlobe();
    }, durationMs);
  }

  // ====== COUNTRY NAV ======
  function centroidOfFeature(feature) {
    const geom = feature.geometry || {};
    let sumLat = 0, sumLng = 0, count = 0;
    const addCoords = (coords) => {
      for (const ring of coords) {
        for (const pt of ring) {
          const [lng, lat] = pt;
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            sumLat += lat; sumLng += lng; count++;
          }
        }
      }
    };
    if (geom.type === "Polygon") addCoords(geom.coordinates || []);
    else if (geom.type === "MultiPolygon") for (const poly of geom.coordinates || []) addCoords(poly);
    if (!count) return { lat: 0, lng: 0 };
    return { lat: sumLat / count, lng: sumLng / count };
  }

  function flyToCountryByName(name, altitude = 1.6) {
    if (!name) return false;
    const key = name.trim().toLowerCase();
    const feature = nameToFeature.get(key);
    if (!feature) return false;
    const { lat, lng } = centroidOfFeature(feature);
    globe.pointOfView({ lat, lng, altitude }, 1200);
    setHighlight(feature, 2600); // glow on jump
    return true;
  }

  // ====== RENDER (sidebar) ======
  function handleCountryClick(f) {
    const mapName = f?.properties?.name || "";
    const apiKey = normName(mapName);
    const info = resultByApiKey[apiKey];

    setHighlight(f, 1800);

    if (!info) {
      elCountry.textContent = mapName || "-- NO COUNTRY SELECTED --";
      elScore.textContent = "";
      elSummary.textContent = "No data for this country on the current topic.";
      elKeywords.innerHTML = "";
      return;
    }

    elCountry.textContent = mapName;
    elScore.textContent = `Score: ${Number(info.sentiment_score).toFixed(2)}`;
    elSummary.textContent = info.summary || "—";
    elKeywords.innerHTML = (info.keywords || []).map(k => `<span class="chip">${k}</span>`).join("");
  }

  // ====== HISTORY + BOOKMARKS ======
  function pushHistory(topic) {
    let hist = store.load(HISTORY_KEY, []);
    hist = [topic, ...hist.filter(t => t.toLowerCase() !== topic.toLowerCase())].slice(0, HISTORY_MAX);
    store.save(HISTORY_KEY, hist);
    renderHistory();
  }

  function toggleBookmark(topic) {
    let bms = store.load(BOOKMARK_KEY, []);
    const idx = bms.findIndex(t => t.toLowerCase() === topic.toLowerCase());
    if (idx >= 0) bms.splice(idx, 1);
    else bms.unshift(topic);
    store.save(BOOKMARK_KEY, bms);
    renderBookmarks();
  }

  function renderHistory() {
    const hist = store.load(HISTORY_KEY, []);
    if (!elHistoryList) return;
    elHistoryList.innerHTML = hist.map(t => `<span class="token" data-topic="${t}">${t}</span>`).join("");
    elHistoryList.querySelectorAll(".token").forEach(node => {
      node.addEventListener("click", () => {
        elTopic.value = node.dataset.topic;
        runAnalysis();
      });
    });
  }

  function renderBookmarks() {
    const bms = store.load(BOOKMARK_KEY, []);
    if (elBookmarkList) {
      elBookmarkList.innerHTML = bms.map(t =>
        `<span class="token" data-topic="${t}">${t}<span class="x" title="Remove">×</span></span>`
      ).join("");

      elBookmarkList.querySelectorAll(".token").forEach(node => {
        node.addEventListener("click", (e) => {
          if (e.target.classList.contains("x")) { toggleBookmark(node.dataset.topic); return; }
          elTopic.value = node.dataset.topic; runAnalysis();
        });
      });
    }

    const cur = (elTopic.value || "").trim().toLowerCase();
    const isBookmarked = bms.some(t => t.toLowerCase() === cur && cur);
    if (elBookmarkBtn) {
      elBookmarkBtn.textContent = isBookmarked ? "★" : "☆";
      elBookmarkBtn.title = isBookmarked ? "Remove bookmark" : "Bookmark topic";
    }
  }

  // ====== CLEAR / RESET ======
  function clearState() {
    // reset model state
    resultByApiKey = {};
    selectedFeature = null;
    if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }

    // reset UI
    if (elCountry) elCountry.textContent = "-- NO COUNTRY SELECTED --";
    if (elScore) elScore.textContent = "";
    if (elSummary) elSummary.textContent = "Click a country on the globe to inspect its mood on this topic.";
    if (elKeywords) elKeywords.innerHTML = "";

    repaintGlobe();
  }

  // ====== PROGRESSIVE ANALYSIS ======
  async function runAnalysisProgressive(topic) {
    // reset the globe to neutral then paint in as results land
    clearState();

    // get the server's country keys (short names) and cap
    let shortKeys = await fetchCountriesList();
    if (!shortKeys.length) {
      // best-effort fallback: derive from map names
      shortKeys = [...new Set(countryFeatures.map(f => normName(f.properties.name)))].slice(0, MAX_PROGRESSIVE);
    }

    // semaphore
    let running = 0, i = 0;
    const queue = [...shortKeys];

    return new Promise((resolve) => {
      const results = [];
      const maybeKick = () => {
        while (running < PROG_CONCURRENCY && i < queue.length) {
          const c = queue[i++]; running++;
          fetchSentimentCountry(topic, c)
            .then(data => {
              // store & repaint instantly
              if (data && data.country) {
                resultByApiKey[data.country] = data;
                repaintGlobe();

                // if the highlighted country just got data, refresh sidebar if it matches the label
                const currentName = elCountry?.textContent?.trim();
                if (currentName && normName(currentName) === data.country) {
                  elScore.textContent = `Score: ${Number(data.sentiment_score).toFixed(2)}`;
                  elSummary.textContent = data.summary || "—";
                  elKeywords.innerHTML = (data.keywords || []).map(k => `<span class="chip">${k}</span>`).join("");
                }
              }
              results.push(data);
            })
            .catch(e => {
              console.error("country failed", c, e);
            })
            .finally(() => {
              running--;
              if (results.length === shortKeys.length || (running === 0 && i >= queue.length)) {
                resolve({ topic, results });
              } else {
                maybeKick();
              }
            });
        }
      };
      maybeKick();
    });
  }

  // ====== BATCH ANALYSIS (fallback) ======
  async function runAnalysisBatch(topic) {
    const { results } = await fetchSentimentBatch(topic, MAX_PROGRESSIVE);
    resultByApiKey = {};
    (results || []).forEach(r => { if (r && r.country) resultByApiKey[r.country] = r; });
    repaintGlobe();
    return { topic, results };
  }

  // ====== ORCHESTRATION ======
  async function runAnalysis() {
    if (busy) return;
    const topic = (elTopic.value || "").trim();

    // If cleared topic, perform full reset
    if (!topic) {
      clearState();
      pushHistory("(cleared)");
      renderBookmarks();
      return;
    }

    busy = true;
    if (elAnalyze) {
      elAnalyze.disabled = true;
      elAnalyze.textContent = "Analyzing…";
    }

    if (elCountry) elCountry.textContent = "PROCESSING…";
    if (elScore) elScore.textContent = "";
    if (elSummary) elSummary.textContent = "Fetching AI sentiment per country…";
    if (elKeywords) elKeywords.innerHTML = "";

    try {
      const res = USE_PROGRESSIVE ? await runAnalysisProgressive(topic) : await runAnalysisBatch(topic);

      // Final status text
      if (elCountry) elCountry.textContent = "READY";
      if (elScore) elScore.textContent = "";
      if (elSummary) elSummary.textContent = "Click any country to see the summary and keywords.";
      if (elKeywords) elKeywords.innerHTML = "";

      pushHistory(topic);
      renderBookmarks();
      return res;
    } catch (err) {
      console.error(err);
      if (elCountry) elCountry.textContent = "SYSTEM OFFLINE";
      if (elScore) elScore.textContent = "";
      if (elSummary) elSummary.textContent = `CRITICAL ERROR: Failed to fetch AI data. (Message: ${err.message || err})`;
      if (elKeywords) elKeywords.innerHTML = "";
    } finally {
      busy = false;
      if (elAnalyze) {
        elAnalyze.disabled = false;
        elAnalyze.textContent = "Analyze";
      }
    }
  }

  // ====== INTRO FLOW ======
  async function preloadForIntro() {
    // If you removed the intro from HTML, just init
    if (!elIntro) { coreInit(); return; }

    // Skip already seen (tab)
    if (sessionStorage.getItem(INTRO_SESS_KEY) === "1") {
      elIntro.classList.add("hide");
      await coreInit();
      return;
    }

    const textures = [
      "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg",
      "https://unpkg.com/three-globe/example/img/earth-topology.png"
    ];

    try {
      await Promise.all([ loadWorldFeatures(), ...textures.map(preloadImg) ]);
      if (elEnter) {
        elEnter.removeAttribute("disabled");
        elEnter.textContent = "Enter World";
      }
    } catch (e) {
      console.error(e);
      if (elEnter) {
        elEnter.textContent = "Retry";
        elEnter.removeAttribute("disabled");
      }
    }

    if (elEnter) {
      elEnter.addEventListener("click", async () => {
        if (elSkipIntro && elSkipIntro.checked) sessionStorage.setItem(INTRO_SESS_KEY, "1");
        elIntro.classList.add("hide");
        setTimeout(coreInit, 120);
      });
    }
  }

  async function coreInit() {
    if (elCountry) elCountry.textContent = "SYSTEM ONLINE";
    if (elScore) elScore.textContent = "";
    if (elSummary) elSummary.textContent = "Click Analyze to load a topic, then click a country to inspect it.";
    if (elKeywords) elKeywords.innerHTML = "";

    if (!countryFeatures.length) {
      await loadWorldFeatures().catch(e => {
        console.error(e);
        if (elCountry) elCountry.textContent = "SYSTEM OFFLINE";
        if (elSummary) elSummary.textContent = `CRITICAL ERROR: Failed to load world map. (${e.message || e})`;
      });
    }

    initGlobe();

    // Wire UI
    if (elAnalyze) elAnalyze.addEventListener("click", runAnalysis);
    if (elTopic) {
      elTopic.addEventListener("keydown", (e) => { if (e.key === "Enter") runAnalysis(); });
      elTopic.addEventListener("input", () => renderBookmarks()); // keep ☆/★ in sync
    }
    if (elBookmarkBtn) {
      elBookmarkBtn.addEventListener("click", () => {
        const topic = (elTopic.value || "").trim();
        if (!topic) return;
        toggleBookmark(topic);
      });
    }
    if (elGoCountry) {
      elGoCountry.addEventListener("click", () => {
        const ok = flyToCountryByName(elCountryInput.value);
        if (!ok) {
          elCountryInput.style.borderColor = "#FF3131";
          setTimeout(() => (elCountryInput.style.borderColor = ""), 800);
        }
      });
    }
    if (elCountryInput) {
      elCountryInput.addEventListener("keydown", (e) => { if (e.key === "Enter") elGoCountry?.click(); });
    }

    // Optional clear button if present in HTML
    if (elClear) {
      elClear.addEventListener("click", () => {
        if (elTopic) elTopic.value = "";
        clearState();
        renderBookmarks();
      });
    }

    // Keyboard clear: Ctrl/Cmd + K
    window.addEventListener("keydown", (e) => {
      const isCmdK = (e.key.toLowerCase() === "k") && (e.metaKey || e.ctrlKey);
      if (isCmdK) {
        e.preventDefault();
        if (elTopic) elTopic.value = "";
        clearState();
        renderBookmarks();
      }
    });

    renderHistory();
    renderBookmarks();
  }

  window.addEventListener("DOMContentLoaded", preloadForIntro);
})();
