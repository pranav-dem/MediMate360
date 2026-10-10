import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API = 'https://medimate360-api.onrender.com/api';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const prettyDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—';

export default function App() {
  const [tab, setTab] = useState('Dashboard');
  const [medicines, setMedicines] = useState([]);
  const [doses, setDoses] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [disposals, setDisposals] = useState([]);
  const [centres, setCentres] = useState([]);
  const [summary, setSummary] = useState({});
  const [care, setCare] = useState({ enabled: false, contact_label: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [medicineForm, setMedicineForm] = useState({ name:'', dosage:'1 tablet', schedule:'09:00', expiry_date:'', notes:'' });
  const [disposalForm, setDisposalForm] = useState({ medicine_name:'', quantity:'1 pack', reason:'Expired', centre_id:'' });
  const [centreForm, setCentreForm] = useState({ name:'', address:'', accepted_items:'Call ahead to confirm', contact:'' });
  const [careForm, setCareForm] = useState({ enabled:false, contact_label:'' });
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [m,d,a,ds,c,s,cc] = await Promise.all([
        request('/medicines'), request('/doses'), request('/alerts'),
        request('/disposal'), request('/centres'), request('/summary'), request('/care-circle')
      ]);
      setMedicines(m); setDoses(d); setAlerts(a); setDisposals(ds); setCentres(c); setSummary(s);
      setCare(cc); setCareForm({ enabled: !!cc.enabled, contact_label: cc.contact_label || '' });
      setError('');
    } catch (e) { setError(`${e.message}. Check that the backend is running at ${API}.`); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    setVoiceSupported(!!(window.SpeechRecognition || window.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const due = alerts.filter(a => a.type === 'dose');
    due.forEach(a => {
      const key = `medimate-notified-${today()}-${a.medicine_id}-${a.schedule}`;
      if (!sessionStorage.getItem(key)) {
        try { new Notification('MediMate 360 dose reminder', { body: a.message }); sessionStorage.setItem(key, '1'); } catch {}
      }
    });
  }, [alerts]);

  const showMessage = (message) => {
    setNotice(message); setTimeout(() => setNotice(''), 3500);
  };

  async function addMedicine(e) {
    e.preventDefault(); setBusy(true);
    try {
      await request('/medicines', json('POST', medicineForm));
      setMedicineForm({ name:'', dosage:'1 tablet', schedule:'09:00', expiry_date:'', notes:'' });
      showMessage('Medicine added successfully.'); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function deleteMedicine(id) {
    if (!window.confirm('Remove this medicine from your cabinet? Existing dose history remains.')) return;
    try { await request(`/medicines/${id}`, { method:'DELETE' }); showMessage('Medicine removed.'); await load(); }
    catch(e) { setError(e.message); }
  }

  async function recordDose(med, status) {
    try {
      await request('/doses', json('POST', { medicine_id:med.id, medicine_name:med.name, scheduled_date:today(), scheduled_time:med.schedule, status }));
      showMessage(`${med.name}: marked ${status}.`); await load();
    } catch(e) { setError(e.message); }
  }

  async function addDisposal(e) {
    e.preventDefault();
    try {
      await request('/disposal', json('POST', { ...disposalForm, centre_id: disposalForm.centre_id || null }));
      setDisposalForm({ medicine_name:'', quantity:'1 pack', reason:'Expired', centre_id:'' });
      showMessage('Disposal plan saved. Confirm local disposal instructions first.'); await load();
    } catch(e) { setError(e.message); }
  }

  async function markHandedOver(id) {
    if (!window.confirm('Confirm that you have physically handed the medicine to the collection centre?')) return;
    try { await request(`/disposal/${id}`, json('PATCH', { status:'handed_over' })); showMessage('Handover recorded.'); await load(); }
    catch(e) { setError(e.message); }
  }

  async function addCentre(e) {
    e.preventDefault();
    try {
      await request('/centres', json('POST', centreForm));
      setCentreForm({ name:'', address:'', accepted_items:'Call ahead to confirm', contact:'' });
      showMessage('Centre added as unverified. Verify details before recommending it.'); await load();
    } catch(e) { setError(e.message); }
  }

  async function saveCare(e) {
    e.preventDefault();
    try {
      const result = await request('/care-circle', json('PUT', careForm));
      setCare(result); showMessage(result.enabled ? 'Care Circle preference saved.' : 'Care Circle disabled.');
    } catch(e) { setError(e.message); }
  }

  async function scanFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    const fd = new FormData(); fd.append('image', file);
    setScanBusy(true); setScanResult(null);
    try {
      const result = await request('/scan', { method:'POST', body:fd });
      setScanResult(result);
      if (!result.ocr_available) setError('OCR engine unavailable. Install Tesseract and restart the backend.');
    } catch(err) { setError(err.message); }
    finally { setScanBusy(false); e.target.value = ''; }
  }

  async function enableNotifications() {
    if (!('Notification' in window)) { showMessage('This browser does not support notifications.'); return; }
    const permission = await Notification.requestPermission();
    showMessage(permission === 'granted' ? 'Notifications enabled while the website is running.' : 'Notification permission was not granted.');
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) { showMessage('Text-to-speech is not supported in this browser.'); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-IN'; window.speechSynthesis.speak(utterance);
  }

  function startVoice() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { showMessage('Voice recognition is not supported in this browser.'); return; }
    const rec = new Recognition(); rec.lang = 'en-IN'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const command = event.results[0][0].transcript.toLowerCase();
      if (command.includes('medicine')) setTab('Medicines');
      else if (command.includes('expiry') || command.includes('expire')) setTab('Scanner');
      else if (command.includes('disposal') || command.includes('dispose')) setTab('Disposal');
      else if (command.includes('centre') || command.includes('center')) setTab('Centres');
      else if (command.includes('care')) setTab('Care Circle');
      else setTab('Dashboard');
      showMessage(`Voice command: “${command}”`);
    };
    rec.onerror = () => showMessage('Could not recognise that command. Try again.');
    rec.start();
  }

  const nav = ['Dashboard','Medicines','Scanner','Disposal','Centres','History','Care Circle'];
  const expiredCount = medicines.filter(m => m.expiry_date < today()).length;
  const expiringSoon = medicines.filter(m => m.expiry_date >= today() && m.expiry_date <= new Date(Date.now()+30*86400000).toISOString().slice(0,10)).length;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">✚</div><div><strong>MediMate 360</strong><span>Care smarter. Waste less.</span></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{nav.map((n,i)=><button key={n} className={`nav-item ${tab===n?'active':''}`} onClick={()=>setTab(n)}><span className="nav-icon">{['◫','▣','⌕','♻','⌖','◷','♡'][i]}</span>{n}</button>)}</nav>
      <div className="sidebar-bottom"><div className="mini-shield">✓</div><div><b>Your health, your choice</b><span>Prototype · Local data</span></div></div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div><span className="eyebrow">MEDICATION & RESPONSIBLE DISPOSAL</span><h1>{tab === 'Dashboard' ? 'Your health overview' : tab}</h1></div>
        <div className="top-actions">
          <button className="button light" onClick={enableNotifications}>♧ Enable alerts</button>
          <button className="button primary" onClick={startVoice} title="Use a voice command">🎙 {voiceSupported ? 'Voice command' : 'Voice'}</button>
        </div>
      </header>
      {error && <div className="banner error"><span>{error}</span><button onClick={()=>setError('')}>×</button></div>}
      {notice && <div className="banner success">{notice}</div>}

      {tab === 'Dashboard' && <section className="page">
        <div className="welcome-card">
          <div><div className="pill-tag">YOUR DAILY CARE COMPANION</div><h2>Small reminders.<br/><em>Better routines.</em></h2><p>Keep track of your doses, catch expiry dates early, and make responsible disposal easier.</p><div className="welcome-actions"><button className="button white" onClick={()=>setTab('Medicines')}>＋ Add a medicine</button><button className="button glass" onClick={()=>setTab('Scanner')}>Scan a label ↗</button></div></div>
          <div className="welcome-art"><div className="art-circle">✚</div><div className="art-pill">MEDICINE<br/><small>CARE KIT</small></div><div className="art-leaf">✦</div></div>
        </div>
        <div className="stats-grid">
          <Stat icon="▣" label="Medicines tracked" value={summary.medicine_count ?? 0} note="In your medicine cabinet" />
          <Stat icon="◷" label="Doses logged today" value={summary.today_logged ?? 0} note={`${summary.today_taken ?? 0} marked as taken`} />
          <Stat icon="⌛" label="Expiring soon" value={summary.expiring_30_days ?? 0} note="Within the next 30 days" />
          <Stat icon="♻" label="Handover records" value={summary.disposal_handover_count ?? 0} note="User-confirmed handovers" />
        </div>
        <div className="content-grid">
          <div className="panel"><div className="panel-heading"><div><h3>Needs your attention</h3><p>Alerts based on your saved information</p></div><span className="count-badge">{alerts.length}</span></div>
            {alerts.length === 0 ? <Empty text="You're all caught up. Add medicines to see schedule and expiry alerts."/> : <div className="alert-list">{alerts.slice(0,6).map((a,i)=><div className="alert-row" key={`${a.type}-${a.medicine_id}-${i}`}><span className={`alert-symbol ${a.type}`}>{a.type==='dose'?'◷':a.type==='expired'?'!':'⌛'}</span><div><b>{a.message}</b><small>{a.type==='dose'?'Dose reminder':a.type==='expired'?'Expiry passed':'Expiry approaching'}</small></div><span className={`status ${a.type}`}>{a.type==='dose'?'DOSE':a.type==='expired'?'EXPIRED':'EXPIRY'}</span></div>)}</div>}
          </div>
          <div className="panel impact-panel"><div className="panel-heading"><div><h3>Your impact snapshot</h3><p>Based on recorded activity</p></div><span className="impact-icon">✦</span></div>
            <div className="impact-number">{summary.disposal_handover_count ?? 0}<span> handovers</span></div><p className="muted">Each recorded handover is a step toward responsible medicine disposal.</p>
            <div className="impact-divider"></div><div className="impact-line"><span>Disposal plans created</span><b>{summary.disposal_record_count ?? 0}</b></div><div className="impact-line"><span>Medicines nearing expiry</span><b>{summary.expiring_30_days ?? 0}</b></div>
            <button className="text-button" onClick={()=>setTab('Disposal')}>Manage disposal plans →</button>
          </div>
        </div>
        <div className="panel"><div className="panel-heading"><div><h3>Today's medicine schedule</h3><p>Use the buttons to record your own dose status</p></div><button className="text-button" onClick={()=>setTab('Medicines')}>View all →</button></div>
          {medicines.length===0 ? <Empty text="Your cabinet is empty. Add a medicine to begin."/> : <div className="table-wrap"><table><thead><tr><th>MEDICINE</th><th>TIME</th><th>EXPIRY</th><th>RECORD DOSE</th></tr></thead><tbody>{medicines.map(m=><tr key={m.id}><td><b>{m.name}</b><small>{m.dosage}</small></td><td>{m.schedule}</td><td>{prettyDate(m.expiry_date)}</td><td><div className="row-actions"><button className="tiny good" onClick={()=>recordDose(m,'taken')}>Taken</button><button className="tiny neutral" onClick={()=>recordDose(m,'skipped')}>Skipped</button></div></td></tr>)}</tbody></table></div>}
        </div>
      </section>}

      {tab === 'Medicines' && <section className="page split-page">
        <div className="panel"><div className="panel-heading"><div><h3>Add a medicine</h3><p>Enter details from the package or prescription.</p></div></div>
          <form className="form" onSubmit={addMedicine}>
            <Field label="Medicine name"><input required value={medicineForm.name} onChange={e=>setMedicineForm({...medicineForm,name:e.target.value})} placeholder="e.g. Vitamin tablet"/></Field>
            <Field label="Dosage"><input required value={medicineForm.dosage} onChange={e=>setMedicineForm({...medicineForm,dosage:e.target.value})} placeholder="e.g. 1 tablet"/></Field>
            <Field label="Reminder time"><input required type="time" value={medicineForm.schedule} onChange={e=>setMedicineForm({...medicineForm,schedule:e.target.value})}/></Field>
            <Field label="Expiry date"><input required type="date" value={medicineForm.expiry_date} onChange={e=>setMedicineForm({...medicineForm,expiry_date:e.target.value})}/></Field>
            <Field label="Notes (optional)"><textarea value={medicineForm.notes} onChange={e=>setMedicineForm({...medicineForm,notes:e.target.value})} placeholder="Optional notes"/></Field>
            <button className="button primary full" disabled={busy}>{busy?'Saving…':'Save medicine'}</button>
          </form>
        </div>
        <div className="panel"><div className="panel-heading"><div><h3>Medicine cabinet</h3><p>{medicines.length} medicine(s) tracked</p></div></div>
          {medicines.length===0?<Empty text="Medicines you add will appear here."/>:<div className="medicine-list">{medicines.map(m=><div className="medicine-card" key={m.id}><div className="medicine-icon">✚</div><div className="medicine-info"><b>{m.name}</b><span>{m.dosage} · {m.schedule}</span><small>Expires {prettyDate(m.expiry_date)} {m.expiry_date<today()?'· Expired':''}</small></div><button className="icon-button" title="Delete medicine" onClick={()=>deleteMedicine(m.id)}>×</button></div>)}</div>}
        </div>
      </section>}

      {tab === 'Scanner' && <section className="page">
        <div className="panel scanner-panel"><div className="panel-heading"><div><h3>Medicine label scanner</h3><p>Extract possible dates from a package image using OCR.</p></div><span className="scan-icon">⌕</span></div>
          <div className="upload-zone" onClick={()=>fileRef.current?.click()} role="button" tabIndex="0" onKeyDown={e=>e.key==='Enter'&&fileRef.current?.click()}><div className="upload-icon">↑</div><b>{scanBusy?'Scanning image…':'Choose a medicine label image'}</b><span>PNG, JPG or WEBP · Maximum 5 MB</span><button type="button" className="button light">{scanBusy?'Please wait':'Choose image'}</button><input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={scanFile}/></div>
          <div className="notice-box">⚠ OCR can misread text and dates. Verify the printed expiry date yourself before saving or acting on it.</div>
          {scanResult && <div className="scan-results"><h3>Scan results</h3><p>{scanResult.message}</p><div className="candidate-list"><b>Possible dates detected</b>{scanResult.date_candidates?.length ? scanResult.date_candidates.map((d,i)=><span className="candidate" key={i}>{d}</span>):<span className="muted">No obvious date pattern found.</span>}</div><details><summary>View extracted text</summary><pre>{scanResult.text || 'No text extracted.'}</pre></details></div>}
        </div>
      </section>}

      {tab === 'Disposal' && <section className="page split-page">
        <div className="panel"><div className="panel-heading"><div><h3>Create a disposal plan</h3><p>Record medicines that need appropriate disposal.</p></div></div>
          <form className="form" onSubmit={addDisposal}>
            <Field label="Medicine name"><input required value={disposalForm.medicine_name} onChange={e=>setDisposalForm({...disposalForm,medicine_name:e.target.value})} placeholder="Medicine or product name"/></Field>
            <Field label="Quantity"><input required value={disposalForm.quantity} onChange={e=>setDisposalForm({...disposalForm,quantity:e.target.value})} placeholder="e.g. 1 strip"/></Field>
            <Field label="Reason"><select value={disposalForm.reason} onChange={e=>setDisposalForm({...disposalForm,reason:e.target.value})}><option>Expired</option><option>Unneeded</option><option>Damaged packaging</option><option>Other</option></select></Field>
            <Field label="Collection centre (optional)"><select value={disposalForm.centre_id} onChange={e=>setDisposalForm({...disposalForm,centre_id:e.target.value})}><option value="">Choose later</option>{centres.map(c=><option key={c.id} value={c.id}>{c.name}{c.verified?' · verified':' · unverified'}</option>)}</select></Field>
            <button className="button primary full">Save disposal plan</button>
            <p className="form-hint">Contact the centre first to confirm what it accepts. Follow local authority guidance.</p>
          </form>
        </div>
        <div className="panel"><div className="panel-heading"><div><h3>Disposal history</h3><p>Mark a handover only after it has happened.</p></div></div>
          {disposals.length===0?<Empty text="Your disposal plans will appear here."/>:<div className="record-list">{disposals.map(d=><div className="record-card" key={d.id}><div className="record-top"><b>{d.medicine_name}</b><span className={`status ${d.status==='handed_over'?'taken':'planned'}`}>{d.status==='handed_over'?'HANDED OVER':'PLANNED'}</span></div><p>{d.quantity} · {d.reason}</p><small>{d.centre_name || 'No centre selected'} · {new Date(d.created_at).toLocaleDateString()}</small>{d.status!=='handed_over'&&<button className="button light compact" onClick={()=>markHandedOver(d.id)}>Confirm handover</button>}</div>)}</div>}
        </div>
      </section>}

      {tab === 'Centres' && <section className="page split-page">
        <div className="panel"><div className="panel-heading"><div><h3>Collection centre directory</h3><p>Only mark a centre verified after independently confirming it.</p></div></div>
          <div className="notice-box">The starter entry is a placeholder, not a real verified location. Replace it with confirmed local information.</div>
          {centres.map(c=><div className="centre-card" key={c.id}><div className="centre-symbol">⌖</div><div className="centre-info"><div className="record-top"><b>{c.name}</b><span className={`status ${c.verified?'taken':'planned'}`}>{c.verified?'VERIFIED':'UNVERIFIED'}</span></div><p>{c.address}</p><small>{c.accepted_items}</small>{c.contact&&<small>Contact: {c.contact}</small>}</div></div>)}
        </div>
        <div className="panel"><div className="panel-heading"><div><h3>Add a centre</h3><p>New entries are unverified by default.</p></div></div>
          <form className="form" onSubmit={addCentre}><Field label="Centre / pharmacy name"><input required value={centreForm.name} onChange={e=>setCentreForm({...centreForm,name:e.target.value})}/></Field><Field label="Address"><textarea required value={centreForm.address} onChange={e=>setCentreForm({...centreForm,address:e.target.value})}/></Field><Field label="Accepted items / notes"><input value={centreForm.accepted_items} onChange={e=>setCentreForm({...centreForm,accepted_items:e.target.value})}/></Field><Field label="Contact information"><input value={centreForm.contact} onChange={e=>setCentreForm({...centreForm,contact:e.target.value})}/></Field><button className="button primary full">Add unverified centre</button></form>
        </div>
      </section>}

      {tab === 'History' && <section className="page"><div className="panel"><div className="panel-heading"><div><h3>Dose history</h3><p>These records are based on user input, not independently verified.</p></div></div>
        {doses.length===0?<Empty text="No dose records yet. Record a dose from the dashboard."/>:<div className="table-wrap"><table><thead><tr><th>MEDICINE</th><th>SCHEDULED</th><th>STATUS</th><th>RECORDED AT</th></tr></thead><tbody>{doses.map(d=><tr key={d.id}><td><b>{d.medicine_name}</b></td><td>{d.scheduled_date} {d.scheduled_time}</td><td><span className={`status ${d.status==='taken'?'taken':d.status==='missed'?'expired':'planned'}`}>{d.status.toUpperCase()}</span></td><td>{new Date(d.logged_at).toLocaleString()}</td></tr>)}</tbody></table></div>}
        <div className="notice-box">Adherence percentage is a simple summary of recorded dose statuses. It is not a medical assessment.</div>
      </div></section>}

      {tab === 'Care Circle' && <section className="page split-page">
        <div className="panel care-intro"><div className="care-heart">♡</div><h2>Support, with permission.</h2><p>Care Circle is designed for a user who chooses to involve a trusted caregiver. In this prototype, it saves the preference only. It does not send SMS, email, or push alerts.</p><div className="notice-box">Before enabling this for real use, add secure authentication, explicit consent, revocation, and a tested notification service.</div></div>
        <div className="panel"><div className="panel-heading"><div><h3>Care Circle settings</h3><p>You can turn this off at any time.</p></div></div>
          <form className="form" onSubmit={saveCare}><label className="toggle-row"><span><b>Enable Care Circle</b><small>Save an opt-in preference for a trusted caregiver.</small></span><input type="checkbox" checked={!!careForm.enabled} onChange={e=>setCareForm({...careForm,enabled:e.target.checked})}/></label><Field label="Caregiver label (optional)"><input value={careForm.contact_label} onChange={e=>setCareForm({...careForm,contact_label:e.target.value})} placeholder="e.g. Daughter, caregiver"/></Field><button className="button primary full">Save preferences</button></form>
          <div className="impact-line"><span>Current setting</span><b>{care.enabled?'Enabled (preference only)':'Disabled'}</b></div>
        </div>
      </section>}

      <footer className="footer"><span>✚ MediMate 360</span><span>Academic prototype · Not a substitute for professional medical advice</span></footer>
    </main>
  </div>;
}

function Stat({icon,label,value,note}) { return <div className="stat-card"><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-dot"></span></div><div className="stat-value">{value}</div><div className="stat-label">{label}</div><div className="stat-note">{note}</div></div>; }
function Field({label,children}) { return <label className="field"><span>{label}</span>{children}</label>; }
function Empty({text}) { return <div className="empty-state"><div className="empty-icon">✧</div><p>{text}</p></div>; }
