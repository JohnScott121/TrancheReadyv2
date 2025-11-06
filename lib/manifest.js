import crypto from 'crypto';
import nacl from 'tweetnacl';
import { cfg } from './config.js';

export function buildManifest(namedFiles, ruleset) {
  const files = Object.entries(namedFiles).map(([name, buf]) => ({
    name,
    bytes: buf.length,
    sha256: sha256Hex(buf)
  }));

  const manifest = {
    schema: 'trancheready.manifest.v1',
    created_utc: new Date().toISOString(),
    app_version: '1.0.0',
    ruleset_id: ruleset?.id || 'dnfbp-starter',
    hash_algo: 'sha256',
    files,
    sources: ruleset?.sources || {}
  };

  if (cfg.SIGN_PRIVATE_KEY) {
    try {
      const sk = Buffer.from(cfg.SIGN_PRIVATE_KEY, 'base64');
      const message = Buffer.from(JSON.stringify({ files: manifest.files, created_utc: manifest.created_utc, ruleset_id: manifest.ruleset_id }));
      const sig = nacl.sign.detached(message, new Uint8Array(sk));
      manifest.signing = {
        alg: 'ed25519',
        key_id: 'trancheready-prod',
        signature: Buffer.from(sig).toString('base64')
      };
    } catch {
      // intentionally ignore signing errors in starter
    }
  }
  return manifest;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
