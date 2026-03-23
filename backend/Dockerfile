# Dockerfile — WorldPulse
# Serves FastAPI backend + static frontend (index.html, app.js) in one container
# Deploy on Render: Language=Docker, add GEMINI_API_KEY env var

FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all app files
COPY . .

# Create static/fibo dir (FIBO images go here at runtime)
RUN mkdir -p static/fibo

# Render uses port 10000 by default for Docker services
EXPOSE 10000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "10000"]
