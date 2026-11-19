/** Bytes in base64url without padding, as Web Push writes keys. */
export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** A new VAPID key pair as the Worker's secrets take it: the public key, raw, and the private key as the `d` of its JWK, both in base64url. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicKey = toBase64Url(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
  const { d } = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  // Never taken: an exported private key always has its `d`. Only there for the type.
  /* v8 ignore next 3 */
  if (d === undefined) {
    throw new Error('The private key was exported without its secret');
  }
  return { publicKey, privateKey: d };
}
