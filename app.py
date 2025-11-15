# app.py
"""
Translation Management Tool (TMT) - Production-Ready Backend
Features:
- Flask REST API with server-rendered UI
- MongoDB (Atlas or local) for persistence
- Google Translate API via Node.js microservice
- Language management with standard language presets
- Add/Search/Edit/Delete translations
- Regenerate translations
- Export translations JSON
- Real-time SSE notifications
- Production-grade error handling and logging
"""

import os
import json
import time
import threading
import logging
from datetime import datetime
from typing import Dict, List
from functools import wraps

from flask import Flask, render_template, request, jsonify, Response, send_file
from flask_cors import CORS
from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import PyMongoError
from bson import ObjectId
from dotenv import load_dotenv
import requests
import tempfile

# ---------------------------
# Logging Configuration
# ---------------------------
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ---------------------------
# Load environment variables
# ---------------------------
load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    raise RuntimeError("MONGO_URI is required in .env file")

DB_NAME = os.getenv("MONGO_DB", "translation")
TRANSLATION_SERVICE_URL = os.getenv("TRANSLATION_SERVICE_URL", "http://localhost:4000")

# App settings
PORT = int(os.getenv("PORT", "5000"))
DEBUG = os.getenv("FLASK_DEBUG", "False").lower() in ("1", "true", "yes")

# ---------------------------
# Flask + MongoDB Initialization
# ---------------------------
app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)

# MongoDB connection with error handling
try:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    client.admin.command('ping')
    db = client[DB_NAME]
    translations_col = db["translations"]
    languages_col = db["languages"]
    logger.info("MongoDB connection established successfully")
except PyMongoError as e:
    logger.error(f"MongoDB connection failed: {e}")
    raise

# Create indexes for better performance
try:
    translations_col.create_index([("key", ASCENDING)], unique=True)
    translations_col.create_index([("created_at", DESCENDING)])
    languages_col.create_index([("code", ASCENDING)], unique=True)
    logger.info("Database indexes created successfully")
except Exception as e:
    logger.warning(f"Index creation warning: {e}")

# ---------------------------
# SSE Event Management
# ---------------------------
SSE_EVENTS = []
SSE_LOCK = threading.Lock()
MAX_EVENTS = 300

def push_event(event: Dict):
    """Push event to SSE stream"""
    with SSE_LOCK:
        SSE_EVENTS.append({"ts": time.time(), **event})
        if len(SSE_EVENTS) > MAX_EVENTS:
            SSE_EVENTS.pop(0)
    logger.info(f"Event pushed: {event.get('type')}")

# ---------------------------
# Standard Language Presets
# ---------------------------
STANDARD_LANGUAGES = [
    {"code": "en", "name": "English"},
    {"code": "es", "name": "Spanish"},
    {"code": "fr", "name": "French"},
    {"code": "de", "name": "German"},
    {"code": "it", "name": "Italian"},
    {"code": "pt", "name": "Portuguese"},
    {"code": "ru", "name": "Russian"},
    {"code": "ja", "name": "Japanese"},
    {"code": "ko", "name": "Korean"},
    {"code": "zh-CN", "name": "Chinese (Simplified)"},
    {"code": "zh-TW", "name": "Chinese (Traditional)"},
    {"code": "ar", "name": "Arabic"},
    {"code": "hi", "name": "Hindi"},
    {"code": "bn", "name": "Bengali"},
    {"code": "ta", "name": "Tamil"},
    {"code": "te", "name": "Telugu"},
    {"code": "mr", "name": "Marathi"},
    {"code": "ur", "name": "Urdu"},
    {"code": "tr", "name": "Turkish"},
    {"code": "vi", "name": "Vietnamese"},
    {"code": "th", "name": "Thai"},
    {"code": "nl", "name": "Dutch"},
    {"code": "pl", "name": "Polish"},
    {"code": "sv", "name": "Swedish"},
    {"code": "no", "name": "Norwegian"},
    {"code": "da", "name": "Danish"},
    {"code": "fi", "name": "Finnish"}
]

# ---------------------------
# Translation Service Integration
# ---------------------------
def call_translation_service(text: str, target_languages: List[str]) -> Dict:
    """Call Node.js translation microservice"""
    try:
        response = requests.post(
            f"{TRANSLATION_SERVICE_URL}/translate",
            json={"text": text, "languages": target_languages},
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        
        if data.get("success"):
            return {"success": True, "translations": data.get("translations", {})}
        else:
            return {"success": False, "error": data.get("error", "Translation service error")}
    
    except requests.exceptions.ConnectionError:
        logger.error("Translation service not available")
        return {"success": False, "error": "Translation service unavailable"}
    except requests.exceptions.Timeout:
        logger.error("Translation service timeout")
        return {"success": False, "error": "Translation service timeout"}
    except Exception as e:
        logger.error(f"Translation service error: {e}")
        return {"success": False, "error": str(e)}

# ---------------------------
# Initialize Default Languages
# ---------------------------
def init_default_languages():
    """Initialize database with default languages"""
    try:
        if languages_col.count_documents({}) == 0:
            default_langs = [
                {"code": "en", "name": "English", "is_default": True},
                {"code": "es", "name": "Spanish", "is_default": False},
                {"code": "fr", "name": "French", "is_default": False}
            ]
            languages_col.insert_many(default_langs)
            logger.info("Default languages initialized")
    except Exception as e:
        logger.error(f"Error initializing languages: {e}")

init_default_languages()

# ---------------------------
# Utility Functions
# ---------------------------
def serialize_doc(doc):
    """Convert MongoDB document to JSON-serializable format"""
    if doc is None:
        return None
    doc_copy = dict(doc)
    doc_copy["_id"] = str(doc_copy["_id"])
    if "created_at" in doc_copy:
        doc_copy["created_at"] = doc_copy["created_at"].isoformat()
    if "updated_at" in doc_copy:
        doc_copy["updated_at"] = doc_copy["updated_at"].isoformat()
    return doc_copy

def error_response(message: str, status_code: int = 400):
    """Standard error response"""
    return jsonify({"success": False, "error": message}), status_code

def success_response(data: Dict = None, message: str = None):
    """Standard success response"""
    response = {"success": True}
    if data:
        response.update(data)
    if message:
        response["message"] = message
    return jsonify(response)

# ---------------------------
# Error Handlers
# ---------------------------
@app.errorhandler(404)
def not_found(e):
    return error_response("Resource not found", 404)

@app.errorhandler(500)
def internal_error(e):
    logger.error(f"Internal error: {e}")
    return error_response("Internal server error", 500)

# ---------------------------
# Routes: UI
# ---------------------------
@app.route("/")
def index():
    """Render main application page"""
    try:
        langs = list(languages_col.find({}, {"_id": 0}))
        return render_template("index.html", languages=langs, standard_languages=STANDARD_LANGUAGES)
    except Exception as e:
        logger.error(f"Error rendering index: {e}")
        return "Application error", 500

# ---------------------------
# SSE Stream
# ---------------------------
@app.route("/stream")
def stream():
    """Server-Sent Events endpoint for real-time updates"""
    def event_generator():
        last_index = 0
        while True:
            with SSE_LOCK:
                events = SSE_EVENTS[:]
            
            if last_index < len(events):
                for event in events[last_index:]:
                    yield f"data: {json.dumps(event)}\n\n"
                last_index = len(events)
            
            time.sleep(1)
    
    return Response(event_generator(), mimetype="text/event-stream")

# ---------------------------
# Languages API
# ---------------------------
@app.route("/api/languages", methods=["GET"])
def api_get_languages():
    """Get all configured languages"""
    try:
        langs = list(languages_col.find({}, {"_id": 0}))
        return success_response({"languages": langs})
    except Exception as e:
        logger.error(f"Error fetching languages: {e}")
        return error_response("Failed to fetch languages", 500)

@app.route("/api/languages/standard", methods=["GET"])
def api_get_standard_languages():
    """Get list of standard language presets"""
    return success_response({"languages": STANDARD_LANGUAGES})

@app.route("/api/languages", methods=["POST"])
def api_add_language():
    """Add a new language"""
    try:
        body = request.get_json() or {}
        code = (body.get("code") or "").strip().lower()
        name = (body.get("name") or "").strip()

        if not code or not name:
            return error_response("Language code and name are required")

        # Check if language already exists
        if languages_col.find_one({"code": code}):
            return error_response("Language already exists")

        # Insert new language
        languages_col.insert_one({
            "code": code,
            "name": name,
            "is_default": False
        })

        # Auto-translate existing keys to new language
        existing_count = 0
        for translation in translations_col.find({}):
            en_value = (translation.get("values") or {}).get("en", "")
            if en_value:
                result = call_translation_service(en_value, [code])
                if result.get("success"):
                    translations = result.get("translations", {})
                    new_value = translations.get(code, f"[{code}] {en_value}")
                    translations_col.update_one(
                        {"_id": translation["_id"]},
                        {
                            "$set": {
                                f"values.{code}": new_value,
                                "updated_at": datetime.utcnow()
                            }
                        }
                    )
                    existing_count += 1

        push_event({
            "type": "language_added",
            "code": code,
            "name": name,
            "translations_updated": existing_count
        })

        logger.info(f"Language added: {code} ({name}), {existing_count} translations updated")
        return success_response({
            "code": code,
            "name": name,
            "translations_updated": existing_count
        })

    except Exception as e:
        logger.error(f"Error adding language: {e}")
        return error_response("Failed to add language", 500)

# ---------------------------
# Translations CRUD
# ---------------------------
@app.route("/api/translations", methods=["GET"])
def api_list_translations():
    """List translations with search, pagination and sorting"""
    try:
        query_text = request.args.get("q", "").strip()
        page = max(1, int(request.args.get("page", "1")))
        per_page = max(1, min(100, int(request.args.get("per", "20"))))
        sort_by = request.args.get("sort", "key")
        order = request.args.get("order", "asc")

        # Build query
        query = {}
        if query_text:
            query = {
                "$or": [
                    {"key": {"$regex": query_text, "$options": "i"}},
                    {"values": {"$regex": query_text, "$options": "i"}}
                ]
            }

        # Sort direction
        sort_dir = ASCENDING if order == "asc" else DESCENDING

        # Execute query
        cursor = translations_col.find(query).sort(sort_by, sort_dir).skip((page - 1) * per_page).limit(per_page)
        total = translations_col.count_documents(query)
        docs = [serialize_doc(d) for d in cursor]

        return success_response({
            "translations": docs,
            "page": page,
            "per": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page
        })

    except Exception as e:
        logger.error(f"Error listing translations: {e}")
        return error_response("Failed to fetch translations", 500)

@app.route("/api/translations", methods=["POST"])
def api_add_translation():
    """Add new translation with auto-generation"""
    try:
        body = request.get_json() or {}
        key_raw = (body.get("key") or "").strip()
        en_value = (body.get("value") or "").strip()
        target_languages = body.get("languages", [])

        if not key_raw or not en_value:
            return error_response("Translation key and English value are required")

        # Normalize key
        key = key_raw.upper().replace(" ", "_")

        # Check if key already exists
        if translations_col.find_one({"key": key}):
            return error_response("Translation key already exists")

        # Get target languages
        if not target_languages:
            langs = list(languages_col.find({"code": {"$ne": "en"}}, {"_id": 0}))
            target_languages = [lang["code"] for lang in langs]

        # Call translation service
        values = {"en": en_value}
        if target_languages:
            result = call_translation_service(en_value, target_languages)
            if result.get("success"):
                values.update(result.get("translations", {}))
            else:
                logger.warning(f"Translation service error: {result.get('error')}")
                # Use fallback format
                for lang in target_languages:
                    values[lang] = f"[{lang}] {en_value}"

        # Insert document
        now = datetime.utcnow()
        doc = {
            "key": key,
            "values": values,
            "created_at": now,
            "updated_at": now
        }
        result = translations_col.insert_one(doc)
        doc["_id"] = str(result.inserted_id)

        push_event({
            "type": "translation_added",
            "key": key,
            "id": doc["_id"]
        })

        logger.info(f"Translation added: {key}")
        return success_response({"translation": serialize_doc(doc)})

    except Exception as e:
        logger.error(f"Error adding translation: {e}")
        return error_response("Failed to add translation", 500)

@app.route("/api/translations/<tid>", methods=["PUT"])
def api_update_translation(tid):
    """Update translation values"""
    try:
        body = request.get_json() or {}
        values = body.get("values")

        if not isinstance(values, dict):
            return error_response("Values must be a dictionary")

        result = translations_col.update_one(
            {"_id": ObjectId(tid)},
            {
                "$set": {
                    "values": values,
                    "updated_at": datetime.utcnow()
                }
            }
        )

        if result.matched_count == 0:
            return error_response("Translation not found", 404)

        push_event({"type": "translation_updated", "id": tid})
        logger.info(f"Translation updated: {tid}")
        return success_response()

    except Exception as e:
        logger.error(f"Error updating translation: {e}")
        return error_response("Failed to update translation", 500)

@app.route("/api/translations/<tid>", methods=["DELETE"])
def api_delete_translation(tid):
    """Delete translation"""
    try:
        result = translations_col.delete_one({"_id": ObjectId(tid)})

        if result.deleted_count == 0:
            return error_response("Translation not found", 404)

        push_event({"type": "translation_deleted", "id": tid})
        logger.info(f"Translation deleted: {tid}")
        return success_response()

    except Exception as e:
        logger.error(f"Error deleting translation: {e}")
        return error_response("Failed to delete translation", 500)

@app.route("/api/translations/<tid>/regenerate", methods=["POST"])
def api_regenerate_translation(tid):
    """Regenerate all translations from English"""
    try:
        doc = translations_col.find_one({"_id": ObjectId(tid)})
        if not doc:
            return error_response("Translation not found", 404)

        en_value = (doc.get("values") or {}).get("en", "")
        if not en_value:
            return error_response("No English value to translate from")

        # Get target languages
        langs = list(languages_col.find({"code": {"$ne": "en"}}, {"_id": 0}))
        target_languages = [lang["code"] for lang in langs]

        # Translate
        new_values = {"en": en_value}
        if target_languages:
            result = call_translation_service(en_value, target_languages)
            if result.get("success"):
                new_values.update(result.get("translations", {}))
            else:
                for lang in target_languages:
                    new_values[lang] = f"[{lang}] {en_value}"

        # Update document
        translations_col.update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "values": new_values,
                    "updated_at": datetime.utcnow()
                }
            }
        )

        push_event({"type": "translation_regenerated", "id": tid})
        logger.info(f"Translation regenerated: {tid}")

        doc["values"] = new_values
        return success_response({"translation": serialize_doc(doc)})

    except Exception as e:
        logger.error(f"Error regenerating translation: {e}")
        return error_response("Failed to regenerate translation", 500)

# ---------------------------
# Export
# ---------------------------
@app.route("/api/export/json", methods=["GET"])
def api_export_json():
    """Export all translations as JSON"""
    try:
        docs = [serialize_doc(d) for d in translations_col.find({})]
        
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode='w', encoding='utf-8')
        json.dump(docs, tmp, ensure_ascii=False, indent=2)
        tmp.close()
        
        return send_file(
            tmp.name,
            as_attachment=True,
            download_name=f"translations_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
            mimetype='application/json'
        )
    except Exception as e:
        logger.error(f"Error exporting translations: {e}")
        return error_response("Failed to export translations", 500)

# ---------------------------
# Health Check
# ---------------------------
@app.route("/health")
def health():
    """Health check endpoint"""
    try:
        # Check MongoDB
        client.admin.command("ping")
        
        # Check translation service
        try:
            resp = requests.get(f"{TRANSLATION_SERVICE_URL}/health", timeout=2)
            translation_service_status = resp.status_code == 200
        except:
            translation_service_status = False
        
        return jsonify({
            "status": "healthy",
            "mongodb": "connected",
            "translation_service": "connected" if translation_service_status else "disconnected",
            "timestamp": datetime.utcnow().isoformat()
        })
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }), 500

# ---------------------------
# Run Application
# ---------------------------
if __name__ == "__main__":
    logger.info(f"Starting Translation Management Tool on port {PORT}")
    logger.info(f"Debug mode: {DEBUG}")
    app.run(host="0.0.0.0", port=PORT, debug=DEBUG)