from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import json

import vertexai
from vertexai.generative_models import GenerativeModel, SafetySetting, GenerationConfig

app = FastAPI()

# Initialize Vertex AI client.
# Use us-central1 because that's where Gemini is guaranteed.
vertexai.init(project="worldpulseofficial", location="us-central1")

MODEL_NAME = "gemini-2.5-flash"

@app.post("/")
async def analyze(request: Request):
    # 1. Parse request body
    try:
        body = await request.json()
        country = body["country"]
        topic = body["topic"]
        evidence = body["evidence"]
    except Exception as e:
        return JSONResponse(
            status_code=400,
            content={
                "error": "Bad request body. Must include country, topic, evidence.",
                "details": str(e),
            },
        )

    # 2. Build prompt
    prompt = f"""
You are WorldPulse, a geopolitical and social sentiment analyzer.

Your job:
Given:
- a COUNTRY name
- a TOPIC
- raw EVIDENCE text (news-style summaries, social media posts, or reports)

You will:
1. Decide the overall sentiment in that country about that topic.
   - Use a continuous numeric score from -1.00 to +1.00
   - -1.00 = severe crisis, anger, panic, instability
   - 0.00 = neutral or mixed
   - +1.00 = positive, improving, optimistic

2. Write a 2-line summary (max ~40 words total) describing the situation in that country about that topic. Be factual, concise, and neutral.

3. Extract exactly 3 short keywords (1–3 words each) that capture the most relevant focus areas.

RULES:
- Output MUST be valid JSON only.
- Do not include any explanation or text outside of JSON.
- sentiment_score MUST be a number (not a string).
- summary MUST be at most 2 sentences.

RETURN FORMAT:
{{
  "country": "{country}",
  "topic": "{topic}",
  "sentiment_score": -0.42,
  "summary": "One or two sentences describing the situation.",
  "keywords": ["keyword1","keyword2","keyword3"]
}}

EVIDENCE:
{evidence}
    """.strip()

    # 3. Call Gemini in Vertex AI with service account auth
    try:
        model = GenerativeModel(MODEL_NAME)
        response = model.generate_content(
            prompt,
            generation_config=GenerationConfig(
                temperature=1,
                top_p=0.95,
                max_output_tokens=1024,
            ),
            safety_settings=[
                SafetySetting(
                    category=SafetySetting.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold=SafetySetting.HarmBlockThreshold.BLOCK_NONE,
                ),
                SafetySetting(
                    category=SafetySetting.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold=SafetySetting.HarmBlockThreshold.BLOCK_NONE,
                ),
                SafetySetting(
                    category=SafetySetting.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold=SafetySetting.HarmBlockThreshold.BLOCK_NONE,
                ),
                SafetySetting(
                    category=SafetySetting.HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold=SafetySetting.HarmBlockThreshold.BLOCK_NONE,
                ),
            ],
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Gemini call failed (Vertex AI)",
                "details": str(e),
            },
        )

    # 4. Extract model text
    # 4. Extract model text
    raw_text = getattr(response, "text", None)
    if not raw_text:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Gemini returned no text",
                "raw_response": str(response),
            },
        )

    # 5. Clean up common formatting (e.g. ```json ... ```)
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        # remove leading ```... first line
        cleaned = cleaned.split("```", 1)[1]
        # now cleaned starts with something like "json\n{...". Remove leading "json"
        cleaned = cleaned.lstrip("json").lstrip()
        # remove trailing ``` if present
        if "```" in cleaned:
            cleaned = cleaned.split("```", 1)[0].strip()

    # 6. Parse model output as JSON
    try:
        parsed = json.loads(cleaned)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Model output was not valid JSON",
                "raw": raw_text,
                "cleaned": cleaned,
                "details": str(e),
            },
        )

    # 7. Success
    return JSONResponse(content=parsed, status_code=200)
