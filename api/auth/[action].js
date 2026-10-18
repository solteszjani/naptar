import { sqlClient, json, parseBody } from '../_db.js';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
const COOKIE='kozos_naptar_session';
const secret=()=>new TextEncoder().encode(process.env.AUTH_SECRET || process.env.DATABASE_URL || 'development-only-change-this-secret');
const cookieOpts='Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
function setCookie(res,value){res.setHeader('Set-Cookie',`${COOKIE}=${value}; ${cookieOpts}`)}
function clearCookie(res){res.setHeader('Set-Cookie',`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`)}
async function token(user){return new SignJWT({email:user.email}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setIssuedAt().setExpirationTime('30d').sign(secret())}
async function getUser(req,sql){
  const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
  if(!raw)return null;
  try {
    const {payload}=await jwtVerify(decodeURIComponent(raw.slice(COOKIE.length+1)),secret());
    const rows=await sql`SELECT id,email,display_name,calendar_id FROM profiles WHERE id=${payload.sub} LIMIT 1`;
    return rows[0]||null;
  } catch{return null}
}
export default async function handler(req,res){
  const action=(req.query?.action||'').toString();
  if(req.method==='OPTIONS'){res.status(204).end();return}
  try{
    const sql=sqlClient();
    if(action==='register'&&req.method==='POST'){
      const {email,password}=parseBody(req); const normalized=String(email||'').trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)||String(password||'').length<6)return json(res,400,{error:'Adj meg érvényes e-mail-címet és legalább 6 karakteres jelszót.'});
      const existing=await sql`SELECT id FROM profiles WHERE lower(email)=lower(${normalized}) LIMIT 1`;
      if(existing.length)return json(res,409,{error:'Ezzel az e-mail-címmel már van fiók.'});
      const id=crypto.randomUUID(); const hash=await bcrypt.hash(password,12);
      const rows=await sql`INSERT INTO profiles (id,email,display_name,password_hash) VALUES (${id},${normalized},${normalized.split('@')[0]},${hash}) RETURNING id,email,display_name,calendar_id`;
      const user=rows[0]; setCookie(res,await token(user)); return json(res,201,{session:{user},user});
    }
    if(action==='login'&&req.method==='POST'){
      const {email,password}=parseBody(req); const normalized=String(email||'').trim().toLowerCase();
      const rows=await sql`SELECT id,email,display_name,calendar_id,password_hash FROM profiles WHERE lower(email)=lower(${normalized}) LIMIT 1`;
      if(!rows.length||!await bcrypt.compare(String(password||''),rows[0].password_hash))return json(res,401,{error:'Hibás e-mail-cím vagy jelszó.'});
      const {password_hash,...user}=rows[0];setCookie(res,await token(user));return json(res,200,{session:{user}});
    }
    if(action==='me'&&req.method==='GET'){
      const user=await getUser(req,sql);return json(res,200,{session:user?{user}:null});
    }
    if(action==='logout'&&req.method==='POST'){clearCookie(res);return json(res,200,{ok:true,session:null})}
    return json(res,404,{error:'Ismeretlen hitelesítési művelet.'});
  }catch(e){console.error(e);return json(res,500,{error:e.message||'Szerverhiba.'})}
}
