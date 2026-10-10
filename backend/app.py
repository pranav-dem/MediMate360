from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime, date, timedelta
from PIL import Image
import sqlite3
import io
import os
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "medimate.db")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024
CORS(app, resources={r"/api/*": {"origins": ["http://localhost:5173", "http://127.0.0.1:5173"]}})

def connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    with connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS medicines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            dosage TEXT NOT NULL,
            schedule TEXT NOT NULL DEFAULT '09:00',
            expiry_date TEXT NOT NULL,
            notes TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dose_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            medicine_id INTEGER,
            medicine_name TEXT NOT NULL,
            scheduled_date TEXT NOT NULL,
            scheduled_time TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('taken','skipped','missed')),
            logged_at TEXT NOT NULL,
            FOREIGN KEY(medicine_id) REFERENCES medicines(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS disposal_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            medicine_name TEXT NOT NULL,
            quantity TEXT NOT NULL,
            reason TEXT DEFAULT '',
            centre_id INTEGER,
            status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','handed_over')),
            created_at TEXT NOT NULL,
            handed_over_at TEXT,
            FOREIGN KEY(centre_id) REFERENCES centres(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS centres (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            accepted_items TEXT DEFAULT 'Confirm with centre',
            contact TEXT DEFAULT '',
            verified INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS care_circle (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            enabled INTEGER NOT NULL DEFAULT 0,
            contact_label TEXT DEFAULT '',
            consent_at TEXT
        );
        INSERT OR IGNORE INTO care_circle (id, enabled, contact_label) VALUES (1, 0, '');
        """)
        count = db.execute("SELECT COUNT(*) AS n FROM centres").fetchone()["n"]
        if count == 0:
            db.execute(
                "INSERT INTO centres (name,address,accepted_items,contact,verified,created_at) VALUES (?,?,?,?,?,?)",
                ("Example pharmacy (replace with a verified local centre)",
                 "Enter a confirmed local address",
                 "Call ahead to confirm accepted medicines",
                 "Add confirmed phone number", 0, datetime.now().isoformat(timespec="seconds"))
            )

def rowdict(row):
    return dict(row) if row else None

@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "app": "MediMate 360"})

@app.get("/api/medicines")
def get_medicines():
    with connection() as db:
        rows = db.execute("SELECT * FROM medicines ORDER BY expiry_date ASC, name ASC").fetchall()
    return jsonify([dict(r) for r in rows])

@app.post("/api/medicines")
def add_medicine():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    dosage = str(data.get("dosage", "")).strip()
    expiry = str(data.get("expiry_date", "")).strip()
    schedule = str(data.get("schedule", "09:00")).strip()
    notes = str(data.get("notes", "")).strip()
    if not name or not dosage or not expiry:
        return jsonify({"error": "name, dosage and expiry_date are required"}), 400
    try:
        date.fromisoformat(expiry)
        datetime.strptime(schedule, "%H:%M")
    except ValueError:
        return jsonify({"error": "Use a valid expiry date and 24-hour schedule time (HH:MM)."}), 400
    with connection() as db:
        cur = db.execute(
            "INSERT INTO medicines (name,dosage,schedule,expiry_date,notes,created_at) VALUES (?,?,?,?,?,?)",
            (name, dosage, schedule, expiry, notes, datetime.now().isoformat(timespec="seconds"))
        )
        item = db.execute("SELECT * FROM medicines WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(item)), 201

@app.delete("/api/medicines/<int:medicine_id>")
def delete_medicine(medicine_id):
    with connection() as db:
        cur = db.execute("DELETE FROM medicines WHERE id=?", (medicine_id,))
        if cur.rowcount == 0:
            return jsonify({"error": "Medicine not found"}), 404
    return jsonify({"deleted": True})

@app.post("/api/doses")
def log_dose():
    data = request.get_json(silent=True) or {}
    medicine_id = data.get("medicine_id")
    name = str(data.get("medicine_name", "")).strip()
    status = str(data.get("status", "")).strip().lower()
    scheduled_date = str(data.get("scheduled_date", date.today().isoformat()))
    scheduled_time = str(data.get("scheduled_time", "09:00"))
    if status not in ("taken", "skipped", "missed"):
        return jsonify({"error": "status must be taken, skipped, or missed"}), 400
    if not name:
        return jsonify({"error": "medicine_name is required"}), 400
    try:
        date.fromisoformat(scheduled_date)
        datetime.strptime(scheduled_time, "%H:%M")
    except ValueError:
        return jsonify({"error": "Invalid date or time"}), 400
    with connection() as db:
        cur = db.execute(
            "INSERT INTO dose_logs (medicine_id,medicine_name,scheduled_date,scheduled_time,status,logged_at) VALUES (?,?,?,?,?,?)",
            (medicine_id, name, scheduled_date, scheduled_time, status, datetime.now().isoformat(timespec="seconds"))
        )
        item = db.execute("SELECT * FROM dose_logs WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(item)), 201

@app.get("/api/doses")
def get_doses():
    with connection() as db:
        rows = db.execute("SELECT * FROM dose_logs ORDER BY scheduled_date DESC, scheduled_time DESC, id DESC LIMIT 100").fetchall()
    return jsonify([dict(r) for r in rows])

@app.get("/api/alerts")
def get_alerts():
    now = datetime.now()
    today = date.today().isoformat()
    alerts = []
    with connection() as db:
        meds = db.execute("SELECT * FROM medicines ORDER BY expiry_date").fetchall()
        logs = db.execute("SELECT medicine_id, scheduled_date, scheduled_time, status FROM dose_logs WHERE scheduled_date=?", (today,)).fetchall()
    logged = {(r["medicine_id"], r["scheduled_time"]) for r in logs if r["medicine_id"] is not None}
    for med in meds:
        try:
            expiry = date.fromisoformat(med["expiry_date"])
            days_left = (expiry - date.today()).days
            if days_left < 0:
                alerts.append({"type":"expired","medicine_id":med["id"],"medicine":med["name"],"message":f'{med["name"]} is past its listed expiry date.'})
            elif days_left <= 30:
                alerts.append({"type":"expiry","medicine_id":med["id"],"medicine":med["name"],"days_left":days_left,"message":f'{med["name"]} expires in {days_left} day(s).'})
        except ValueError:
            pass
        try:
            dose_dt = datetime.combine(date.today(), datetime.strptime(med["schedule"], "%H:%M").time())
            if now >= dose_dt and (med["id"], med["schedule"]) not in logged:
                alerts.append({"type":"dose","medicine_id":med["id"],"medicine":med["name"],"schedule":med["schedule"],"message":f'Time to check your {med["name"]} dose ({med["schedule"]}).'})
        except ValueError:
            pass
    return jsonify(alerts)

@app.post("/api/disposal")
def add_disposal():
    data = request.get_json(silent=True) or {}
    name = str(data.get("medicine_name", "")).strip()
    quantity = str(data.get("quantity", "")).strip()
    if not name or not quantity:
        return jsonify({"error":"medicine_name and quantity are required"}), 400
    centre_id = data.get("centre_id") or None
    with connection() as db:
        cur = db.execute(
            "INSERT INTO disposal_records (medicine_name,quantity,reason,centre_id,status,created_at) VALUES (?,?,?,?,?,?)",
            (name, quantity, str(data.get("reason","")).strip(), centre_id, "planned", datetime.now().isoformat(timespec="seconds"))
        )
        item = db.execute("""SELECT d.*, c.name AS centre_name FROM disposal_records d
                             LEFT JOIN centres c ON c.id=d.centre_id WHERE d.id=?""", (cur.lastrowid,)).fetchone()
    return jsonify(dict(item)), 201

@app.patch("/api/disposal/<int:record_id>")
def update_disposal(record_id):
    data = request.get_json(silent=True) or {}
    status = data.get("status")
    if status not in ("planned", "handed_over"):
        return jsonify({"error":"status must be planned or handed_over"}), 400
    handed = datetime.now().isoformat(timespec="seconds") if status == "handed_over" else None
    with connection() as db:
        cur = db.execute("UPDATE disposal_records SET status=?, handed_over_at=? WHERE id=?", (status, handed, record_id))
        if cur.rowcount == 0:
            return jsonify({"error":"Disposal record not found"}), 404
        item = db.execute("SELECT * FROM disposal_records WHERE id=?", (record_id,)).fetchone()
    return jsonify(dict(item))

@app.get("/api/disposal")
def get_disposal():
    with connection() as db:
        rows = db.execute("""SELECT d.*, c.name AS centre_name FROM disposal_records d
                             LEFT JOIN centres c ON c.id=d.centre_id ORDER BY d.id DESC""").fetchall()
    return jsonify([dict(r) for r in rows])

@app.get("/api/centres")
def get_centres():
    with connection() as db:
        rows = db.execute("SELECT * FROM centres ORDER BY verified DESC, name").fetchall()
    return jsonify([dict(r) for r in rows])

@app.post("/api/centres")
def add_centre():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name","")).strip()
    address = str(data.get("address","")).strip()
    if not name or not address:
        return jsonify({"error":"name and address are required"}), 400
    with connection() as db:
        cur = db.execute(
            "INSERT INTO centres (name,address,accepted_items,contact,verified,created_at) VALUES (?,?,?,?,0,?)",
            (name,address,str(data.get("accepted_items","Confirm with centre")),str(data.get("contact","")),datetime.now().isoformat(timespec="seconds"))
        )
        item = db.execute("SELECT * FROM centres WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(item)), 201

@app.post("/api/scan")
def scan_image():
    if "image" not in request.files:
        return jsonify({"error":"Upload an image using the 'image' field."}), 400
    file = request.files["image"]
    try:
        image = Image.open(io.BytesIO(file.read())).convert("RGB")
    except Exception:
        return jsonify({"error":"Could not read image. Upload a PNG, JPG or WEBP image."}), 400
    extracted = ""
    ocr_available = True
    try:
        import pytesseract
        extracted = pytesseract.image_to_string(image)
    except Exception:
        ocr_available = False
    # These are candidates only, not authoritative expiry detections.
    date_patterns = [
        r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b",
        r"\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b",
        r"\b(?:0?[1-9]|1[0-2])[/-]\d{4}\b",
        r"\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[ .-]?\d{2,4}\b"
    ]
    candidates = []
    for pattern in date_patterns:
        candidates.extend(re.findall(pattern, extracted, flags=re.IGNORECASE))
    return jsonify({"text":extracted[:12000],"date_candidates":list(dict.fromkeys(candidates))[:30],"ocr_available":ocr_available,
                    "message":"Confirm every detected date manually. OCR results can be wrong."})

@app.get("/api/summary")
def summary():
    today = date.today().isoformat()
    with connection() as db:
        medicines = db.execute("SELECT COUNT(*) AS n FROM medicines").fetchone()["n"]
        doses = db.execute("SELECT status, COUNT(*) AS n FROM dose_logs WHERE scheduled_date=?", (today,)).fetchall()
        expiry = db.execute("SELECT COUNT(*) AS n FROM medicines WHERE expiry_date >= ? AND expiry_date <= ?", (today, (date.today()+timedelta(days=30)).isoformat())).fetchone()["n"]
        disposed = db.execute("SELECT COUNT(*) AS n FROM disposal_records WHERE status='handed_over'").fetchone()["n"]
        disposal_total = db.execute("SELECT COUNT(*) AS n FROM disposal_records").fetchone()["n"]
    dose_counts = {r["status"]: r["n"] for r in doses}
    total = sum(dose_counts.values())
    adherence = round(100 * dose_counts.get("taken",0) / total) if total else 0
    return jsonify({"medicine_count":medicines,"today_taken":dose_counts.get("taken",0),"today_skipped":dose_counts.get("skipped",0),
                    "today_missed":dose_counts.get("missed",0),"today_logged":total,"today_adherence_percent":adherence,
                    "expiring_30_days":expiry,"disposal_handover_count":disposed,"disposal_record_count":disposal_total})

@app.get("/api/care-circle")
def get_care_circle():
    with connection() as db:
        row = db.execute("SELECT enabled,contact_label,consent_at FROM care_circle WHERE id=1").fetchone()
    return jsonify(dict(row))

@app.put("/api/care-circle")
def update_care_circle():
    data = request.get_json(silent=True) or {}
    enabled = 1 if data.get("enabled") else 0
    label = str(data.get("contact_label","")).strip()[:100]
    consent_at = datetime.now().isoformat(timespec="seconds") if enabled else None
    with connection() as db:
        db.execute("UPDATE care_circle SET enabled=?,contact_label=?,consent_at=? WHERE id=1", (enabled,label,consent_at))
        row = db.execute("SELECT enabled,contact_label,consent_at FROM care_circle WHERE id=1").fetchone()
    return jsonify(dict(row))

if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5000, debug=True)
