# Speech-to-text for the WhatsApp desk (see server.py). Needs the NVIDIA runtime (docker-compose: deploy.resources).
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir faster-whisper==1.1.1 requests
COPY server.py /app/server.py
ENV HF_HUB_DISABLE_TELEMETRY=1 PYTHONUNBUFFERED=1
EXPOSE 3478
CMD ["python3", "/app/server.py"]
