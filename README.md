# MediMate 360 — Complete Academic Prototype

Features:
- Medicine cabinet (add/delete medicines)
- Dose logging (taken/skipped/missed)
- Due-dose and expiry alerts
- Browser notifications (while the website is running and permission is granted)
- Medicine-label OCR scanner (Tesseract optional; user confirmation is important)
- Disposal records and handover status
- Collection-centre directory with verification status
- Dashboard and adherence statistics
- Voice commands and text-to-speech where browser support exists
- Care Circle opt-in settings (prototype preference only; no real SMS/email sending)
- Responsive dashboard

## Requirements
- Python 3.10+
- Node.js LTS
- Optional: Tesseract OCR installed on your computer for image text extraction

## Start backend
Open a terminal:
```bash
cd backend
python -m venv .venv
```
Windows:
```bash
.venv\Scripts\activate
```
macOS/Linux:
```bash
source .venv/bin/activate
```
Then:
```bash
pip install -r requirements.txt
python app.py
```
Backend health check: http://127.0.0.1:5000/api/health

## Start frontend
Open a second terminal:
```bash
cd frontend
npm install
npm run dev
```
Open the local URL shown by Vite (usually http://localhost:5173).

## Notes and limitations
- This is an academic demo, not a clinical or production system.
- Dose records are self-reported; the app cannot verify that medicine was taken.
- Browser notifications require permission and generally work only while the site is running. They are not a guaranteed background alarm.
- OCR can misread medicine names and dates. Always confirm expiry dates manually.
- The Care Circle feature stores a local preference/contact label only; it does not send messages. Add a secure notification provider and consent workflow before real use.
- Centre verification is a demo field. Only mark centres verified after checking them with the relevant authority.
- No user login or multi-user isolation is implemented. Do not enter real sensitive medical information.
- Disposal rules vary by location. Follow local pharmacy/health-authority guidance; do not assume every centre accepts every medicine.
