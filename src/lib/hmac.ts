/**
 * Edge + Node compatible HMAC helpers built on Web Crypto.
 * Used for session cookie signing and receipt signature verification, so the
 * middleware (edge runtime) and the server actions share one implementation.
 */

const encoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const rest = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + rest);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function hmacSha256(message: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function verifyHmac(message: string, signature: string, secret: string): Promise<boolean> {
  try {
    const key = await importKey(secret);
    const signatureBytes = base64UrlDecode(signature);
    return await crypto.subtle.verify("HMAC", key, signatureBytes as unknown as BufferSource, encoder.encode(message));
  } catch {
    return false;
  }
}

/** Constant-time string compare for tokens that are already hex/base64. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Short human-readable receipt verification code derived from the signature. */
export function receiptVerificationCode(signature: string): string {
  const cleaned = signature.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8, 12)}`;
}
