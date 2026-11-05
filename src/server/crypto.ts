import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { verifyHmac } from "@/lib/hmac";
import { env } from "@/server/env";

/**
 * Password / PIN hashing.
 * Format: scrypt$N$r$p$saltHex$hashHex — self-describing so parameters can be
 * raised later without invalidating existing hashes.
 */

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LEN = 32;

export function hashSecret(plain: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(plain.normalize("NFKC"), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifySecret(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = scryptSync(plain.normalize("NFKC"), salt, expected.length, {
      N: Number(nRaw),
      r: Number(rRaw),
      p: Number(pRaw),
      maxmem: 64 * 1024 * 1024,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function hashPassword(plain: string): string {
  return hashSecret(plain);
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  return verifySecret(plain, stored);
}

/** Supervisor PIN is always 6 digits; hashed with the same scrypt envelope. */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{6}$/.test(pin.trim());
}

export function hashPin(pin: string): string {
  return hashSecret(pin.trim());
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!isValidPinFormat(pin)) return false;
  return verifySecret(pin.trim(), stored);
}

/**
 * Receipt integrity signature: HMAC over the immutable financial fingerprint.
 * Any later tampering with the stored totals breaks verification.
 */
export async function signReceipt(payload: {
  receiptNumber: string;
  createdAt: string;
  grandTotal: number | string;
  orderId: string;
}): Promise<string> {
  const message = [
    payload.orderId,
    payload.receiptNumber,
    payload.createdAt,
    String(Math.round(Number(payload.grandTotal))),
  ].join("|");
  const { hmacSha256 } = await import("@/lib/hmac");
  return hmacSha256(message, env.receiptSigningKey);
}

export async function verifyReceiptSignature(payload: {
  receiptNumber: string;
  createdAt: string;
  grandTotal: number | string;
  orderId: string;
  signature: string | null | undefined;
}): Promise<boolean> {
  if (!payload.signature) return false;
  const message = [
    payload.orderId,
    payload.receiptNumber,
    payload.createdAt,
    String(Math.round(Number(payload.grandTotal))),
  ].join("|");
  return verifyHmac(message, payload.signature, env.receiptSigningKey);
}
