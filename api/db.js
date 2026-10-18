import { sqlClient, json, parseBody } from './_db.js';
import { jwtVerify } from 'jose';
const COOKIE='kozos_naptar_session';
const secret=()=>new TextEncoder().encode(process.env.AUTH_SECRET || process.env.DATABASE_URL || 'development-only-change-this-secret');
const allowed={
  profiles:['id','email','display_name','calendar_id'],
  calendars:['id','name','invite_code','created_by','created_at'],
  events:['id','calendar_id','created_by','title','description','location','start_at','end_at','all_day','color','recurrence','reminder_minutes','created_at','updated_at']
};
async function userFrom(req,sql){
  const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
  if(!raw)return null;
  try{const {payload}=await jwtVerify(decodeURIComponent(raw.slice(COOKIE.length+1)),secret());const rows=await sql`SELECT id,email,display_name,calendar_id FROM profiles WHERE id=${payload.sub} LIMIT 1`;return rows[0]||null}catch{return null}
}
export default async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Csak POST kérés engedélyezett.'});
  try{
    const sql=sqlClient(); const user=await userFrom(req,sql);
    if(!user)return json(res,401,{error:'Jelentkezz be újra.'});
    const b=parseBody(req);
    if(b.action==='rpc'&&b.name==='join_calendar_by_code'){
      const code=String(b.args?.p_code||'').trim().toUpperCase();
      const rows=await sql`SELECT id FROM calendars WHERE upper(invite_code)=${code} LIMIT 1`;
      if(!rows.length)return json(res,200,{data:null});
      const cal=rows[0];
      const count=await sql`SELECT count(*)::int AS n FROM profiles WHERE calendar_id=${cal.id} AND id<>${user.id}`;
      if(count[0].n>=1)return json(res,403,{error:'Ez a közös naptár már két taggal rendelkezik.'});
      await sql`UPDATE profiles SET calendar_id=${cal.id} WHERE id=${user.id}`;
      return json(res,200,{data:cal.id});
    }
    const {table,action,payload,filters=[],sort,returning}=b;
    if(!allowed[table])return json(res,400,{error:'Nem támogatott adattábla.'});
    const cols=allowed[table];
    const safeFilters=filters.filter(([c])=>cols.includes(c));
    const whereSql=safeFilters.map(([c],i)=>`${i?' AND ':''}${c} = $${i+1}`).join('');
    const values=safeFilters.map(([,v])=>v);
    if(table==='profiles'){
      if(action==='select'){
        const rows=await sql`SELECT id,email,display_name,calendar_id FROM profiles WHERE id=${user.id} OR (calendar_id IS NOT NULL AND calendar_id=${user.calendar_id||null}) ORDER BY email`;
        return json(res,200,{data:rows});
      }
      if(action==='upsert' || action==='update'){
        if(payload?.id !== user.id) return json(res,403,{error:'Csak a saját profilodat módosíthatod.'});
        const calendarId=payload.calendar_id ?? null;
        const rows=await sql`UPDATE profiles SET calendar_id=${calendarId}, display_name=COALESCE(${payload.display_name||null},display_name) WHERE id=${user.id} RETURNING id,email,display_name,calendar_id`;
        return json(res,200,{data:rows[0]});
      }
      return json(res,403,{error:'A profil ezen a felületen nem módosítható.'});
    }
    if(action==='select'){
      let rows;
      if(table==='calendars'){
        rows=await sql`SELECT id,name,invite_code,created_by,created_at FROM calendars WHERE created_by=${user.id} OR id=${user.calendar_id||null}`;
      } else {
        rows= user.calendar_id ? await sql`SELECT id,calendar_id,created_by,title,description,location,start_at,end_at,all_day,color,recurrence,reminder_minutes,created_at,updated_at FROM events WHERE calendar_id=${user.calendar_id} ORDER BY start_at` : [];
      }
      if(safeFilters.length) rows=rows.filter(row=>safeFilters.every(([c,v])=>String(row[c])===String(v)));
      if(sort) rows.sort((a,b)=>String(a[sort.column]).localeCompare(String(b[sort.column]))*(sort.ascending===false?-1:1));
      return json(res,200,{data:rows});
    }
    if(table==='calendars'&&action==='insert'){
      const name=String(payload?.name||'A mi naptárunk').slice(0,100);
      const code=String(payload?.invite_code||'').toUpperCase();
      if(!code)return json(res,400,{error:'Hiányzik a meghívókód.'});
      const rows=await sql`INSERT INTO calendars(name,invite_code,created_by) VALUES(${name},${code},${user.id}) RETURNING id,name,invite_code,created_by,created_at`;
      return json(res,201,{data:rows[0]});
    }
    if(table==='events'&&action==='insert'){
      if(!user.calendar_id||payload.calendar_id!==user.calendar_id)return json(res,403,{error:'Nem tartozol ehhez a közös naptárhoz.'});
      const p=payload;
      const rows=await sql`INSERT INTO events(calendar_id,created_by,title,description,location,start_at,end_at,all_day,color,recurrence,reminder_minutes)
      VALUES(${user.calendar_id},${user.id},${p.title},${p.description||''},${p.location||''},${p.start_at},${p.end_at},${!!p.all_day},${p.color||'#3b82f6'},${p.recurrence||'none'},${Number(p.reminder_minutes??15)})
      RETURNING *`;
      return json(res,201,{data:rows[0]});
    }
    if(table==='events'&&action==='update'){
      const id=filters.find(([c])=>c==='id')?.[1];
      if(!id||!user.calendar_id)return json(res,400,{error:'Hiányzó eseményazonosító.'});
      const p=payload||{};
      const rows=await sql`UPDATE events SET title=${p.title},description=${p.description||''},location=${p.location||''},start_at=${p.start_at},end_at=${p.end_at},all_day=${!!p.all_day},color=${p.color||'#3b82f6'},recurrence=${p.recurrence||'none'},reminder_minutes=${Number(p.reminder_minutes??15)},updated_at=now() WHERE id=${id} AND calendar_id=${user.calendar_id} RETURNING *`;
      return rows.length?json(res,200,{data:rows[0]}):json(res,404,{error:'Az esemény nem található.'});
    }
    if(table==='events'&&action==='delete'){
      const id=filters.find(([c])=>c==='id')?.[1];
      const rows=await sql`DELETE FROM events WHERE id=${id} AND calendar_id=${user.calendar_id||null} RETURNING id`;
      return json(res,200,{data:rows});
    }
    return json(res,400,{error:'Nem támogatott művelet.'});
  }catch(e){console.error(e);return json(res,500,{error:e.message||'Adatbázishiba.'})}
}
