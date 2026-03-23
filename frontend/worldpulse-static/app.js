// @ts-nocheck
// WorldPulse — upgraded with:
//   1. Pulsing rings on crisis countries
//   2. Arc lines between sentiment-correlated countries
//   3. Live streaming ticker
//   4. Shareable snapshot button

(function () {
  // ====== CONFIG ======
  const BACKEND_URL = "";

  const WORLD_GEOJSON_SOURCES = [
    "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson",
    "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json"
  ];

  const MAX_BACKEND_RETRIES = 3;
  const HISTORY_KEY = "WP_TOPIC_HISTORY";
  const BOOKMARK_KEY = "WP_TOPIC_BOOKMARKS";
  const HISTORY_MAX = 15;
  const INTRO_SESS_KEY = "WP_INTRO_SEEN";

  const USE_PROGRESSIVE = true;
  const MAX_PROGRESSIVE = 100;
  const PROG_CONCURRENCY = 8;

  const FIBO_ENABLED = true;
  let fiboRequestId = 0;

  // Arc config
  const ARC_COUNT = 18;           // how many correlation arcs to draw
  const ARC_MIN_DELTA = 0.05;     // min score similarity to connect

  // Pulse config
  const PULSE_CRISIS_THRESHOLD = -0.5;
  const PULSE_WARN_THRESHOLD = -0.0;

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
        if (i < retries) await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, i)));
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

  const NAME_ALIASES = {
    "United States of America": "USA", "United States": "USA",
    "Russian Federation": "Russia",
    "Korea, Republic of": "South Korea",
    "Korea, Democratic People's Republic of": "North Korea",
    "Czechia": "Czech Republic",
    "Viet Nam": "Vietnam",
    "Côte d'Ivoire": "Ivory Coast", "Cote d'Ivoire": "Ivory Coast",
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
  const normName = (n) => (n ? (NAME_ALIASES[n] || n) : n);

  function scoreToColor(score) {
    const s = Math.max(-1, Math.min(1, Number(score) || 0));
    if (s < -0.5) return "#FF3131";
    if (s < 0.0)  return "#FFA500";
    if (s < 0.5)  return "#FFFF00";
    return "#39FF14";
  }

  function scoreToColorAlpha(score, alpha) {
    const s = Math.max(-1, Math.min(1, Number(score) || 0));
    if (s < -0.5) return `rgba(255,49,49,${alpha})`;
    if (s < 0.0)  return `rgba(255,165,0,${alpha})`;
    if (s < 0.5)  return `rgba(255,255,0,${alpha})`;
    return `rgba(57,255,20,${alpha})`;
  }

  // ====== STATE ======
  let globe;
  let countryFeatures = [];
  let resultByApiKey = {};
  let nameToFeature = new Map();
  let busy = false;
  let selectedFeature = null;
  let highlightTimer = null;
  let pulseTimer = null;
  let currentTopic = "";

  // ====== DOM ======
  const elCountry   = $("#countryName");
  const elScore     = $("#countryScore");
  const elSummary   = $("#countrySummary");
  const elKeywords  = $("#countryKeywords");
  const elAnalyze   = $("#analyzeBtn");
  const elTopic     = $("#topicInput");
  const elBookmarkBtn = $("#bookmarkBtn");
  const elCountryInput = $("#countryInput");
  const elGoCountry = $("#goCountryBtn");
  const elCountryList = $("#countryList");
  const elHistoryList = $("#historyList");
  const elBookmarkList = $("#bookmarkList");
  const elClear     = $("#clearBtn");
  const elIntro     = $("#introOverlay");
  const elEnter     = $("#enterBtn");
  const elSkipIntro = $("#skipIntro");
  const elFiboPanel = $("#fiboPanel");
  const elFiboImage = $("#fiboImage");
  const elFiboStatus = $("#fiboStatus");
  const elFiboCaption = $("#fiboCaption");
  const elTicker    = $("#tickerTrack");
  const elSnapshot  = $("#snapshotBtn");
  const elSnapshotFlash = $("#snapshotFlash");

  // ====== DATA LOADERS ======
  async function loadWorldFeatures() {
    let gj = null, lastErr = null;
    for (const url of WORLD_GEOJSON_SOURCES) {
      try {
        const resp = await fetchWithRetries(url, { cache: "no-store" }, 1, 400);
        gj = await resp.json();
        break;
      } catch (e) { lastErr = e; }
    }
    if (!gj) throw new Error(`Couldn't fetch world GeoJSON. Last error: ${lastErr}`);

    countryFeatures = (gj.features || []).map(f => {
      const p = f.properties || {};
      const name = p.name || p.ADMIN || p.NAME || p.NAME_LONG || p.formal_en || p.sovereignt || f.id || "Unknown";
      f.properties = { ...p, name };
      return f;
    });

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
    try {
      const res = await fetchWithRetries(`${BACKEND_URL}/countries`, { mode: "cors" }, 1, 300);
      const data = await res.json();
      return Array.isArray(data?.countries) ? data.countries.slice(0, MAX_PROGRESSIVE) : [];
    } catch (e) {
      console.warn("[WorldPulse] /countries failed", e);
      return [];
    }
  }

  async function fetchSentimentCountry(topic, shortCountryKey) {
    const url = `${BACKEND_URL}/sentiment_country?topic=${encodeURIComponent(topic)}&country=${encodeURIComponent(shortCountryKey)}`;
    const resp = await fetchWithRetries(url, { mode: "cors" }, MAX_BACKEND_RETRIES, 600);
    return resp.json();
  }

  // ====== CENTROID ======
  function centroidOfFeature(feature) {
    const geom = feature.geometry || {};
    let sumLat = 0, sumLng = 0, count = 0;
    const addCoords = (coords) => {
      for (const ring of coords) {
        for (const pt of ring) {
          const [lng, lat] = pt;
          if (Number.isFinite(lat) && Number.isFinite(lng)) { sumLat += lat; sumLng += lng; count++; }
        }
      }
    };
    if (geom.type === "Polygon") addCoords(geom.coordinates || []);
    else if (geom.type === "MultiPolygon") for (const poly of geom.coordinates || []) addCoords(poly);
    if (!count) return { lat: 0, lng: 0 };
    return { lat: sumLat / count, lng: sumLng / count };
  }

  function getCentroidForKey(apiKey) {
    const feature = nameToFeature.get(apiKey.toLowerCase());
    if (!feature) return null;
    return centroidOfFeature(feature);
  }

  // ====== GLOBE ======
  function initGlobe() {
    const mount = document.getElementById("globeMount");
    const NEUTRAL = "rgba(56, 189, 248, 0.15)";

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
        if (selectedFeature && d === selectedFeature) return "rgba(0,255,255,0.9)";
        const apiKey = normName(d.properties.name);
        const info = resultByApiKey[apiKey];
        return info ? scoreToColor(info.sentiment_score) : NEUTRAL;
      })
      .polygonSideColor(d => (selectedFeature && d === selectedFeature ? "rgba(0,255,255,0.35)" : "rgba(0,0,0,0.2)"))
      .polygonStrokeColor(() => "rgba(255,255,255,0.08)")
      .polygonAltitude(d => (selectedFeature && d === selectedFeature ? 0.08 : 0.01))
      .onPolygonHover(d => (mount.style.cursor = d ? "pointer" : "default"))
      .onPolygonClick(handleCountryClick)
      // ---- Rings (pulse) ----
      .ringsData([])
      .ringColor(d => d.color)
      .ringMaxRadius(d => d.maxR)
      .ringPropagationSpeed(d => d.speed)
      .ringRepeatPeriod(d => d.period)
      .ringAltitude(0.005)
      // ---- Arcs ----
      .arcsData([])
      .arcColor(d => d.color)
      .arcAltitude(d => d.alt)
      .arcStroke(d => d.stroke)
      .arcDashLength(0.4)
      .arcDashGap(0.2)
      .arcDashAnimateTime(2200)
      .arcLabel(d => d.label || "")
      (mount);

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;

    try {
      const renderer = globe.renderer && globe.renderer();
      if (renderer && renderer.setPixelRatio) renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch {}

    function sizeToMount() {
      const r = mount.getBoundingClientRect();
      if (r.width && r.height) globe.width(r.width).height(r.height);
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
        if (selectedFeature && d === selectedFeature) return "rgba(0,255,255,0.9)";
        const apiKey = normName(d.properties.name);
        const info = resultByApiKey[apiKey];
        return info ? scoreToColor(info.sentiment_score) : NEUTRAL;
      })
      .polygonSideColor(d => (selectedFeature && d === selectedFeature ? "rgba(0,255,255,0.35)" : "rgba(0,0,0,0.2)"))
      .polygonAltitude(d => (selectedFeature && d === selectedFeature ? 0.08 : 0.01))
      .polygonsData(countryFeatures);
  }

  function setHighlight(feature, durationMs = 2400) {
    if (!feature) return;
    selectedFeature = feature;
    repaintGlobe();
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => { selectedFeature = null; repaintGlobe(); }, durationMs);
  }

  // ====== 1. PULSE RINGS ======
  function buildPulseRings() {
    const rings = [];
    for (const [key, info] of Object.entries(resultByApiKey)) {
      const score = Number(info.sentiment_score || 0);
      const isCrisis = score < PULSE_CRISIS_THRESHOLD;
      const isWarning = score < PULSE_WARN_THRESHOLD && score >= PULSE_CRISIS_THRESHOLD;
      if (!isCrisis && !isWarning) continue;

      const center = getCentroidForKey(key);
      if (!center) continue;

      if (isCrisis) {
        // Double ring: outer slow, inner fast
        rings.push({
          lat: center.lat, lng: center.lng,
          color: t => `rgba(255,49,49,${1 - t})`,
          maxR: 4, speed: 1.2, period: 1400,
        });
        rings.push({
          lat: center.lat, lng: center.lng,
          color: t => `rgba(255,120,120,${0.6 * (1 - t)})`,
          maxR: 2.5, speed: 2.0, period: 900,
        });
      } else {
        // Single amber ring
        rings.push({
          lat: center.lat, lng: center.lng,
          color: t => `rgba(255,165,0,${0.8 * (1 - t)})`,
          maxR: 3, speed: 0.9, period: 1800,
        });
      }
    }
    globe.ringsData(rings);
  }

  // ====== 2. ARC LINES ======
  function buildCorrelationArcs() {
    const entries = Object.entries(resultByApiKey);
    if (entries.length < 2) return;

    // Find pairs with closest sentiment scores (most correlated)
    const pairs = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [keyA, infoA] = entries[i];
        const [keyB, infoB] = entries[j];
        const scoreA = Number(infoA.sentiment_score || 0);
        const scoreB = Number(infoB.sentiment_score || 0);
        const delta = Math.abs(scoreA - scoreB);
        if (delta > ARC_MIN_DELTA) continue;
        // Only arc countries that are not both neutral (0.4–0.5)
        const avgScore = (scoreA + scoreB) / 2;
        pairs.push({ keyA, keyB, delta, avgScore });
      }
    }

    // Sort by closest match, then prefer extreme scores
    pairs.sort((a, b) => {
      const extremeA = Math.abs(a.avgScore);
      const extremeB = Math.abs(b.avgScore);
      return (a.delta - b.delta) + 0.3 * (extremeB - extremeA);
    });

    const top = pairs.slice(0, ARC_COUNT);
    const arcs = [];

    for (const { keyA, keyB, avgScore } of top) {
      const cA = getCentroidForKey(keyA);
      const cB = getCentroidForKey(keyB);
      if (!cA || !cB) continue;

      const baseColor = scoreToColor(avgScore);
      // Altitude based on geographic distance
      const dlat = cA.lat - cB.lat;
      const dlng = cA.lng - cB.lng;
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      const alt = Math.min(0.6, 0.08 + dist / 350);

      arcs.push({
        startLat: cA.lat, startLng: cA.lng,
        endLat: cB.lat, endLng: cB.lng,
        color: [
          scoreToColorAlpha(avgScore, 0.9),
          scoreToColorAlpha(avgScore, 0.1)
        ],
        alt,
        stroke: avgScore < -0.4 ? 1.2 : 0.7,
        label: `${keyA} ↔ ${keyB}`,
      });
    }

    globe.arcsData(arcs);
  }

  // ====== 3. TICKER ======
  let tickerItems = [];
  let tickerInterval = null;

  function pushTicker(item) {
    if (!elTicker) return;
    tickerItems.push(item);

    const span = document.createElement("span");
    span.className = "ticker-item";
    span.style.color = scoreToColor(item.score);

    const flag = countryToEmoji(item.country);
    const sign = item.score >= 0 ? "+" : "";
    span.innerHTML = `${flag} <strong>${item.country}</strong> <em>${sign}${Number(item.score).toFixed(2)}</em>`;
    elTicker.appendChild(span);

    // Keep ticker scrolling
    if (!tickerInterval) startTickerScroll();
  }

  function startTickerScroll() {
    const bar = $("#tickerBar");
    if (!bar) return;
    let pos = 0;
    tickerInterval = setInterval(() => {
      pos += 0.6;
      const maxScroll = elTicker.scrollWidth - bar.clientWidth;
      if (pos >= maxScroll + 200) pos = 0;
      elTicker.style.transform = `translateX(-${pos}px)`;
    }, 16);
  }

  function resetTicker() {
    tickerItems = [];
    if (tickerInterval) { clearInterval(tickerInterval); tickerInterval = null; }
    if (elTicker) {
      elTicker.innerHTML = "";
      elTicker.style.transform = "translateX(0)";
    }
  }

  // Country code → flag emoji (simple lookup for top countries)
  const EMOJI_MAP = {
    "USA":"🇺🇸","Canada":"🇨🇦","Mexico":"🇲🇽","Brazil":"🇧🇷","Argentina":"🇦🇷",
    "United Kingdom":"🇬🇧","France":"🇫🇷","Germany":"🇩🇪","Italy":"🇮🇹","Spain":"🇪🇸",
    "Russia":"🇷🇺","China":"🇨🇳","Japan":"🇯🇵","India":"🇮🇳","Australia":"🇦🇺",
    "South Korea":"🇰🇷","North Korea":"🇰🇵","Indonesia":"🇮🇩","Pakistan":"🇵🇰","Nigeria":"🇳🇬",
    "South Africa":"🇿🇦","Egypt":"🇪🇬","Saudi Arabia":"🇸🇦","Turkey":"🇹🇷","Iran":"🇮🇷",
    "Ukraine":"🇺🇦","Poland":"🇵🇱","Netherlands":"🇳🇱","Sweden":"🇸🇪","Norway":"🇳🇴",
    "Finland":"🇫🇮","Denmark":"🇩🇰","Switzerland":"🇨🇭","Belgium":"🇧🇪","Austria":"🇦🇹",
    "Greece":"🇬🇷","Romania":"🇷🇴","Israel":"🇮🇱","Iraq":"🇮🇶","Syria":"🇸🇾",
    "Kenya":"🇰🇪","Ethiopia":"🇪🇹","Ghana":"🇬🇭","Tanzania":"🇹🇿","Morocco":"🇲🇦",
    "Chile":"🇨🇱","Colombia":"🇨🇴","Peru":"🇵🇪","Venezuela":"🇻🇪","Vietnam":"🇻🇳",
    "Thailand":"🇹🇭","Malaysia":"🇲🇾","Singapore":"🇸🇬","Philippines":"🇵🇭","Bangladesh":"🇧🇩",
    "New Zealand":"🇳🇿","Portugal":"🇵🇹","Iceland":"🇮🇸","Ireland":"🇮🇪","Czech Republic":"🇨🇿",
  };
  const countryToEmoji = (name) => EMOJI_MAP[name] || "🌐";

  // ====== 4. SHAREABLE SNAPSHOT ======
  async function takeSnapshot() {
    if (!globe) return;
    const topic = currentTopic || "WorldPulse";
    const btn = elSnapshot;
    if (btn) { btn.disabled = true; btn.textContent = "Capturing…"; }

    try {
      // Get the globe's WebGL canvas
      let glCanvas = null;
      try {
        const renderer = globe.renderer();
        if (renderer) glCanvas = renderer.domElement;
      } catch {}

      if (!glCanvas) {
        // Fallback: grab the first canvas in mount
        glCanvas = document.querySelector("#globeMount canvas");
      }

      if (!glCanvas) throw new Error("No globe canvas found");

      // Force a render frame
      try { globe.renderer().render(globe.scene(), globe.camera()); } catch {}

      // Composite onto our own canvas
      const W = 1280, H = 720;
      const out = document.createElement("canvas");
      out.width = W; out.height = H;
      const ctx = out.getContext("2d");

      // Background
      const grad = ctx.createRadialGradient(W * 0.15, H * 0.15, 0, W * 0.5, H * 0.5, W * 0.8);
      grad.addColorStop(0, "#1a1a2e");
      grad.addColorStop(1, "#000000");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Globe image (center it)
      const globeSize = Math.min(W, H) * 0.85;
      const gx = (W - globeSize) / 2;
      const gy = (H - globeSize) / 2;
      try {
        ctx.drawImage(glCanvas, gx, gy, globeSize, globeSize);
      } catch (e) {
        console.warn("Globe draw failed (tainted canvas?)", e);
      }

      // Dark overlay for text areas
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, W, 90);
      ctx.fillRect(0, H - 80, W, 80);

      // Title
      ctx.font = "bold 32px 'Space Mono', monospace";
      ctx.fillStyle = "#00FFFF";
      ctx.shadowColor = "rgba(0,255,255,0.8)";
      ctx.shadowBlur = 14;
      ctx.fillText("WORLD PULSE", 32, 50);

      // Topic
      ctx.shadowBlur = 0;
      ctx.font = "16px 'Space Mono', monospace";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(`TOPIC: ${topic.toUpperCase()}`, 32, 76);

      // Timestamp
      const ts = new Date().toUTCString().replace(" GMT", " UTC");
      ctx.font = "12px 'Space Mono', monospace";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      const tsW = ctx.measureText(ts).width;
      ctx.fillText(ts, W - tsW - 24, H - 22);

      // Legend (bottom left)
      const legendItems = [
        { color: "#39FF14", label: "≥ 0.5  Stable" },
        { color: "#FFFF00", label: "0.0–0.5  Mixed" },
        { color: "#FFA500", label: "–0.5–0.0  Concern" },
        { color: "#FF3131", label: "< –0.5  Crisis" },
      ];
      ctx.font = "11px 'Space Mono', monospace";
      legendItems.forEach((item, i) => {
        const lx = 24 + i * 200;
        ctx.fillStyle = item.color;
        ctx.shadowColor = item.color;
        ctx.shadowBlur = 6;
        ctx.fillRect(lx, H - 54, 14, 14);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText(item.label, lx + 20, H - 43);
      });

      // Watermark
      ctx.font = "11px 'Space Mono', monospace";
      ctx.fillStyle = "rgba(0,255,255,0.4)";
      ctx.fillText("worldpulse.ai", W - 130, H - 50);

      // Download
      const link = document.createElement("a");
      link.download = `worldpulse-${topic.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.png`;
      link.href = out.toDataURL("image/png");
      link.click();

      // Flash effect
      if (elSnapshotFlash) {
        elSnapshotFlash.style.opacity = "1";
        setTimeout(() => { elSnapshotFlash.style.opacity = "0"; }, 300);
      }

    } catch (e) {
      console.error("Snapshot failed:", e);
      alert("Snapshot failed. Your browser may block canvas export due to cross-origin textures.");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "📸 Snapshot"; }
    }
  }

  // ====== FIBO ======
  function resetFiboPanel() {
    if (!elFiboPanel) return;
    elFiboPanel.classList.add("hidden");
    if (elFiboImage) { elFiboImage.src = ""; elFiboImage.style.display = "none"; }
    if (elFiboStatus) elFiboStatus.textContent = "";
    if (elFiboCaption) elFiboCaption.textContent = "";
  }

  async function fetchFiboImage(countryKey, topic) {
    if (!elFiboPanel || !FIBO_ENABLED) return;
    const thisReq = ++fiboRequestId;
    elFiboPanel.classList.remove("hidden");
    if (elFiboStatus) elFiboStatus.textContent = "Generating visual…";
    if (elFiboImage) elFiboImage.style.display = "none";
    if (elFiboCaption) elFiboCaption.textContent = "";
    try {
      const url = `${BACKEND_URL}/fibo_image?country=${encodeURIComponent(countryKey)}&topic=${encodeURIComponent(topic || "")}`;
      const res = await fetchWithRetries(url, { mode: "cors" }, 1, 800);
      const data = await res.json();
      if (thisReq !== fiboRequestId) return;
      if (data && data.image_url) {
        const base = BACKEND_URL.replace(/\/+$/, "");
        const fullUrl = data.image_url.startsWith("http") ? data.image_url : `${base}${data.image_url}`;
        if (elFiboImage) { elFiboImage.src = fullUrl; elFiboImage.style.display = "block"; }
        if (elFiboStatus) elFiboStatus.textContent = "";
        if (elFiboCaption) {
          const topicLabel = (data.topic || topic || "").trim();
          elFiboCaption.textContent = topicLabel ? `AI visual for "${topicLabel}" in ${data.country}.` : `National flag of ${data.country}.`;
        }
      } else if (elFiboStatus) {
        elFiboStatus.textContent = data?.note || "No visual available.";
      }
    } catch (e) {
      if (thisReq !== fiboRequestId) return;
      if (elFiboStatus) elFiboStatus.textContent = "Failed to generate visual.";
    }
  }

  // ====== RENDER SIDEBAR ======
  function handleCountryClick(f) {
    const mapName = f?.properties?.name || "";
    const apiKey = normName(mapName);
    const info = resultByApiKey[apiKey];
    setHighlight(f, 1800);
    if (!info) {
      if (elCountry) elCountry.textContent = mapName || "-- NO COUNTRY SELECTED --";
      if (elScore) elScore.textContent = "";
      if (elSummary) elSummary.textContent = "No data for this country yet.";
      if (elKeywords) elKeywords.innerHTML = "";
      resetFiboPanel();
      return;
    }
    if (elCountry) elCountry.textContent = mapName;
    if (elScore) {
      const s = Number(info.sentiment_score);
      elScore.textContent = `Score: ${s.toFixed(2)}`;
      elScore.style.color = scoreToColor(s);
    }
    if (elSummary) elSummary.textContent = info.summary || "—";
    if (elKeywords) {
      elKeywords.innerHTML = (info.keywords || []).map(k => `<span class="chip">${k}</span>`).join("");
    }
    fetchFiboImage(apiKey, (elTopic?.value || "").trim());
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
    if (idx >= 0) bms.splice(idx, 1); else bms.unshift(topic);
    store.save(BOOKMARK_KEY, bms);
    renderBookmarks();
  }

  function renderHistory() {
    const hist = store.load(HISTORY_KEY, []);
    if (!elHistoryList) return;
    elHistoryList.innerHTML = hist.map(t => `<span class="token" data-topic="${t}">${t}</span>`).join("");
    elHistoryList.querySelectorAll(".token").forEach(node => {
      node.addEventListener("click", () => { elTopic.value = node.dataset.topic; runAnalysis(); });
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
    const cur = (elTopic?.value || "").trim().toLowerCase();
    const isBookmarked = bms.some(t => t.toLowerCase() === cur && cur);
    if (elBookmarkBtn) {
      elBookmarkBtn.textContent = isBookmarked ? "★" : "☆";
      elBookmarkBtn.title = isBookmarked ? "Remove bookmark" : "Bookmark topic";
    }
  }

  // ====== CLEAR ======
  function clearState() {
    resultByApiKey = {};
    selectedFeature = null;
    currentTopic = "";
    if (highlightTimer) { clearTimeout(highlightTimer); highlightTimer = null; }
    if (elCountry) elCountry.textContent = "-- NO COUNTRY SELECTED --";
    if (elScore) elScore.textContent = "";
    if (elSummary) elSummary.textContent = "Click a country on the globe to inspect its mood on this topic.";
    if (elKeywords) elKeywords.innerHTML = "";
    resetFiboPanel();
    resetTicker();
    globe && globe.ringsData([]);
    globe && globe.arcsData([]);
    repaintGlobe();
  }

  // ====== PROGRESSIVE ANALYSIS ======
  async function runAnalysisProgressive(topic) {
    clearState();
    currentTopic = topic;

    let shortKeys = await fetchCountriesList();
    if (!shortKeys.length) {
      shortKeys = [...new Set(countryFeatures.map(f => normName(f.properties.name)))].slice(0, MAX_PROGRESSIVE);
    }

    let running = 0, i = 0;
    const queue = [...shortKeys];
    let completed = 0;

    return new Promise((resolve) => {
      const results = [];
      const maybeKick = () => {
        while (running < PROG_CONCURRENCY && i < queue.length) {
          const c = queue[i++]; running++;
          fetchSentimentCountry(topic, c)
            .then(data => {
              if (data && data.country) {
                resultByApiKey[data.country] = data;
                repaintGlobe();
                buildPulseRings();      // update rings as each result lands
                pushTicker(data);       // stream to ticker

                // update sidebar if this is the selected country
                const currentName = elCountry?.textContent?.trim();
                if (currentName && normName(currentName) === data.country) {
                  if (elScore) {
                    elScore.textContent = `Score: ${Number(data.sentiment_score).toFixed(2)}`;
                    elScore.style.color = scoreToColor(data.sentiment_score);
                  }
                  if (elSummary) elSummary.textContent = data.summary || "—";
                  if (elKeywords) elKeywords.innerHTML = (data.keywords || []).map(k => `<span class="chip">${k}</span>`).join("");
                }
              }
              results.push(data);
            })
            .catch(e => console.error("country failed", c, e))
            .finally(() => {
              running--;
              completed++;
              if (completed >= shortKeys.length || (running === 0 && i >= queue.length)) {
                // All done: build final arcs
                buildCorrelationArcs();
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

  // ====== ORCHESTRATION ======
  async function runAnalysis() {
    if (busy) return;
    const topic = (elTopic?.value || "").trim();
    if (!topic) { clearState(); renderBookmarks(); return; }

    busy = true;
    if (elAnalyze) { elAnalyze.disabled = true; elAnalyze.textContent = "Analyzing…"; }
    if (elCountry) elCountry.textContent = "PROCESSING…";
    if (elScore) elScore.textContent = "";
    if (elSummary) elSummary.textContent = "Fetching AI sentiment per country…";
    if (elKeywords) elKeywords.innerHTML = "";
    resetFiboPanel();

    try {
      await runAnalysisProgressive(topic);
      if (elCountry) elCountry.textContent = "READY";
      if (elScore) elScore.textContent = "";
      if (elSummary) elSummary.textContent = "Click any country to see the summary and keywords.";
      if (elKeywords) elKeywords.innerHTML = "";
      pushHistory(topic);
      renderBookmarks();
    } catch (err) {
      console.error(err);
      if (elCountry) elCountry.textContent = "SYSTEM OFFLINE";
      if (elSummary) elSummary.textContent = `CRITICAL ERROR: ${err.message || err}`;
    } finally {
      busy = false;
      if (elAnalyze) { elAnalyze.disabled = false; elAnalyze.textContent = "Analyze"; }
    }
  }

  // ====== COUNTRY NAV ======
  function flyToCountryByName(name, altitude = 1.6) {
    if (!name) return false;
    const key = name.trim().toLowerCase();
    const feature = nameToFeature.get(key);
    if (!feature) return false;
    const { lat, lng } = centroidOfFeature(feature);
    globe.pointOfView({ lat, lng, altitude }, 1200);
    setHighlight(feature, 2600);
    return true;
  }

  // ====== INTRO ======
  async function preloadForIntro() {
    if (!elIntro) { coreInit(); return; }
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
      await Promise.all([loadWorldFeatures(), ...textures.map(preloadImg)]);
      if (elEnter) { elEnter.removeAttribute("disabled"); elEnter.textContent = "Enter World"; }
    } catch (e) {
      console.error(e);
      if (elEnter) { elEnter.textContent = "Retry"; elEnter.removeAttribute("disabled"); }
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
    if (elSummary) elSummary.textContent = "Click Analyze to load a topic, then click a country.";
    if (elKeywords) elKeywords.innerHTML = "";
    resetFiboPanel();

    if (!countryFeatures.length) {
      await loadWorldFeatures().catch(e => {
        if (elCountry) elCountry.textContent = "SYSTEM OFFLINE";
        if (elSummary) elSummary.textContent = `CRITICAL ERROR: ${e.message || e}`;
      });
    }

    initGlobe();

    if (elAnalyze) elAnalyze.addEventListener("click", runAnalysis);
    if (elTopic) {
      elTopic.addEventListener("keydown", (e) => { if (e.key === "Enter") runAnalysis(); });
      elTopic.addEventListener("input", () => renderBookmarks());
    }
    if (elBookmarkBtn) {
      elBookmarkBtn.addEventListener("click", () => {
        const topic = (elTopic?.value || "").trim();
        if (topic) toggleBookmark(topic);
      });
    }
    if (elGoCountry) {
      elGoCountry.addEventListener("click", () => {
        const ok = flyToCountryByName(elCountryInput?.value);
        if (!ok && elCountryInput) {
          elCountryInput.style.borderColor = "#FF3131";
          setTimeout(() => (elCountryInput.style.borderColor = ""), 800);
        }
      });
    }
    if (elCountryInput) {
      elCountryInput.addEventListener("keydown", (e) => { if (e.key === "Enter") elGoCountry?.click(); });
    }
    if (elClear) {
      elClear.addEventListener("click", () => {
        if (elTopic) elTopic.value = "";
        clearState();
        renderBookmarks();
      });
    }
    if (elSnapshot) {
      elSnapshot.addEventListener("click", takeSnapshot);
    }

    window.addEventListener("keydown", (e) => {
      if ((e.key.toLowerCase() === "k") && (e.metaKey || e.ctrlKey)) {
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
