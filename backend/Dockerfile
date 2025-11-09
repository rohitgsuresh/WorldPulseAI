#Use official Python 3.11 slim image

FROM python:3.11-slim

WORKDIR /app

#Copy only requirements first for caching

COPY requirements.txt .

#Install dependencies

RUN pip install --no-cache-dir -r requirements.txt

#Copy the rest of the backend code

COPY . .

#Cloud Run uses $PORT

ENV PORT 8080

#Run FastAPI with Gunicorn and Uvicorn workers for production stability and concurrency.

CMD exec gunicorn main:app \
    --bind 0.0.0.0:${PORT} \
    --workers ${WEB_CONCURRENCY:-1} \
    --worker-class uvicorn.workers.UvicornWorker \
    --timeout 180 --graceful-timeout 30 --keep-alive 120 --log-level info
