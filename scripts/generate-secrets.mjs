#!/usr/bin/env node
/**
 * generate-secrets.mjs — prints production-grade random secrets for .env.local.
 * Usage: npm run secrets:generate
 */
import { randomBytes } from "node:crypto";

const sessionSecret = randomBytes(48).toString("base64url");
const receiptSigningKey = randomBytes(48).toString("base64url");

const lines = [
  "# Katalis POS — production secrets (paste into .env.local, never commit)",
  `SESSION_SECRET=${sessionSecret}`,
  `RECEIPT_SIGNING_KEY=${receiptSigningKey}`,
];

console.log(lines.join("\n"));
