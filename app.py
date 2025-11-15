# app.py
"""
Translation Management Tool (TMT) - Backend
Features:
- Flask REST API + server-rendered index
- MongoDB (Atlas or local) for persistence
- HuggingFace Inference API (NLLB model) for fast, high-quality translations
- Languages management (add language, auto-fill existing keys)
- Add/Search/Edit/Delete translations
- Regenerate translations
- Export translations JSON
- Small in-memory cache for repeated translations
- SSE endpoint (basic) for live notifications
"""

import os
import json
import time
import threading
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Dict

from flask import Flask, render_template, request, jsonify, Response, send_file
from flask_cors import CORS
from pymongo import MongoClient, ASCENDING, DESCENDING
from bson import ObjectId
from dotenv import load_dotenv
import requests
import tempfile

# ---------------------------
# Load env and config
# ---------------------------
load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    raise RuntimeError("MONGO_URI is required in .env")

DB_NAME = os.getenv("MONGO_DB", "translation")
HF_API_KEY = os.getenv("HUGGINGFACE_API_KEY")  # required
HF_MODEL_ID = os.getenv("HF_MODEL_ID", "facebook/nllb-200-distilled-600M")
HF_API_URL = f"https://api-inference.huggingface.co/models/{HF_MODEL_ID}"

# Basic app settings
PORT = int(os.getenv("PORT", "5000"))
DEBUG = os.getenv("FLASK_DEBUG", "False").lower() in ("1", "true", "yes")

# ---------------------------
# Flask + DB init
# ---------------------------
app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

client = MongoClient(MONGO_URI)
db = client[DB_NAME]
translations_col = db["translations"]
languages_col = db["languages"]

# SSE (in-memory events)
SSE_EVENTS = []
SSE_LOCK = threading.Lock()
def push_event(e: Dict):
    with SSE_LOCK:
        SSE_EVENTS.append({"ts": time.time(), **e})
        if len(SSE_EVENTS) > 300:
            SSE_EVENTS.pop(0)

# ---------------------------
# NLLB code mapping
# ---------------------------
# Minimal mapping for common languages. Expand as needed.
NLLB_CODES = {
    "en": "eng_Latn",
    "es": "spa_Latn",
    "fr": "fra_Latn",
    "de": "deu_Latn",
    "hi": "hin_Deva",
    "ta": "tam_Taml",
    "te": "tel_Telu",
    "zh": "zho_Hans",
    "ar": "arb_Arab",
    "it": "ita_Latn",
    "pt": "por_Latn",
    "bn": "ben_Beng",
    "mr": "mar_Deva",
    "pa": "pan_Guru",
    "gu": "guj_Gujr",
    "kn": "kan_Knda",
    "ml": "mal_Taml",
    "ur": "urd_Arab"
}

# ---------------------------
# Simple in-memory cache
# ---------------------------
# A tiny TTL cache to avoid repeated HF calls when same text-language pair occurs.
class TTLCache:
    def __init__(self, ttl_seconds=3600):
        self.ttl = ttl_seconds
        self._data = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            entry = self._data.get(key)
            if not entry:
                return None
            val, ts = entry
            if time.time() - ts > self.ttl:
                del self._data[key]
                return None
            return val

    def set(self, key, value):
        with self._lock:
            self._data[key] = (value, time.time())

cache = TTLCache(ttl_seconds=60*60)  # 1 hour cache

# ---------------------------
# Helper: call HuggingFace Inference API
# ---------------------------
HEADERS = {"Authorization": f"Bearer {HF_API_KEY}"} if HF_API_KEY else {}

def hf_translate(text, target_code, target_name):
    MODEL = "Helsinki-NLP/opus-mt-en-ROMANCE"

    HF_URL = f"https://api-inference.huggingface.co/models/{MODEL}"
    headers = {"Authorization": f"Bearer {HF_API_KEY}"}

    payload = {
        "inputs": text,
        "parameters": {
            "src_lang": "eng_Latn",
            "tgt_lang": NLLB_CODES[target_code],
            "max_length": 300
        }
    }


    try:
        resp = requests.post(HF_URL, headers=headers, json=payload, timeout=15)

        if resp.status_code == 200:
            out = resp.json()
            if isinstance(out, list) and "translation_text" in out[0]:
                return out[0]["translation_text"]
            elif isinstance(out, dict) and "translation_text" in out:
                return out["translation_text"]

        print("HF ERROR:", resp.text)
        return f"[{target_code}] {text}"

    except Exception as e:
        print("HF EXCEPTION:", e)
        return f"[{target_code}] {text}"

# ---------------------------
# Initialize default languages
# ---------------------------
def init_default_langs():
    if languages_col.count_documents({}) == 0:
        languages_col.insert_many([
            {"code": "en", "name": "English", "is_default": True},
            {"code": "es", "name": "Spanish", "is_default": False},
            {"code": "fr", "name": "French", "is_default": False}
        ])
init_default_langs()

# ---------------------------
# Serialization helper
# ---------------------------
def serialize_doc(d):
    doc = dict(d)
    doc["_id"] = str(doc["_id"])
    return doc

# ---------------------------
# Routes: UI
# ---------------------------
@app.route("/")
def index():
    langs = list(languages_col.find({}, {"_id": 0}))
    return render_template("index.html", languages=langs)

# ---------------------------
# SSE (basic) - client can connect to receive events
# ---------------------------
@app.route("/stream")
def stream():
    def gen(last_index=0):
        idx = last_index
        while True:
            with SSE_LOCK:
                events = SSE_EVENTS[:]
            if idx < len(events):
                for ev in events[idx:]:
                    yield f"data: {json.dumps(ev)}\n\n"
                idx = len(events)
            time.sleep(1)
    return Response(gen(), mimetype="text/event-stream")

# ---------------------------
# Languages API
# ---------------------------
@app.route("/api/languages", methods=["GET"])
def api_get_languages():
    langs = list(languages_col.find({}, {"_id": 0}))
    return jsonify({"success": True, "languages": langs})

@app.route("/api/languages", methods=["POST"])
def api_add_language():
    body = request.get_json() or {}
    code = (body.get("code") or "").strip().lower()
    name = (body.get("name") or "").strip()

    if not code or not name:
        return jsonify({"success": False, "error": "code & name required"}), 400
    if languages_col.find_one({"code": code}):
        return jsonify({"success": False, "error": "language exists"}), 400

    languages_col.insert_one({"code": code, "name": name, "is_default": False})

    # Auto fill existing keys with translated values (best-effort)
    for t in translations_col.find({}):
        en = (t.get("values") or {}).get("en", "")
        translated = hf_translate(en, code, name)
        translations_col.update_one({"_id": t["_id"]}, {"$set": {f"values.{code}": translated, "updated_at": datetime.utcnow()}})

    push_event({"type": "language_added", "code": code, "name": name})
    return jsonify({"success": True, "code": code, "name": name})

# ---------------------------
# Translations CRUD
# ---------------------------

@app.route("/api/translations", methods=["GET"])
def api_list_translations():
    q = request.args.get("q", "").strip()
    page = int(request.args.get("page", "1"))
    per = int(request.args.get("per", "20"))
    sort_by = request.args.get("sort", "key")
    order = request.args.get("order", "asc")

    query = {}
    if q:
        query = {"$or": [{"key": {"$regex": q, "$options": "i"}}, {"values": {"$regex": q, "$options": "i"}}]}

    sort_dir = ASCENDING if order == "asc" else DESCENDING
    cursor = translations_col.find(query).sort(sort_by, sort_dir).skip((page-1)*per).limit(per)
    total = translations_col.count_documents(query)
    docs = [serialize_doc(d) for d in cursor]
    return jsonify({"success": True, "translations": docs, "page": page, "per": per, "total": total})

@app.route("/api/translations", methods=["POST"])
def api_add_translation():
    body = request.get_json() or {}
    key_raw = (body.get("key") or "").strip()
    en_value = (body.get("value") or "").strip()
    if not key_raw or not en_value:
        return jsonify({"success": False, "error": "key & english value required"}), 400

    key = key_raw.upper().replace(" ", "_")
    if translations_col.find_one({"key": key}):
        return jsonify({"success": False, "error": "key exists"}), 400

    values = {"en": en_value}
    languages = list(languages_col.find({}, {"_id": 0}))
    for lang in languages:
        code = lang["code"]
        name = lang["name"]
        if code == "en":
            continue
        values[code] = hf_translate(en_value, code, name)

    now = datetime.utcnow()
    doc = {"key": key, "values": values, "created_at": now, "updated_at": now}
    res = translations_col.insert_one(doc)
    doc["_id"] = str(res.inserted_id)

    push_event({"type": "translation_added", "key": key, "id": doc["_id"]})
    return jsonify({"success": True, "translation": doc})

@app.route("/api/translations/<tid>", methods=["PUT"])
def api_update_translation(tid):
    body = request.get_json() or {}
    values = body.get("values")
    if not isinstance(values, dict):
        return jsonify({"success": False, "error": "values dict required"}), 400
    translations_col.update_one({"_id": ObjectId(tid)}, {"$set": {"values": values, "updated_at": datetime.utcnow()}})
    push_event({"type": "translation_updated", "id": tid})
    return jsonify({"success": True})

@app.route("/api/translations/<tid>", methods=["DELETE"])
def api_delete_translation(tid):
    translations_col.delete_one({"_id": ObjectId(tid)})
    push_event({"type": "translation_deleted", "id": tid})
    return jsonify({"success": True})

@app.route("/api/translations/<tid>/regenerate", methods=["POST"])
def api_regenerate_translation(tid):
    doc = translations_col.find_one({"_id": ObjectId(tid)})
    if not doc:
        return jsonify({"success": False, "error": "not found"}), 404
    en = (doc.get("values") or {}).get("en", "")
    new_vals = {"en": en}
    for lang in list(languages_col.find({}, {"_id": 0})):
        code = lang["code"]; name = lang["name"]
        if code == "en": continue
        new_vals[code] = hf_translate(en, code, name)
    translations_col.update_one({"_id": doc["_id"]}, {"$set": {"values": new_vals, "updated_at": datetime.utcnow()}})
    push_event({"type": "translation_regenerated", "id": str(doc["_id"])})
    doc["values"] = new_vals; doc["_id"] = str(doc["_id"])
    return jsonify({"success": True, "translation": doc})

# ---------------------------
# Export as JSON
# ---------------------------
@app.route("/api/export/json", methods=["GET"])
def api_export_json():
    docs = [serialize_doc(d) for d in translations_col.find({})]
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
    with open(tmp.name, "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=2, default=str)
    return send_file(tmp.name, as_attachment=True, download_name="translations_export.json")

# ---------------------------
# Health
# ---------------------------
@app.route("/health")
def health():
    try:
        client.admin.command("ping")
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# ---------------------------
# Run
# ---------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=DEBUG)
