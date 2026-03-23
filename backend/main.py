# main.py — WorldPulse backend
# Migrated from Vertex AI (GCP) → Google AI Studio (free tier, no billing needed)
# Deploy on Render.com free tier (push repo to GitHub, connect in Render dashboard)

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import requests, json, time, asyncio, os, uuid, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

app = FastAPI()

# ---- CORS ----
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

# ---------- Google AI Studio config ----------
# Get your free API key at: https://aistudio.google.com/app/apikey
# Set it as an environment variable: GEMINI_API_KEY=your_key_here
# On Render: Dashboard → your service → Environment → Add environment variable
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# Model preference order — AI Studio free tier supports all of these
# gemini-2.0-flash is the sweet spot: fast, capable, generous free limits
MODEL_CANDIDATES = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash-002",
]

AI_STUDIO_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

def make_model_url(model_id: str) -> str:
    """AI Studio endpoint — auth is a query param, not a Bearer token."""
    return f"{AI_STUDIO_BASE}/{model_id}:generateContent?key={GEMINI_API_KEY}"

# ---------- 100 Countries ----------
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
    "Ivory Coast": "Côte d'Ivoire",
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

# AI Studio uses the same response schema format as Vertex AI
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

executor = ThreadPoolExecutor(max_workers=10)


# ---------- Gemini caller — AI Studio version ----------
def call_gemini_api(payload: dict, max_retries: int = 2) -> dict:
    """
    Call Google AI Studio Gemini API with model fallback.
    No GCP auth needed — just the API key in the URL.
    Free tier: 15 RPM, 1500 RPD on gemini-2.0-flash.
    """
    if not GEMINI_API_KEY:
        raise ValueError(
            "GEMINI_API_KEY environment variable is not set. "
            "Get a free key at https://aistudio.google.com/app/apikey"
        )

    last_err = None

    for model_id in MODEL_CANDIDATES:
        url = make_model_url(model_id)
        print(f"DEBUG: Trying model '{model_id}'")

        for attempt in range(max_retries):
            try:
                headers = {"Content-Type": "application/json"}
                resp = requests.post(url, headers=headers, json=payload, timeout=45)

                if not resp.ok:
                    try:
                        body = resp.json()
                    except Exception:
                        body = resp.text
                    # 429 = rate limit — back off and try next model
                    if resp.status_code == 429:
                        print(f"Rate limited on '{model_id}', backing off...")
                        time.sleep(3)
                        raise requests.HTTPError(f"429 rate limit on {model_id}")
                    raise requests.HTTPError(f"{resp.status_code} {resp.reason}. Body: {body}")

                data = resp.json()
                cands = data.get("candidates") or []
                if not cands or "content" not in cands[0] or "parts" not in cands[0]["content"]:
                    raise KeyError("Missing candidates/content/parts in response")

                text = cands[0]["content"]["parts"][0].get("text", "")
                return json.loads(text)

            except (requests.RequestException, KeyError, json.JSONDecodeError) as e:
                last_err = e
                print(f"Request/parse failed for '{model_id}' attempt {attempt + 1}: {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
                else:
                    print(f"Giving up on model '{model_id}' after {max_retries} attempts.")

    raise Exception(
        f"All model candidates failed. Last error: {last_err}"
    )


def build_payload(search_name: str, topic: str) -> dict:
    """Build the Gemini request payload for a given country + topic."""
    user_query = (
        f"COUNTRY: {search_name}\n"
        f"TOPIC: {topic}\n"
        f"EVIDENCE: Summarize current situation from recent news/reports/social posts about "
        f"'{topic}' in '{search_name}'. Be concise and factual."
    )
    return {
        "contents": [{"role": "user", "parts": [{"text": user_query}]}],
        "systemInstruction": {"role": "system", "parts": [{"text": SYSTEM_INSTRUCTION}]},
        # NOTE: AI Studio uses "systemInstruction" (camelCase), not "system_instruction"
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }


def normalize_result(data: dict, result_name: str, topic: str) -> dict:
    """Enforce correct types and keys on the AI response."""
    data["country"] = result_name
    data["topic"] = topic
    try:
        data["sentiment_score"] = float(data.get("sentiment_score", 0.0))
    except Exception:
        data["sentiment_score"] = 0.0
    if not isinstance(data.get("keywords"), list):
        data["keywords"] = []
    return data


# ---------- Per-country async task ----------
async def call_country(topic: str, result_name: str, search_name: str) -> dict:
    payload = build_payload(search_name, topic)
    loop = asyncio.get_running_loop()
    try:
        data = await loop.run_in_executor(executor, call_gemini_api, payload)
        return normalize_result(data, result_name, topic)
    except Exception as e:
        print(f"AI failure for {search_name}: {e}")
        return {
            "country": result_name,
            "topic": topic,
            "sentiment_score": 0.0,
            "summary": f"System error: Could not process AI request. (Details: {str(e)})",
            "keywords": ["API_FAILURE", "NO_DATA", "SYSTEM_ERROR"],
        }


# ---------- FIBO (unchanged — disabled on Render since no local model) ----------
FIBO_ENABLED = os.getenv("FIBO_ENABLED", "false").lower() in ("1", "true", "yes")
# FIBO requires a local model repo which isn't available on Render.
# Set FIBO_ENABLED=false in your Render environment variables (already the default here).

FIBO_REPO_DIR = os.getenv("FIBO_REPO_DIR", os.path.abspath(os.path.join(BASE_DIR, "..", "FIBO")))
FIBO_PYTHON = os.getenv("FIBO_PYTHON", sys.executable)
FIBO_SCRIPT = os.getenv("FIBO_SCRIPT", "generate.py")


def run_fibo_image(country_short: str, country_long: str, topic: Optional[str]) -> Optional[str]:
    if not FIBO_ENABLED:
        print("FIBO is disabled")
        return None

    topic = (topic or "").strip()
    prompt = (
        f"A clean, cinematic illustration representing '{topic}' in {country_long}. "
        f"Professional, infographic-style, no text, global data-visualization aesthetic."
        if topic else
        f"A high-quality illustration of the national flag of {country_long}, "
        f"centered on a dark background, no text, crisp and modern."
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
        print(f"[FIBO] generation failed for {country_short}: {e}")
        return None

    return f"/static/{FIBO_OUTPUT_SUBDIR}/{filename}" if os.path.exists(output_path) else None


# ---------- Endpoints ----------
@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/countries")
def countries():
    return {"countries": list(COUNTRY_MAPPING.keys())}


@app.get("/sentiment_country")
def get_sentiment_country(
    topic: str = Query(..., min_length=1),
    country: str = Query(..., min_length=2),
):
    if country not in COUNTRY_MAPPING:
        raise HTTPException(status_code=400, detail=f"Unsupported country: {country}")

    payload = build_payload(COUNTRY_MAPPING[country], topic)
    try:
        data = call_gemini_api(payload)
        return normalize_result(data, country, topic)
    except Exception as e:
        return {
            "country": country,
            "topic": topic,
            "sentiment_score": 0.0,
            "summary": f"System error: {str(e)}",
            "keywords": ["API_FAILURE", "NO_DATA", "SYSTEM_ERROR"],
        }


@app.get("/sentiment")
async def get_sentiment(
    topic: str = Query(..., min_length=1),
    limit: int = Query(100, ge=1, le=100),
    countries: Optional[str] = Query(None),
):
    if countries:
        req_list: List[str] = [c.strip() for c in countries.split(",") if c.strip()]
        invalid = [c for c in req_list if c not in COUNTRY_MAPPING]
        if invalid:
            raise HTTPException(status_code=400, detail=f"Unsupported country keys: {invalid}")
        target = req_list[:limit]
    else:
        target = list(COUNTRY_MAPPING.keys())[:limit]

    # AI Studio free tier: 15 RPM — keep concurrency conservative
    SEM = asyncio.Semaphore(8)

    async def _job(c_short: str):
        async with SEM:
            return await call_country(topic, c_short, COUNTRY_MAPPING[c_short])

    tasks = [asyncio.create_task(_job(c)) for c in target]
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
                "note": "FIBO image generation is disabled on this deployment."}

    img_rel_url = run_fibo_image(country, COUNTRY_MAPPING[country], topic)
    if not img_rel_url:
        return {"country": country, "topic": topic or "", "image_url": None,
                "note": "FIBO failed to generate an image."}

    return {"country": country, "topic": topic or "", "image_url": img_rel_url, "note": "ok"}


# ---------- Frontend serving ----------
# Must be defined AFTER all API routes so the catch-all doesn't swallow them.

@app.get("/")
def serve_index():
    return FileResponse(os.path.join(BASE_DIR, "index.html"))

@app.get("/app.js")
def serve_js():
    return FileResponse(os.path.join(BASE_DIR, "app.js"))

@app.get("/{full_path:path}")
def serve_fallback(full_path: str):
    """Serve any other static file that exists, otherwise return index.html."""
    file_path = os.path.join(BASE_DIR, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(BASE_DIR, "index.html"))
