const listeners = new Set();
let currentSession = null;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { data: null, error: { message: data.error || 'Ismeretlen hiba történt.' } };
  return { data: Object.prototype.hasOwnProperty.call(data, 'data') ? data.data : data, error: null };
}
function announce(event, session) {
  currentSession = session;
  for (const cb of listeners) cb(event, session);
}
async function authCall(action, body) {
  const result = await request(`/api/auth/${action}`, {method: body ? 'POST' : 'GET', ...(body ? {body:JSON.stringify(body)} : {})});
  if (!result.error && action !== 'me') announce(action === 'logout' ? 'SIGNED_OUT' : 'SIGNED_IN', result.data?.session || null);
  if (!result.error && action === 'me') currentSession = result.data?.session || null;
  return result;
}
class Query {
  constructor(table) { this.table=table; this.action='select'; this.payload=null; this.filters=[]; this.sort=null; this.returning=false; }
  select() { this.returning=true; return this; }
  eq(column,value) { this.filters.push([column,value]); return this; }
  order(column,opts={}) { this.sort={column,ascending:opts.ascending!==false}; return this; }
  insert(payload) { this.action='insert'; this.payload=payload; this.returning=true; return this; }
  upsert(payload) { this.action='upsert'; this.payload=payload; this.returning=true; return this; }
  update(payload) { this.action='update'; this.payload=payload; this.returning=true; return this; }
  delete() { this.action='delete'; this.returning=true; return this; }
  async maybeSingle() { const r=await this.run(); if(r.error)return r; return {data:Array.isArray(r.data)?(r.data[0]||null):r.data,error:null}; }
  async single() { const r=await this.run(); if(r.error)return r; const data=Array.isArray(r.data)?r.data[0]:r.data; return data?{data,error:null}:{data:null,error:{message:'A kért rekord nem található.'}}; }
  then(resolve,reject) { return this.run().then(resolve,reject); }
  async run() {
    const r=await request('/api/db',{method:'POST',body:JSON.stringify({table:this.table,action:this.action,payload:this.payload,filters:this.filters,sort:this.sort,returning:this.returning})});
    return r;
  }
}
export const supabase = {
  auth: {
    getSession: async () => {
      const r=await authCall('me');
      return {data:{session:r.data?.session||null},error:r.error};
    },
    onAuthStateChange: (_event, cb) => {
      listeners.add(cb);
      return {data:{subscription:{unsubscribe:()=>listeners.delete(cb)}}};
    },
    signInWithPassword: async ({email,password}) => {
      const r=await authCall('login',{email,password});
      return {data:{session:r.data?.session||null},error:r.error};
    },
    signUp: async ({email,password}) => {
      const r=await authCall('register',{email,password});
      return {data:{session:r.data?.session||null,user:r.data?.user||null},error:r.error};
    },
    signOut: async () => authCall('logout',{})
  },
  from: (table) => new Query(table),
  rpc: async (name,args) => request('/api/db',{method:'POST',body:JSON.stringify({action:'rpc',name,args})})
};
export const isConfigured = true;
