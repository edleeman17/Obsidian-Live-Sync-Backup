/**
 * Encryption/decryption utilities for LiveSync data.
 * Uses the same algorithms as octagonal-wheels (the official LiveSync encryption module).
 *
 * V2 Encryption format:
 * - Prefix: "%" indicates V2 encrypted content
 * - Format: %[32-char hex IV][32-char hex salt][base64 encrypted data]
 * - Key derivation: PBKDF2-SHA256 (310,000 iterations) + HKDF-SHA256
 * - Cipher: AES-256-GCM with 128-bit auth tag
 */

// Constants matching LiveSync's encryption
const V2_PREFIX = "%=";
const PBKDF2_ITERATIONS = 310000;

// Global PBKDF2 salt - set once from CouchDB sync parameters
let globalPBKDF2Salt: Uint8Array | null = null;

// Cached HKDF master key (derived from PBKDF2) - avoids expensive recomputation
let cachedHKDFKey: CryptoKey | null = null;
let cachedPassphrase: string | null = null;

/**
 * Set the PBKDF2 salt for decryption
 */
export function setPBKDF2Salt(salt: Uint8Array): void {
  globalPBKDF2Salt = salt;
  // Clear cache when salt changes
  cachedHKDFKey = null;
  cachedPassphrase = null;
}

/**
 * Get or create the HKDF master key (cached after first derivation)
 * This is the expensive PBKDF2 operation - only done once
 */
async function getHKDFMasterKey(passphrase: string): Promise<CryptoKey> {
  // Return cached key if passphrase matches
  if (cachedHKDFKey && cachedPassphrase === passphrase) {
    return cachedHKDFKey;
  }

  if (!globalPBKDF2Salt) {
    throw new Error("PBKDF2 salt not set. Call setPBKDF2Salt first.");
  }

  console.log("Deriving master key (this only happens once)...");
  const encoder = new TextEncoder();

  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // PBKDF2 to derive initial key material (SLOW - 310k iterations)
  const pbkdf2Bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: globalPBKDF2Salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passphraseKey,
    256
  );

  // Import as HKDF key for expansion
  cachedHKDFKey = await crypto.subtle.importKey(
    "raw",
    pbkdf2Bits,
    "HKDF",
    false,
    ["deriveBits"]
  );
  cachedPassphrase = passphrase;

  console.log("Master key derived and cached");
  return cachedHKDFKey;
}

/**
 * Derive an AES key for a specific chunk using HKDF (fast - uses cached master key)
 */
async function deriveChunkKey(
  passphrase: string,
  hkdfSalt: Uint8Array
): Promise<CryptoKey> {
  const hkdfKey = await getHKDFMasterKey(passphrase);

  // HKDF expand (FAST - no iterations)
  const aesKeyBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: hkdfSalt,
      info: new Uint8Array(0),
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
 * Convert hex string to Uint8Array
 */
function hexStringToUint8Array(hexString: string): Uint8Array {
  const bytes = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < hexString.length; i += 2) {
    bytes[i / 2] = parseInt(hexString.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Decrypt HKDF encrypted content.
 * Format: %=[base64(iv[12] + hkdfSalt[32] + ciphertext + tag[16])]
 */
export async function decryptV2(
  encryptedData: string,
  passphrase: string
): Promise<string> {
  if (!encryptedData.startsWith(V2_PREFIX)) {
    throw new Error("Not V2 encrypted data (missing %= prefix)");
  }

  // Decode the base64 data after the %= prefix
  const base64Data = encryptedData.slice(V2_PREFIX.length);
  const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

  // Extract components: iv(12) + hkdfSalt(32) + ciphertext + tag(16)
  const iv = binaryData.slice(0, 12);
  const hkdfSalt = binaryData.slice(12, 44);
  const ciphertextWithTag = binaryData.slice(44);

  // Derive the chunk key using cached master key + HKDF
  const key = await deriveChunkKey(passphrase, hkdfSalt);

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
