export class LimitManager {
  private records = new Map<string,{requests:number; windowStart:number; cooldownUntil:number}>();
  constructor(private maxRequests = Number(process.env.LOCAL_REQUESTS_PER_HOUR || 30), private cooldownMs = Number(process.env.RATE_LIMIT_COOLDOWN_SECONDS || 300)*1000) {}
  private key(user: string,p:string) { return user+':'+p; }
  snapshot(user:string,p:string) { const now=Date.now(); const key=this.key(user,p); let r=this.records.get(key); if(!r || now-r.windowStart>=3600000) { r={requests:0,windowStart:now,cooldownUntil:r?.cooldownUntil || 0}; this.records.set(key,r); } return {remaining:Math.max(0,this.maxRequests-r.requests),max:this.maxRequests,cooldownUntil:r.cooldownUntil>now?new Date(r.cooldownUntil).toISOString():null,resetAt:new Date(r.windowStart+3600000).toISOString()}; }
  available(user:string,p:string) { const s=this.snapshot(user,p); return s.remaining>0 && !s.cooldownUntil; }
  consume(user:string,p:string) { const s=this.snapshot(user,p); if(s.remaining<=0 || s.cooldownUntil) throw new Error('Local limit or cooldown'); this.records.get(this.key(user,p))!.requests++; }
  rateLimited(user:string,p:string) { this.snapshot(user,p); const r=this.records.get(this.key(user,p))!; r.cooldownUntil=Date.now()+this.cooldownMs; }
}
