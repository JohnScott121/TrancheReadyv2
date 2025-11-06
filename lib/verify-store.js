// Memory store with TTL (sufficient for starter). Swap to Redis/S3 later if needed.
class VerifyStore {
  constructor() {
    this.map = new Map(); // token -> { zipBuffer, manifest, expiresAt }
  }
  put(token, zipBuffer, manifest, ttlMinutes = 60) {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    this.map.set(token, { zipBuffer, manifest, expiresAt });
    setTimeout(() => this.map.delete(token), ttlMinutes * 60 * 1000 + 5000);
  }
  get(token) {
    const entry = this.map.get(token);
    if (!entry) return null;
    if (entry.expiresAt < new Date()) {
      this.map.delete(token);
      return null;
    }
    return entry;
  }
}
export const verifyStore = new VerifyStore();
