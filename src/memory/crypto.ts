import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scryptSync } from 'node:crypto';

/**
 * Vault encryption: AES-256-GCM (authenticated, so tampering is detected), one key per
 * vault derived from the master key with HKDF. The vault name is bound to the ciphertext,
 * so a Work file can't be swapped in as the Personal one.
 */
export interface SealedFile {
  format: 'max-vault';
  v: 1;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
}

/** Any passphrase or random string -> 32-byte master key. */
export function masterKey(secret: string): Buffer {
  return scryptSync(secret, 'max-memory-v2', 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function vaultKey(master: Buffer, vault: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `max-vault:${vault}`, 32));
}

export function seal(key: Buffer, vault: string, plaintext: string): SealedFile {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(vault));
  const data = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return { format: 'max-vault', v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/** Throws if the key is wrong or the file was altered. */
export function open(key: Buffer, vault: string, f: SealedFile): string {
  if (f.format !== 'max-vault' || f.alg !== 'aes-256-gcm') throw new Error('not a Max vault file');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(f.iv, 'base64'));
  d.setAAD(Buffer.from(vault));
  d.setAuthTag(Buffer.from(f.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(f.data, 'base64')), d.final()]).toString('utf8');
}

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}
