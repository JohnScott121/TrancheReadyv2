// Simple memory store with TTL. Swap later for Redis/S3 if needed.
class VerifyStore {
  constructor(){ this.map = new Map(); }
  put(token, zipBuffer, manifest, ttlMin){
    const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000);
    this.map.set(token, { zipBuffer, manifest, expiresAt });
    setTimeout(() => this.map.delete(token), ttlMin * 60 * 1000 + 5000);
  }
  get(token){
    const entry = this.map.get(token);
    if (!entry) return null;
    if (entry.expiresAt < new Date()) { this.map.delete(token); return null; }
    return entry;
  }
}
export const verifyStore = new VerifyStore();
