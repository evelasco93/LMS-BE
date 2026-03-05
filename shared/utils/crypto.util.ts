import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV for GCM
const TAG_LENGTH = 16;

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * @param plaintext - The value to encrypt
 * @param hexKey - 64-character hex string (32 bytes)
 * @returns Base64-encoded string: iv(12 bytes) + tag(16 bytes) + ciphertext
 */
export function encrypt(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypts a value produced by `encrypt`.
 * @param ciphertext - Base64-encoded string from `encrypt`
 * @param hexKey - Same 64-character hex key used during encryption
 * @returns Original plaintext string
 */
export function decrypt(ciphertext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, "hex");
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
