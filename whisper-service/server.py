"""Speech-to-text for the WhatsApp desk's voice notes (faster-whisper on the studio PC's GPU).

POST /transcribe  body: the audio file as-is (WhatsApp's ogg/opus is fine)  ?lang=ar (default) | auto
GET  /health
Nothing leaves this PC: the model is downloaded once into /models and runs locally.
"""
import json
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from faster_whisper import WhisperModel

MODEL = os.environ.get("WHISPER_MODEL", "large-v3")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "float16")
PORT = int(os.environ.get("PORT", "3478"))
MAX_BYTES = 25 * 1024 * 1024
# words the studio's clients actually say, so the model spells them right
PROMPT = "محادثة واتساب باللهجة الأردنية مع شركة نيون للتصميم الداخلي والخارجي: تصميم، ديكور، شقة، فيلا، مطبخ، غرفة نوم، صالة، مساحة، متر، موعد، زيارة، سعر، دينار."

print(f"loading {MODEL} ({COMPUTE}) ...", flush=True)
model = WhisperModel(MODEL, device="cuda", compute_type=COMPUTE, download_root="/models")
lock = threading.Lock()  # one GPU job at a time
print("ready", flush=True)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # keep the log to one line per transcription
        pass

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            return self._send(200, {"ok": True, "model": MODEL})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/transcribe":
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BYTES:
            return self._send(400, {"error": "audio missing or too large"})
        data = self.rfile.read(n)
        lang = (parse_qs(url.query).get("lang") or ["ar"])[0]
        try:
            with tempfile.NamedTemporaryFile(suffix=".ogg") as f:
                f.write(data)
                f.flush()
                t0 = time.time()
                with lock:
                    segments, info = model.transcribe(
                        f.name,
                        language=None if lang == "auto" else lang,
                        beam_size=5,
                        vad_filter=True,
                        condition_on_previous_text=False,
                        initial_prompt=PROMPT,
                    )
                    segments = list(segments)
            text = " ".join(s.text.strip() for s in segments).strip()
            dur = sum(max(0.0, s.end - s.start) for s in segments) or 1.0
            avg = sum(s.avg_logprob * max(0.0, s.end - s.start) for s in segments) / dur if segments else -9.0
            no_speech = max((s.no_speech_prob for s in segments), default=1.0)
            took = round(time.time() - t0, 2)
            print(f"transcribed {info.duration:.1f}s audio in {took}s, logprob {avg:.2f}", flush=True)
            self._send(200, {
                "text": text,
                "language": info.language,
                "duration": round(info.duration, 1),
                "avg_logprob": round(avg, 3),
                "no_speech_prob": round(no_speech, 3),
                "seconds": took,
            })
        except Exception as e:  # a bad file must not take the service down
            print("failed:", e, flush=True)
            self._send(500, {"error": str(e)[:300]})


ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
