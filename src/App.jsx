import React, { useEffect, useMemo, useState } from 'react';
import {
  addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isSameDay, isToday, parseISO,
  addDays, subDays, startOfDay, endOfDay
} from 'date-fns';
import { hu } from 'date-fns/locale';
import {
  ChevronLeft, ChevronRight, Plus, CalendarDays, Clock3, MapPin, Users,
  LogOut, Settings, Search, X, Trash2, Pencil, Check, Link2, Copy, Heart,
  List, Calendar as CalendarIcon, RefreshCw
} from 'lucide-react';
import { isConfigured, supabase } from './supabase.js';

const COLORS = [
  {name:'Kék',value:'#3b82f6'}, {name:'Lila',value:'#8b5cf6'},
  {name:'Rózsaszín',value:'#ec4899'}, {name:'Zöld',value:'#10b981'},
  {name:'Narancs',value:'#f59e0b'}, {name:'Piros',value:'#ef4444'}
];
const blankEvent = (date = new Date()) => ({
  title:'', description:'', location:'', start_at:format(date,'yyyy-MM-dd')+'T09:00',
  end_at:format(date,'yyyy-MM-dd')+'T10:00', color:'#3b82f6', all_day:false,
  recurrence:'none', reminder_minutes:15
});
const fmt = (date, pattern) => format(date, pattern, {locale:hu});
const time = (value) => fmt(parseISO(value), 'HH:mm');

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [authMessage, setAuthMessage] = useState('');
  const [profile, setProfile] = useState(null);
  const [events, setEvents] = useState([]);
  const [members, setMembers] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('month');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [draft, setDraft] = useState(blankEvent());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [partnerEmail, setPartnerEmail] = useState('');

  useEffect(() => {
    if (!isConfigured) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({data}) => { setSession(data.session); setAuthLoading(false); });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next); setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  async function loadData() {
    if (!session) return;
    const {data: prof} = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    setProfile(prof);
    if (prof?.calendar_id) {
      const [{data: evs}, {data: mems}] = await Promise.all([
        supabase.from('events').select('*').eq('calendar_id', prof.calendar_id).order('start_at'),
        supabase.from('profiles').select('id,email,display_name').eq('calendar_id', prof.calendar_id)
      ]);
      setEvents(evs || []); setMembers(mems || []);
    } else {
      setEvents([]); setMembers([]);
    }
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function authenticate(e) {
    e.preventDefault(); setAuthMessage('');
    const result = authMode === 'login'
      ? await supabase.auth.signInWithPassword({email, password})
      : await supabase.auth.signUp({email, password, options:{emailRedirectTo:window.location.origin}});
    if (result.error) setAuthMessage(result.error.message);
    else if (authMode === 'signup' && !result.data.session) setAuthMessage('Ellenőrizd az e-mail-fiókodat a regisztráció megerősítéséhez.');
  }

  async function createCalendar() {
    const name = prompt('Mi legyen a közös naptár neve?', 'A mi naptárunk');
    if (!name?.trim()) return;
    const code = crypto.randomUUID().replaceAll('-','').slice(0,8).toUpperCase();
    const {data: cal, error} = await supabase.from('calendars').insert({name:name.trim(), invite_code:code, created_by:session.user.id}).select().single();
    if (error) return setToast('Nem sikerült létrehozni: '+error.message);
    const {error: pError} = await supabase.from('profiles').upsert({id:session.user.id,email:session.user.email,display_name:session.user.email.split('@')[0],calendar_id:cal.id});
    if (pError) return setToast('Naptár létrejött, de a profil mentése nem sikerült.');
    await loadData(); setToast('Közös naptár létrehozva.');
  }

  async function joinCalendar() {
    if (!joinCode.trim()) return;
    const {data, error} = await supabase.rpc('join_calendar_by_code', {p_code:joinCode.trim().toUpperCase()});
    if (error) return setToast('Nem sikerült csatlakozni: '+error.message);
    if (!data) return setToast('Nem található ilyen meghívókód.');
    await loadData(); setJoinCode(''); setToast('Sikeresen csatlakoztál a közös naptárhoz.');
  }

  async function saveEvent(e) {
    e.preventDefault();
    if (!profile?.calendar_id) return;
    setSaving(true);
    const payload = {
      ...draft, calendar_id:profile.calendar_id, created_by:session.user.id,
      start_at: new Date(draft.start_at).toISOString(),
      end_at: new Date(draft.end_at).toISOString()
    };
    let result;
    if (draft.id) result = await supabase.from('events').update(payload).eq('id',draft.id).select().single();
    else result = await supabase.from('events').insert(payload).select().single();
    setSaving(false);
    if (result.error) return setToast('Mentési hiba: '+result.error.message);
    setEvents(old => draft.id ? old.map(x => x.id === draft.id ? result.data : x) : [...old,result.data].sort((a,b)=>a.start_at.localeCompare(b.start_at)));
    setModal(null); setToast(draft.id ? 'Program frissítve.' : 'Program hozzáadva.');
  }

  async function deleteEvent(id) {
    if (!confirm('Biztosan törlöd ezt az eseményt?')) return;
    const {error} = await supabase.from('events').delete().eq('id',id);
    if (error) return setToast('Törlési hiba: '+error.message);
    setEvents(old=>old.filter(e=>e.id!==id)); setModal(null); setToast('Program törölve.');
  }

  function openNew(date = currentDate) { setDraft(blankEvent(date)); setModal({type:'edit'}); }
  function openEdit(event) {
    setDraft({...event, start_at:format(parseISO(event.start_at),'yyyy-MM-dd\\'T\\'HH:mm'), end_at:format(parseISO(event.end_at),'yyyy-MM-dd\\'T\\'HH:mm')});
    setModal({type:'edit'});
  }

  const visibleEvents = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('hu');
    return events.filter(e => !q || [e.title,e.description,e.location].some(v=>v?.toLocaleLowerCase('hu').includes(q)));
  },[events,search]);

  const calendarDays = useMemo(() => eachDayOfInterval({
    start:startOfWeek(startOfMonth(currentDate),{weekStartsOn:1}),
    end:endOfWeek(endOfMonth(currentDate),{weekStartsOn:1})
  }),[currentDate]);

  function eventsForDay(day) {
    return visibleEvents.filter(e => isSameDay(parseISO(e.start_at),day)).sort((a,b)=>a.start_at.localeCompare(b.start_at));
  }
  const dayEvents = visibleEvents.filter(e => {
    const d=parseISO(e.start_at);
    if(view==='day') return isSameDay(d,currentDate);
    if(view==='week') return d>=startOfWeek(currentDate,{weekStartsOn:1}) && d<=endOfWeek(currentDate,{weekStartsOn:1});
    return d>=startOfMonth(currentDate) && d<=endOfMonth(currentDate);
  }).sort((a,b)=>a.start_at.localeCompare(b.start_at));

  if (!isConfigured) return <SetupScreen />;
  if (authLoading) return <div className="loading"><div className="spinner"/>Betöltés…</div>;
  if (!session) return <main className="auth-shell dark-theme"><div className="auth-card">
    <div className="brand-mark"><Heart size={26}/></div><p className="eyebrow">KETTŐTÖKNEK KÉSZÜLT</p>
    <h1>A mi naptárunk</h1><p className="muted">Programok, fontos napok és közös tervek — egy helyen.</p>
    <form onSubmit={authenticate} className="auth-form">
      <label>E-mail-cím<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="te@email.hu"/></label>
      <label>Jelszó<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} placeholder="Legalább 6 karakter"/></label>
      {authMessage && <div className="notice">{authMessage}</div>}
      <button className="primary full" type="submit">{authMode==='login'?'Bejelentkezés':'Regisztráció'}</button>
    </form>
    <button className="text-button" onClick={()=>{setAuthMode(authMode==='login'?'signup':'login');setAuthMessage('')}}>{authMode==='login'?'Még nincs fiókod? Regisztrálj':'Van már fiókod? Jelentkezz be'}</button>
  </div></main>;

  const calendarName = profile?.calendar_id ? 'Közös naptár' : 'Saját fiók';
  return <div className="app-shell dark-theme">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark small"><Heart size={20}/></div><div><strong>A mi naptárunk</strong><span>közös tervezés</span></div></div>
      <button className="primary create-btn" onClick={()=>openNew()}><Plus size={18}/> Új program</button>
      <div className="mini-month">
        <div className="mini-head"><strong>{fmt(currentDate,'yyyy. MMMM')}</strong><div><button className="icon-btn" onClick={()=>setCurrentDate(subMonths(currentDate,1))}><ChevronLeft size={16}/></button><button className="icon-btn" onClick={()=>setCurrentDate(addMonths(currentDate,1))}><ChevronRight size={16}/></button></div></div>
        <div className="mini-grid">{['H','K','Sze','Cs','P','Szo','V'].map(d=><span className="mini-label" key={d}>{d}</span>)}{calendarDays.map(d=><button key={d.toISOString()} className={`mini-day ${!isSameMonth(d,currentDate)?'dim':''} ${isSameDay(d,currentDate)?'selected':''} ${isToday(d)?'today':''}`} onClick={()=>{setCurrentDate(d);setView('day')}}>{format(d,'d')}</button>)}</div>
      </div>
      <div className="side-section"><p className="side-label">NÉZETEK</p>
        <button className={`nav-item ${view==='month'?'active':''}`} onClick={()=>setView('month')}><CalendarDays size={18}/> Hónap</button>
        <button className={`nav-item ${view==='week'?'active':''}`} onClick={()=>setView('week')}><CalendarIcon size={18}/> Hét</button>
        <button className={`nav-item ${view==='day'?'active':''}`} onClick={()=>setView('day')}><Clock3 size={18}/> Nap</button>
        <button className={`nav-item ${view==='list'?'active':''}`} onClick={()=>setView('list')}><List size={18}/> Napirend</button>
      </div>
      <div className="side-bottom">
        <div className="members"><div className="avatar">{(session.user.email||'T').slice(0,1).toUpperCase()}</div><div className="member-text"><strong>{profile?.display_name||session.user.email.split('@')[0]}</strong><span>{session.user.email}</span></div></div>
        {members.filter(m=>m.id!==session.user.id).map(m=><div className="members" key={m.id}><div className="avatar partner">{(m.display_name||m.email||'P').slice(0,1).toUpperCase()}</div><div className="member-text"><strong>{m.display_name||'Párod'}</strong><span>{m.email}</span></div></div>)}
        <button className="nav-item logout" onClick={()=>supabase.auth.signOut()}><LogOut size={17}/> Kijelentkezés</button>
      </div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="mobile-brand"><Heart size={20}/> A mi naptárunk</div>
        <div className="date-heading"><h1>{view==='day'?fmt(currentDate,'yyyy. MMMM d.') : view==='week'?`${fmt(startOfWeek(currentDate,{weekStartsOn:1}),'MMM d.')} – ${fmt(endOfWeek(currentDate,{weekStartsOn:1}),'MMM d.')}`:fmt(currentDate,'yyyy. MMMM')}</h1><div className="date-actions"><button className="outline" onClick={()=>setCurrentDate(new Date())}>Ma</button><button className="icon-btn large" onClick={()=>setCurrentDate(view==='day'?subDays(currentDate,1):subMonths(currentDate,1))}><ChevronLeft/></button><button className="icon-btn large" onClick={()=>setCurrentDate(view==='day'?addDays(currentDate,1):addMonths(currentDate,1))}><ChevronRight/></button></div></div>
        <div className="top-actions"><div className="searchbox"><Search size={17}/><input placeholder="Keresés a programok között…" value={search} onChange={e=>setSearch(e.target.value)}/></div><button className="primary top-add" onClick={()=>openNew()}><Plus size={17}/> Program</button></div>
      </header>
      {!profile?.calendar_id ? <section className="setup-card"><div className="setup-icon"><Users size={24}/></div><h2>Hozzátok létre a közös naptárat</h2><p>Az egyikőtök hozzon létre egy naptárat, a másik pedig a meghívókóddal csatlakozhat. Ezután mindketten ugyanazokat az eseményeket látjátok és szerkeszthetitek.</p><div className="setup-actions"><button className="primary" onClick={createCalendar}><Plus size={17}/> Közös naptár létrehozása</button><div className="join-form"><input value={joinCode} onChange={e=>setJoinCode(e.target.value)} placeholder="Meghívókód" maxLength={12}/><button className="outline" onClick={joinCalendar}>Csatlakozás</button></div></div></section>
      : <>{view==='month' ? <section className="month-view"><div className="weekdays">{['Hétfő','Kedd','Szerda','Csütörtök','Péntek','Szombat','Vasárnap'].map(x=><div key={x}>{x}</div>)}</div><div className="month-grid">{calendarDays.map(day=>{const dayEvs=eventsForDay(day);return <div key={day.toISOString()} className={`day-cell ${!isSameMonth(day,currentDate)?'outside':''} ${isToday(day)?'is-today':''}`} onDoubleClick={()=>openNew(day)}><button className={`day-number ${isToday(day)?'today-number':''}`} onClick={()=>{setCurrentDate(day);setView('day')}}>{format(day,'d')}</button><div className="day-events">{dayEvs.slice(0,3).map(ev=><button key={ev.id} className="event-chip" style={{'--event-color':ev.color||'#3b82f6'}} onClick={e=>{e.stopPropagation();openEdit(ev)}}><span className="event-time">{ev.all_day?'':time(ev.start_at)}</span><span className="event-title">{ev.title}</span></button>)}{dayEvs.length>3&&<button className="more-events" onClick={()=>{setCurrentDate(day);setView('day')}}>+{dayEvs.length-3} további</button>}</div><button className="add-day" title="Program hozzáadása" onClick={()=>openNew(day)}><Plus size={14}/></button></div>})}</div></section>
      : <section className="agenda-view">{dayEvents.length===0?<div className="empty-state"><div className="empty-icon"><CalendarDays size={28}/></div><h3>Nincs program ebben az időszakban</h3><p>Adj hozzá egy programot, hogy mindketten lássátok.</p><button className="primary" onClick={()=>openNew(currentDate)}><Plus size={17}/> Új program</button></div>:dayEvents.map(ev=><button key={ev.id} className="agenda-item" onClick={()=>openEdit(ev)}><div className="agenda-date"><strong>{fmt(parseISO(ev.start_at),'d')}</strong><span>{fmt(parseISO(ev.start_at),'EEE')}</span></div><div className="agenda-line" style={{background:ev.color||'#3b82f6'}}/><div className="agenda-content"><div className="agenda-title-row"><h3>{ev.title}</h3><span className="agenda-time">{ev.all_day?'Egész nap':`${time(ev.start_at)} – ${time(ev.end_at)}`}</span></div>{ev.description&&<p>{ev.description}</p>}<div className="agenda-meta">{ev.location&&<span><MapPin size={14}/>{ev.location}</span>}{ev.recurrence!=='none'&&<span><RefreshCw size={14}/>{ev.recurrence==='daily'?'Naponta':ev.recurrence==='weekly'?'Hetente':'Havonta'}</span>}</div></div><Pencil className="agenda-edit" size={16}/></button>)}</section>}</>}
      <footer className="footer-note"><Heart size={13}/> Közös tervek, közös emlékek.</footer>
    </main>
    {modal?.type==='edit'&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null)}}><section className="event-modal"><header className="modal-header"><div><p className="eyebrow">{draft.id?'ESEMÉNY SZERKESZTÉSE':'ÚJ PROGRAM'}</p><h2>{draft.id?'Program módosítása':'Mit terveztetek?'}</h2></div><button className="icon-btn" onClick={()=>setModal(null)}><X/></button></header><form onSubmit={saveEvent} className="event-form">
      <label className="title-input"><input autoFocus value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} required placeholder="Program neve" maxLength={120}/></label>
      <div className="form-row"><label><span><Clock3 size={15}/> Kezdés</span><input type="datetime-local" value={draft.start_at} onChange={e=>setDraft({...draft,start_at:e.target.value})} required/></label><label><span><Clock3 size={15}/> Befejezés</span><input type="datetime-local" value={draft.end_at} onChange={e=>setDraft({...draft,end_at:e.target.value})} required/></label></div>
      <label className="checkline"><input type="checkbox" checked={draft.all_day} onChange={e=>setDraft({...draft,all_day:e.target.checked})}/> Egész napos program</label>
      <label><span><MapPin size={15}/> Helyszín</span><input value={draft.location||''} onChange={e=>setDraft({...draft,location:e.target.value})} placeholder="Hol találkoztok?"/></label>
      <label><span>Leírás / megjegyzés</span><textarea rows="3" value={draft.description||''} onChange={e=>setDraft({...draft,description:e.target.value})} placeholder="További részletek…"/></label>
      <div className="form-row"><label><span>Ismétlődés</span><select value={draft.recurrence||'none'} onChange={e=>setDraft({...draft,recurrence:e.target.value})}><option value="none">Nincs</option><option value="daily">Naponta</option><option value="weekly">Hetente</option><option value="monthly">Havonta</option></select></label><label><span>Emlékeztető</span><select value={draft.reminder_minutes??15} onChange={e=>setDraft({...draft,reminder_minutes:Number(e.target.value)})}><option value="0">Nincs</option><option value="5">5 perccel előtte</option><option value="15">15 perccel előtte</option><option value="30">30 perccel előtte</option><option value="60">1 órával előtte</option><option value="1440">1 nappal előtte</option></select></label></div>
      <div className="color-field"><span>Szín</span><div className="color-options">{COLORS.map(c=><button type="button" title={c.name} key={c.value} className={`color-dot ${draft.color===c.value?'chosen':''}`} style={{background:c.value}} onClick={()=>setDraft({...draft,color:c.value})}>{draft.color===c.value&&<Check size={14}/>}</button>)}</div></div>
      <div className="modal-footer">{draft.id&&<button type="button" className="danger-button" onClick={()=>deleteEvent(draft.id)}><Trash2 size={16}/> Törlés</button>}<div className="footer-spacer"/><button type="button" className="outline" onClick={()=>setModal(null)}>Mégse</button><button className="primary" type="submit" disabled={saving}>{saving?'Mentés…':'Mentés'}</button></div>
    </form></section></div>}
    {toast&&<div className="toast">{toast}</div>}
  </div>;
}

function SetupScreen() {
  return <main className="setup-screen dark-theme"><div className="setup-card wide"><div className="brand-mark"><Heart size={26}/></div><h1>A mi naptárunk</h1><h2>Az adatbázis még nincs összekötve</h2><p>A projektet egy közös Supabase-adatbázishoz kell kapcsolni. Kövesd a csomagban lévő <b>README.md</b> útmutatót, futtasd le az SQL-sémát, majd add meg a környezeti változókat.</p><div className="code-hint">VITE_SUPABASE_URL<br/>VITE_SUPABASE_ANON_KEY</div></div></main>;
}
