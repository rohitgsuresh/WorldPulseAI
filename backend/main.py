# main.py
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import requests, json, time, asyncio, os, uuid, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

app = FastAPI()

# ---- CORS (open for demo; tighten for prod) ----
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

# ---------- Static files (for FIBO images) ----------
BASE_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(BASE_DIR, "static")
FIBO_OUTPUT_SUBDIR = "fibo"
FIBO_OUTPUT_DIR = os.path.join(STATIC_DIR, FIBO_OUTPUT_SUBDIR)
os.makedirs(FIBO_OUTPUT_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ---------- Vertex AI (Gemini) config ----------
PROJECT_ID = "worldpulseofficial"
LOCATION = "us-central1"  # Gemini models live here even if your service runs in Asia

MODEL_CANDIDATES = [
    "gemini-2.5-flash",
    "gemini-1.5-flash-001",
    "gemini-1.5-flash",
]

def make_model_url(model_id: str) -> str:
    return (
        f"https://{LOCATION}-aiplatform.googleapis.com/v1/"
        f"projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{model_id}:generateContent"
    )

# ---------- 100 Countries ----------
# Keys are SHORT names your frontend expects (normName output).
# Values are the corresponding long names commonly found in GeoJSON datasets.
COUNTRY_MAPPING = {
    # Americas (24)
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

    # Europe (24)
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

    # Middle East & North Africa (14)
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

    # Sub-Saharan Africa (18)
    "South Africa": "South Africa",
    "Nigeria": "Nigeria",
    "Ghana": "Ghana",
    "Kenya": "Kenya",
    "Ethiopia": "Ethiopia",
    "Tanzania": "Tanzania, United Republic of",
    "Uganda": "Uganda",
    "Rwanda": "Rwanda",
    "Senegal": "Senegal",
    "Ivory Coast": "Côte d’Ivoire",
    "Cameroon": "Cameroon",
    "Angola": "Angola",
    "Zimbabwe": "Zimbabwe",
    "Zambia": "Zambia",
    "Mozambique": "Mozambique",
    "Botswana": "Botswana",
    "Namibia": "Namibia",
    "DR Congo": "Democratic Republic of the Congo",

    # Asia (18)
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

    # Oceania (2)
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
        "country": {"type": "STRING"},
        "topic": {"type": "STRING"},
        "sentiment_score": {"type": "NUMBER"},
        "summary": {"type": "STRING"},
        "keywords": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": ["country", "topic", "sentiment_score", "summary", "keywords"],
    "propertyOrdering": ["country", "topic", "sentiment_score", "summary", "keywords"],
}

# Thread pool for offloading blocking HTTP calls
executor = ThreadPoolExecutor(max_workers=10)

# ---------- Auth ----------
def get_auth_token() -> str:
    """Fetch Cloud Run default service account token from metadata server."""
    token_url = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
    headers = {"Metadata-Flavor": "Google"}
    resp = requests.get(token_url, headers=headers, timeout=5)
    resp.raise_for_status()
    return resp.json()["access_token"]

# ---------- Gemini caller with model fallback ----------
def call_gemini_api(payload: dict, max_retries: int = 2) -> dict:
    """
    Try each model candidate with limited retries; return parsed JSON dict.
    Raises if all candidates fail.
    """
    token = get_auth_token()
    last_err = None

    for model_id in MODEL_CANDIDATES:
        url = make_model_url(model_id)
        print(f"DEBUG: Trying model '{model_id}' at {url}")

        for attempt in range(max_retries):
            try:
                headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {token}",
                }
                resp = requests.post(url, headers=headers, json=payload, timeout=45)
                if not resp.ok:
                    try:
                        body = resp.json()
                    except Exception:
                        body = resp.text
                    raise requests.HTTPError(f"{resp.status_code} {resp.reason}. Body: {body}")

                data = resp.json()
                cands = data.get("candidates") or []
                if not cands or "content" not in cands[0] or "parts" not in cands[0]["content"]:
                    raise KeyError("Missing candidates/content/parts in response")

                text = cands[0]["content"]["parts"][0].get("text", "")
                return json.loads(text)

            except (requests.RequestException, KeyError, json.JSONDecodeError) as e:
                last_err = e
                print(f"Request/parse failed for model '{model_id}' attempt {attempt+1}: {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                else:
                    print(f"Giving up on model '{model_id}' after {max_retries} attempts.")

    raise Exception(
        f"Failed calling Gemini in {LOCATION} with candidates {MODEL_CANDIDATES}. Last error: {last_err}"
    )

# ---------- Per-country task (async wrapper) ----------
async def call_country(topic: str, result_name: str, search_name: str) -> dict:
    """
    Build the prompt & payload for one country, call Gemini in a thread,
    shape/normalize the result for the frontend.
    """
    user_query = (
        f"COUNTRY: {search_name}\n"
        f"TOPIC: {topic}\n"
        f"EVIDENCE: Summarize current situation from recent news/reports/social posts about "
        f"'{topic}' in '{search_name}'. Be concise and factual."
    )

    payload = {
        "contents": [{"role": "user", "parts": [{"text": user_query}]}],
        "system_instruction": {"role": "system", "parts": [{"text": SYSTEM_INSTRUCTION}]},
        "generation_config": {
            "response_mime_type": "application/json",
            "response_schema": RESPONSE_SCHEMA,
        },
        # "tools": [{"google_search": {}}],  # enable later if desired
    }

    loop = asyncio.get_running_loop()
    try:
        data = await loop.run_in_executor(executor, call_gemini_api, payload)
        # Normalize for frontend keys
        data["country"] = result_name
        data["topic"] = topic
        # Guard types
        try:
            data["sentiment_score"] = float(data.get("sentiment_score", 0.0))
        except Exception:
            data["sentiment_score"] = 0.0
        if not isinstance(data.get("keywords"), list):
            data["keywords"] = []
        return data

    except Exception as e:
        print(f"AI failure for {search_name}: {e}")
        return {
            "country": result_name,
            "topic": topic,
            "sentiment_score": 0.0,
            "summary": f"System error: Could not process AI request. (Details: {str(e)})",
            "keywords": ["API_FAILURE", "NO_DATA", "SYSTEM_ERROR"],
        }

# ---------- FIBO (Bria) integration ----------
# Toggle with env var if needed
FIBO_ENABLED = os.getenv("FIBO_ENABLED", "true").lower() in ("1", "true", "yes")

# Where your FIBO repo lives relative to this file (adjust if needed)
FIBO_REPO_DIR = os.getenv(
    "FIBO_REPO_DIR",
    os.path.abspath(os.path.join(BASE_DIR, "..", "FIBO")),
)

# Python + script names (can override via env)
FIBO_PYTHON = os.getenv("FIBO_PYTHON", sys.executable)
FIBO_SCRIPT = os.getenv("FIBO_SCRIPT", "generate.py")


def run_fibo_image(country_short: str, country_long: str, topic: Optional[str]) -> Optional[str]:
    """
    Call the local FIBO generate.py script to render an image.
    Returns relative URL path like /static/fibo/<file>.png on success, or None on failure.
    """
    if not FIBO_ENABLED:
        print("FIBO is disabled via FIBO_ENABLED env")
        return None

    topic = (topic or "").strip()
    if topic:
        prompt = (
            f"A clean, cinematic illustration representing '{topic}' in {country_long}. "
            f"Professional, infographic-style, no text, global data-visualization aesthetic."
        )
    else:
        prompt = (
            f"A high-quality illustration of the national flag of {country_long}, "
            f"centered on a dark background, no text, crisp and modern."
        )

    filename = f"{country_short.lower().replace(' ', '_')}_{uuid.uuid4().hex[:8]}.png"
    output_path = os.path.join(FIBO_OUTPUT_DIR, filename)

    cmd = [
        FIBO_PYTHON,
        FIBO_SCRIPT,
        "--prompt", prompt,
        "--seed", "1",
        "--output", output_path,
        "--model-mode", "local",   # force local VLM so we don't depend on GOOGLE_API_KEY
    ]

    print(f"[FIBO] cwd={FIBO_REPO_DIR}")
    print(f"[FIBO] cmd={' '.join(cmd)}")

    try:
        proc = subprocess.run(
            cmd,
            cwd=FIBO_REPO_DIR,
            capture_output=True,
            text=True,
        )
        print("[FIBO] returncode:", proc.returncode)
        if proc.stdout:
            print("[FIBO] stdout:", proc.stdout)
        if proc.stderr:
            print("[FIBO] stderr:", proc.stderr)

        if proc.returncode != 0:
            return None

    except Exception as e:
        print(f"[FIBO] generation failed for {country_short}: {e}")
        return None

    # ensure file actually exists
    if not os.path.exists(output_path):
        print(f"[FIBO] expected output not found at {output_path}")
        return None

    return f"/static/{FIBO_OUTPUT_SUBDIR}/{filename}"

# ---------- Endpoints ----------
@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.get("/countries")
def countries():
    """Return the list of short country keys (for the UI datalist)."""
    return {"countries": list(COUNTRY_MAPPING.keys())}

@app.get("/sentiment_country")
def get_sentiment_country(
    topic: str = Query(..., min_length=1),
    country: str = Query(..., min_length=2)
):
    """
    Returns sentiment for ONE country immediately.
    country must match a key in COUNTRY_MAPPING.
    """
    if country not in COUNTRY_MAPPING:
        raise HTTPException(status_code=400, detail=f"Unsupported country: {country}")

    search_name = COUNTRY_MAPPING[country]

    user_query = (
        f"COUNTRY: {search_name}\n"
        f"TOPIC: {topic}\n"
        f"EVIDENCE: Summarize current situation from recent news/reports/social posts about '{topic}' in '{search_name}'. "
        f"Be concise and factual."
    )

    payload = {
        "contents": [{"role": "user", "parts": [{"text": user_query}]}],
        "system_instruction": {"role": "system", "parts": [{"text": SYSTEM_INSTRUCTION}]},
        "generation_config": {"response_mime_type": "application/json", "response_schema": RESPONSE_SCHEMA},
    }

    try:
        data = call_gemini_api(payload)
        data["country"] = country   # normalized key for frontend
        data["topic"] = topic
        # type guards
        try:
            data["sentiment_score"] = float(data.get("sentiment_score", 0.0))
        except Exception:
            data["sentiment_score"] = 0.0
        if not isinstance(data.get("keywords"), list):
            data["keywords"] = []
        return data
    except Exception as e:
        return {
            "country": country,
            "topic": topic,
            "sentiment_score": 0.0,
            "summary": f"System error: {str(e)}",
            "keywords": ["API_FAILURE", "NO_DATA", "SYSTEM_ERROR"]
        }

@app.get("/sentiment")
async def get_sentiment(
    topic: str = Query(..., min_length=1),
    limit: int = Query(100, ge=1, le=100),
    countries: Optional[str] = Query(
        None,
        description="Optional CSV of country keys (must match COUNTRY_MAPPING keys) — applied before limit."
    )
):
    """
    Returns sentiment for many countries concurrently (frontend can paint incrementally as results land).
    - limit: max number of countries (default 100)
    - countries: CSV to override the set (must match COUNTRY_MAPPING keys), applied before limit.
    """
    if countries:
        req_list: List[str] = [c.strip() for c in countries.split(",") if c.strip()]
        invalid = [c for c in req_list if c not in COUNTRY_MAPPING]
        if invalid:
            raise HTTPException(status_code=400, detail=f"Unsupported country keys: {invalid}")
        target = req_list[:limit]
    else:
        target = list(COUNTRY_MAPPING.keys())[:limit]

    # Friendly concurrency for Vertex
    SEM = asyncio.Semaphore(8)

    async def _job(c_short: str):
        c_long = COUNTRY_MAPPING[c_short]
        async with SEM:
            return await call_country(topic, c_short, c_long)

    tasks = [asyncio.create_task(_job(c)) for c in target]
    results = await asyncio.gather(*tasks, return_exceptions=False)

    return {"topic": topic, "results": results}

@app.get("/fibo_image")
def get_fibo_image(
    country: str = Query(..., min_length=2),
    topic: Optional[str] = Query("", description="Optional topic to steer the visual")
):
    """
    Generate (or attempt to generate) a FIBO image for the given country + topic.

    Returns:
    - country: short key (e.g. "USA")
    - topic: topic string (may be empty)
    - image_url: relative URL to the generated image, if successful
    - note: textual status
    """
    if country not in COUNTRY_MAPPING:
        raise HTTPException(status_code=400, detail=f"Unsupported country: {country}")

    if not FIBO_ENABLED:
        return {
            "country": country,
            "topic": topic or "",
            "image_url": None,
            "note": "FIBO image generation is disabled on this deployment.",
        }

    country_long = COUNTRY_MAPPING[country]
    img_rel_url = run_fibo_image(country, country_long, topic)

    if not img_rel_url:
        return {
            "country": country,
            "topic": topic or "",
            "image_url": None,
            "note": "FIBO failed to generate an image.",
        }

    return {
        "country": country,
        "topic": topic or "",
        "image_url": img_rel_url,
        "note": "ok",
    }
