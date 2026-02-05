/**
 * Encryption/decryption utilities for LiveSync data.
 * Uses the same algorithms as octagonal-wheels (the official LiveSync encryption module).
 *
 * V2 Encryption format:
 * - Prefix: "%$" indicates V2 encrypted content
 * - Key derivation: PBKDF2-SHA256 (310,000 iterations) + HKDF-SHA256
 * - Cipher: AES-256-GCM with 128-bit auth tag
 */

// Constants matching LiveSync's encryption
const V2_PREFIX = "%$";
const PBKDF2_ITERATIONS = 310000;

/**
 * Derive an encryption key from a passphrase using PBKDF2 + HKDF
 */
async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  info: Uint8Array = new Uint8Array(0)
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // PBKDF2 to derive initial key material
  const pbkdf2Bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passphraseKey,
    256
  );

  // Import as HKDF key for expansion
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    pbkdf2Bits,
    "HKDF",
    false,
    ["deriveBits"]
  );

  // HKDF expand
  const aesKeyBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32), // Zero salt for HKDF
      info: info,
    },
    hkdfKey,
    256
  );

  // Import as AES-GCM key
  return crypto.subtle.importKey("raw", aesKeyBits, "AES-GCM", false, [
    "decrypt",
  ]);
}

/**
 * Decrypt V2 encrypted content.
 * Format: base64(salt[16] + iv[12] + ciphertext + tag[16])
 */
export async function decryptV2(
  encryptedData: string,
  passphrase: string
): Promise<string> {
  if (!encryptedData.startsWith(V2_PREFIX)) {
    throw new Error("Not V2 encrypted data (missing %$ prefix)");
  }

  const base64Data = encryptedData.slice(V2_PREFIX.length);
  const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

  // Extract components
  const salt = binaryData.slice(0, 16);
  const iv = binaryData.slice(16, 28);
  const ciphertextWithTag = binaryData.slice(28);

  // Derive the key
  const key = await deriveKey(passphrase, salt);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
      tagLength: 128,
    },
    key,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Check if data is V2 encrypted
 */
export function isV2Encrypted(data: string): boolean {
  return data.startsWith(V2_PREFIX);
}

/**
 * Decrypt content that may or may not be encrypted.
 * Returns the original string if not encrypted.
 */
export async function decryptContent(
  content: string,
  passphrase: string
): Promise<string> {
  if (!content || !isV2Encrypted(content)) {
    return content;
  }
  return decryptV2(content, passphrase);
}

/**
 * Decrypt a chunk's data field.
 * Handles both V2 encrypted chunks and plaintext (unencrypted) chunks.
 */
export async function decryptChunk(
  data: string,
  passphrase: string
): Promise<string> {
  // If not encrypted, return as-is (older files or pre-E2EE content)
  if (!isV2Encrypted(data)) {
    return data;
  }
  return decryptV2(data, passphrase);
}
