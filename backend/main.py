# main.py — WorldPulse backend
# Rate limiting: staggered start delays + per-request retry on 429

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import requests, json, time, asyncio, os, uuid, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

# ---------- Static files ----------
BASE_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(BASE_DIR, "static")
FIBO_OUTPUT_SUBDIR = "fibo"
FIBO_OUTPUT_DIR = os.path.join(STATIC_DIR, FIBO_OUTPUT_SUBDIR)
os.makedirs(FIBO_OUTPUT_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ---------- Google AI Studio config ----------
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL_ID = "gemini-2.0-flash"

def get_ai_studio_url():
    return (
        f"https://generativelanguage.googleapis.com/v1beta/models"
        f"/{MODEL_ID}:generateContent?key={GEMINI_API_KEY}"
    )

# ---------- Rate limiting config ----------
# Free tier = 15 RPM.
# Strategy: stagger each country's start by STAGGER_DELAY seconds based on its
# index in the queue. Country 0 starts immediately, country 1 waits 4s,
# country 2 waits 8s, etc. This guarantees we never exceed 15 RPM.
STAGGER_DELAY = 4.5   # seconds between each country's first request

executor = ThreadPoolExecutor(max_workers=4)

# ---------- Countries ----------
COUNTRY_MAPPING = {
    "USA": "United States of America",
    "Canada": "Canada",
    "Mexico": "Mexico",
    "Guatemala": "Guatemala",
    "Honduras": "Honduras",
    "El Salvador": "El Salvador",
    "Nicaragua": "Nicaragua",
    "Costa Rica": "Costa Rica",
    "Panama": "Panama",
    "Cuba": "Cuba",
    "Haiti": "Haiti",
    "Dominican Republic": "Dominican Republic",
    "Jamaica": "Jamaica",
    "Trinidad and Tobago": "Trinidad and Tobago",
    "Colombia": "Colombia",
    "Venezuela": "Venezuela",
    "Ecuador": "Ecuador",
    "Peru": "Peru",
    "Bolivia": "Bolivia",
    "Paraguay": "Paraguay",
    "Uruguay": "Uruguay",
    "Argentina": "Argentina",
    "Chile": "Chile",
    "Brazil": "Brazil",
    "United Kingdom": "United Kingdom",
    "Ireland": "Ireland",
    "France": "France",
    "Germany": "Germany",
    "Italy": "Italy",
    "Spain": "Spain",
    "Portugal": "Portugal",
    "Netherlands": "Netherlands",
    "Belgium": "Belgium",
    "Switzerland": "Switzerland",
    "Austria": "Austria",
    "Denmark": "Denmark",
    "Norway": "Norway",
    "Sweden": "Sweden",
    "Finland": "Finland",
    "Iceland": "Iceland",
    "Poland": "Poland",
    "Czech Republic": "Czechia",
    "Hungary": "Hungary",
    "Romania": "Romania",
    "Greece": "Greece",
    "Ukraine": "Ukraine",
    "Russia": "Russian Federation",
    "Serbia": "Serbia",
    "Turkey": "Turkey",
    "Israel": "Israel",
    "Jordan": "Jordan",
    "Lebanon": "Lebanon",
    "Saudi Arabia": "Saudi Arabia",
    "United Arab Emirates": "United Arab Emirates",
    "Qatar": "Qatar",
    "Kuwait": "Kuwait",
    "Oman": "Oman",
    "Iraq": "Iraq",
    "Syria": "Syrian Arab Republic",
    "Iran": "Iran",
    "Egypt": "Egypt",
    "Morocco": "Morocco",
    "South Africa": "South Africa",
    "Nigeria": "Nigeria",
    "Ghana": "Ghana",
    "Kenya": "Kenya",
    "Ethiopia": "Ethiopia",
    "Tanzania": "Tanzania, United Republic of",
    "Uganda": "Uganda",
    "Rwanda": "Rwanda",
    "Senegal": "Senegal",
    "Ivory Coast": "Cote d'Ivoire",
    "Cameroon": "Cameroon",
    "Angola": "Angola",
    "Zimbabwe": "Zimbabwe",
    "Zambia": "Zambia",
    "Mozambique": "Mozambique",
    "Botswana": "Botswana",
    "Namibia": "Namibia",
    "DR Congo": "Democratic Republic of the Congo",
    "India": "India",
    "Pakistan": "Pakistan",
    "Bangladesh": "Bangladesh",
    "Sri Lanka": "Sri Lanka",
    "Nepal": "Nepal",
    "China": "China",
    "Mongolia": "Mongolia",
    "Japan": "Japan",
    "South Korea": "Korea, Republic of",
    "North Korea": "Korea, Democratic People's Republic of",
    "Taiwan": "Taiwan",
    "Malaysia": "Malaysia",
    "Singapore": "Singapore",
    "Indonesia": "Indonesia",
    "Philippines": "Philippines",
    "Thailand": "Thailand",
    "Vietnam": "Viet Nam",
    "Myanmar": "Myanmar",
    "Australia": "Australia",
    "New Zealand": "New Zealand",
}

SYSTEM_INSTRUCTION = (
    "You are WorldPulse, a geopolitical and social sentiment analyzer. "
    "Analyze evidence about a country and topic. "
    "Return JSON ONLY with fields: country, topic, sentiment_score (number in [-1.0, 1.0]), "
    "summary (<= ~40 words), and exactly 3 short keywords."
)

RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "country":         {"type": "STRING"},
        "topic":           {"type": "STRING"},
        "sentiment_score": {"type": "NUMBER"},
        "summary":         {"type": "STRING"},
        "keywords":        {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": ["country", "topic", "sentiment_score", "summary", "keywords"],
    "propertyOrdering": ["country", "topic", "sentiment_score", "summary", "keywords"],
}


# ---------- Gemini API caller ----------
def call_gemini_sync(payload: dict, max_retries: int = 3) -> dict:
    """
    Synchronous Gemini call — runs in a thread via run_in_executor.
    Only retries on 429 with a fixed 65s wait (just over one RPM window).
    """
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not set.")

    url = get_ai_studio_url()
    headers = {"Content-Type": "application/json"}
    last_err = None

    for attempt in range(max_retries):
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=45)

            if resp.status_code == 429:
                # Wait one full minute to let the RPM window reset
                print(f"[429] Rate limited, waiting 65s (attempt {attempt + 1}/{max_retries})")
                time.sleep(65)
                last_err = Exception("429 rate limit")
                continue

            if not resp.ok:
                raise requests.HTTPError(f"{resp.status_code}: {resp.text[:200]}")

            data = resp.json()
            cands = data.get("candidates") or []
            if not cands or "content" not in cands[0] or "parts" not in cands[0]["content"]:
                raise KeyError("Unexpected Gemini response structure")

            text = cands[0]["content"]["parts"][0].get("text", "")
            return json.loads(text)

        except (KeyError, json.JSONDecodeError, requests.RequestException) as e:
            last_err = e
            print(f"[attempt {attempt + 1}] Error: {e}")
            if attempt < max_retries - 1:
                time.sleep(3)

    raise Exception(f"Gemini failed after {max_retries} attempts. Last: {last_err}")


def build_payload(search_name: str, topic: str) -> dict:
    user_query = (
        f"COUNTRY: {search_name}\n"
        f"TOPIC: {topic}\n"
        f"EVIDENCE: Summarize current situation from recent news/reports/social posts about "
        f"'{topic}' in '{search_name}'. Be concise and factual."
    )
    return {
        "contents": [{"role": "user", "parts": [{"text": user_query}]}],
        "systemInstruction": {"role": "system", "parts": [{"text": SYSTEM_INSTRUCTION}]},
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }


def normalize_result(data: dict, result_name: str, topic: str) -> dict:
    data["country"] = result_name
    data["topic"] = topic
    try:
        data["sentiment_score"] = float(data.get("sentiment_score", 0.0))
    except Exception:
        data["sentiment_score"] = 0.0
    if not isinstance(data.get("keywords"), list):
        data["keywords"] = []
    return data


# ---------- Per-country async task (with staggered start) ----------
async def call_country(topic: str, result_name: str, search_name: str, index: int = 0) -> dict:
    """
    index: position in the batch queue (0-based).
    Each task sleeps index * STAGGER_DELAY seconds before firing,
    so requests are naturally spread 4.5s apart — well under 15 RPM.
    """
    await asyncio.sleep(index * STAGGER_DELAY)

    payload = build_payload(search_name, topic)
    loop = asyncio.get_running_loop()
    try:
        data = await loop.run_in_executor(executor, call_gemini_sync, payload)
        return normalize_result(data, result_name, topic)
    except Exception as e:
        print(f"AI failure for {search_name}: {e}")
        return {
            "country": result_name,
            "topic": topic,
            "sentiment_score": 0.0,
            "summary": f"Could not retrieve data. ({str(e)[:80]})",
            "keywords": ["API_FAILURE", "NO_DATA", "SYSTEM_ERROR"],
        }


# ---------- FIBO (disabled on Render) ----------
FIBO_ENABLED = os.getenv("FIBO_ENABLED", "false").lower() in ("1", "true", "yes")
FIBO_REPO_DIR = os.getenv("FIBO_REPO_DIR", os.path.abspath(os.path.join(BASE_DIR, "..", "FIBO")))
FIBO_PYTHON = os.getenv("FIBO_PYTHON", sys.executable)
FIBO_SCRIPT = os.getenv("FIBO_SCRIPT", "generate.py")


def run_fibo_image(country_short: str, country_long: str, topic: Optional[str]) -> Optional[str]:
    if not FIBO_ENABLED:
        return None
    topic = (topic or "").strip()
    prompt = (
        f"A clean, cinematic illustration representing '{topic}' in {country_long}. "
        "Professional, infographic-style, no text."
        if topic else
        f"National flag of {country_long}, centered, dark background, no text."
    )
    filename = f"{country_short.lower().replace(' ', '_')}_{uuid.uuid4().hex[:8]}.png"
    output_path = os.path.join(FIBO_OUTPUT_DIR, filename)
    cmd = [FIBO_PYTHON, FIBO_SCRIPT, "--prompt", prompt, "--seed", "1",
           "--output", output_path, "--model-mode", "local"]
    try:
        proc = subprocess.run(cmd, cwd=FIBO_REPO_DIR, capture_output=True, text=True)
        if proc.returncode != 0:
            return None
    except Exception as e:
        print(f"[FIBO] failed: {e}")
        return None
    return f"/static/{FIBO_OUTPUT_SUBDIR}/{filename}" if os.path.exists(output_path) else None


# ---------- API Endpoints ----------
@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/countries")
def countries():
    return {"countries": list(COUNTRY_MAPPING.keys())}


@app.get("/sentiment_country")
async def get_sentiment_country(
    topic: str = Query(..., min_length=1),
    country: str = Query(..., min_length=2),
):
    if country not in COUNTRY_MAPPING:
        raise HTTPException(status_code=400, detail=f"Unsupported country: {country}")
    # Single country — no stagger needed
    return await call_country(topic, country, COUNTRY_MAPPING[country], index=0)


@app.get("/sentiment")
async def get_sentiment(
    topic: str = Query(..., min_length=1),
    limit: int = Query(100, ge=1, le=100),
    countries: Optional[str] = Query(None),
):
    if countries:
        req_list = [c.strip() for c in countries.split(",") if c.strip()]
        invalid = [c for c in req_list if c not in COUNTRY_MAPPING]
        if invalid:
            raise HTTPException(status_code=400, detail=f"Unsupported: {invalid}")
        target = req_list[:limit]
    else:
        target = list(COUNTRY_MAPPING.keys())[:limit]

    # Pass index so each task staggers its start time
    tasks = [
        asyncio.create_task(call_country(topic, c, COUNTRY_MAPPING[c], index=i))
        for i, c in enumerate(target)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=False)
    return {"topic": topic, "results": results}


@app.get("/fibo_image")
def get_fibo_image(
    country: str = Query(..., min_length=2),
    topic: Optional[str] = Query(""),
):
    if country not in COUNTRY_MAPPING:
        raise HTTPException(status_code=400, detail=f"Unsupported country: {country}")
    if not FIBO_ENABLED:
        return {"country": country, "topic": topic or "", "image_url": None,
                "note": "FIBO disabled on this deployment."}
    img_rel_url = run_fibo_image(country, COUNTRY_MAPPING[country], topic)
    if not img_rel_url:
        return {"country": country, "topic": topic or "", "image_url": None,
                "note": "FIBO failed to generate an image."}
    return {"country": country, "topic": topic or "", "image_url": img_rel_url, "note": "ok"}


# ---------- Frontend (must be last — catch-all route) ----------
@app.get("/")
def serve_index():
    return FileResponse(os.path.join(BASE_DIR, "index.html"))

@app.get("/app.js")
def serve_js():
    return FileResponse(os.path.join(BASE_DIR, "app.js"))

@app.get("/{full_path:path}")
def serve_fallback(full_path: str):
    file_path = os.path.join(BASE_DIR, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(BASE_DIR, "index.html"))
