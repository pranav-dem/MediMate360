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

# FIX: Allow your production Vercel frontend domain to access your backend API endpoints
CORS(app, resources={
    r"/api/*": {
        "origins": [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "https://vercel.app"
        ]
    }
})

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

# Run database creation automatically when starting the script
init_db()

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
    return jsonify({"deleted": medicine_id}), 200

if __name__ == "__main__":
    app.run(debug=True, port=5000)