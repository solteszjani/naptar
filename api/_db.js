import { neon } from '@neondatabase/serverless';

export function sqlClient() {
  if (!process.env.DATABASE_URL) throw new Error('Hiányzik a DATABASE_URL környezeti változó a Vercel beállításaiból.');
  return neon(process.env.DATABASE_URL);
}
export function json(res, status, body) {
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8').send(JSON.stringify(body));
}
export function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}
