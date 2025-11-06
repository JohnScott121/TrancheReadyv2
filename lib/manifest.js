import crypto from 'crypto';
import nacl from 'tweetnacl';
import { cfg } from './config.js';

export function buildManifest(namedFiles, rulesMeta) {
  const files = Object.entries(namedFiles).map(([name, buf]) => ({
    name, bytes: buf.length, sha256: sha256Hex(buf)
  }));
  const manifest = {
    schema: 'trancheready.manifest.v1',
    created_utc: new Date().toISOString(),
    app_version: '1.0.0',
    ruleset_id: rulesMeta?.id || 'dnfbp-starter',
    hash_algo: 'sha256',
    files,
    sources: rulesMeta?.sources || {}
  };

  if (cfg.SIGN_PRIVATE_KEY) {
    try {
      const secretKey = Buffer.from(cfg.SIGN_PRIVATE_KEY, 'base64');
      const message = Buffer.from(JSON.stringify({
        files: manifest.files,
        created_utc: manifest.created_utc,
        ruleset_id: manifest.ruleset_id
      }));
      const sig = nacl.sign.detached(message, new Uint8Array(secretKey));
      manifest.signing = {
        alg: 'ed25519',
        key_id: 'trancheready',
        signature: Buffer.from(sig).toString('base64')
      };
    } catch {
      // ignore signing errors
    }
  }
  return manifest;
}

function sha256Hex(buf){ return crypto.createHash('sha256').update(buf).digest('hex'); }
