import crypto from 'crypto';
import nacl from 'tweetnacl';

export function buildManifest(namedFiles){
  const files = Object.entries(namedFiles).map(([name, buf]) => ({
    name, bytes: buf.length, sha256: sha256Hex(buf)
  }));
  const manifest = {
    schema: 'trancheready.manifest.v1',
    created_utc: new Date().toISOString(),
    app_version: '1.0.0-starter',
    ruleset_id: 'dnfbp-starter',
    hash_algo: 'sha256',
    files
  };

  const privB64 = process.env.SIGN_PRIVATE_KEY || '';
  if (privB64){
    try{
      const secretKey = Buffer.from(privB64, 'base64');
      const message = Buffer.from(JSON.stringify({ files: manifest.files, created_utc: manifest.created_utc }));
      const sig = nacl.sign.detached(message, new Uint8Array(secretKey));
      manifest.signing = {
        alg: 'ed25519',
        key_id: 'trancheready-starter',
        signature: Buffer.from(sig).toString('base64')
      };
    }catch(e){
      // ignore signing errors in starter
    }
  }
  return manifest;
}

function sha256Hex(buf){ return crypto.createHash('sha256').update(buf).digest('hex'); }
