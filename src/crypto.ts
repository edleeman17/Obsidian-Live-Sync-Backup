/**
 * Encryption/decryption utilities for LiveSync data.
 * Uses the same algorithms as octagonal-wheels (the official LiveSync encryption module).
 *
 * Encryption formats:
 *
 * - HKDF format (%=): %=[base64(iv[12] + hkdfSalt[32] + ciphertext + tag)]
 *   Key = HKDF(PBKDF2(passphrase, globalSalt, 310000), hkdfSalt)
 *
 * - V2 legacy format (%): %[hex_iv (32 chars)][hex_salt (32 chars)][base64_ciphertext]
 *   Key = PBKDF2(SHA256(passphrase), salt, 100000)
 *   IV: 16 bytes, Salt: 16 bytes
 *
 * - Cipher: AES-256-GCM with 128-bit auth tag
 */

// Constants matching LiveSync's encryption
const HKDF_PREFIX = "%=";      // HKDF format for chunked files
const INLINE_PREFIX = "%";      // Inline format (same encryption, different prefix)
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
 * Used for %= prefix (HKDF format)
 */
async function deriveChunkKeyHKDF(
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
 * Derive an AES key for V2 legacy format (% prefix)
 * Uses SHA-256(passphrase) as key material for PBKDF2 with 100,000 iterations
 */
const v2LegacyKeyCache = new Map<string, CryptoKey>();
const V2_LEGACY_ITERATIONS = 100000;

async function deriveV2LegacyKey(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  // Create cache key from salt
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const cacheKey = `${passphrase}:${saltHex}`;

  if (v2LegacyKeyCache.has(cacheKey)) {
    return v2LegacyKeyCache.get(cacheKey)!;
  }

  const encoder = new TextEncoder();

  // First, hash the passphrase with SHA-256
  const passphraseHash = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(passphrase)
  );

  // Import the hash as PBKDF2 key material
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    passphraseHash,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // PBKDF2 with 100k iterations
  const keyBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: V2_LEGACY_ITERATIONS,
      hash: "SHA-256",
    },
    passphraseKey,
    256
  );

  const aesKey = await crypto.subtle.importKey("raw", keyBits, "AES-GCM", false, [
    "decrypt",
  ]);

  v2LegacyKeyCache.set(cacheKey, aesKey);
  return aesKey;
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
 * Decrypt HKDF encrypted content (%=  prefix)
 * Format: %=[base64(iv[12] + hkdfSalt[32] + ciphertext + tag)]
 */
async function decryptHKDF(
  encryptedData: string,
  passphrase: string
): Promise<string> {
  // Remove %= prefix
  const base64Part = encryptedData.slice(HKDF_PREFIX.length).replace(/=+$/, "");
  const paddingNeeded = (4 - (base64Part.length % 4)) % 4;
  const paddedBase64 = base64Part + "=".repeat(paddingNeeded);

  const binaryData = Uint8Array.from(atob(paddedBase64), (c) => c.charCodeAt(0));

  // Minimum size: iv(12) + salt(32) + tag(16) = 60 bytes
  if (binaryData.length < 60) {
    throw new Error(`Encrypted data too short: ${binaryData.length} bytes`);
  }

  // Extract components: iv(12) + hkdfSalt(32) + ciphertext + tag
  const iv = binaryData.slice(0, 12);
  const hkdfSalt = binaryData.slice(12, 44);
  const ciphertextWithTag = binaryData.slice(44);

  // Derive key using HKDF
  const key = await deriveChunkKeyHKDF(passphrase, hkdfSalt);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv, tagLength: 128 },
    key,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Decrypt V2 legacy encrypted content (% prefix)
 * Format: %[hex_iv (32 chars)][hex_salt (32 chars)][base64_ciphertext]
 */
async function decryptV2Legacy(
  encryptedData: string,
  passphrase: string
): Promise<string> {
  // Remove % prefix
  const data = encryptedData.slice(INLINE_PREFIX.length);

  // Parse: 32 hex chars IV + 32 hex chars salt + base64 ciphertext
  if (data.length < 65) { // 32 + 32 + at least 1 char of base64
    throw new Error(`V2 legacy data too short: ${data.length} chars`);
  }

  const ivHex = data.slice(0, 32);
  const saltHex = data.slice(32, 64);
  const base64Ciphertext = data.slice(64);

  // Convert hex to bytes
  const iv = hexStringToUint8Array(ivHex);
  const salt = hexStringToUint8Array(saltHex);

  // Decode base64 ciphertext (with padding fix)
  let paddedBase64 = base64Ciphertext.replace(/=+$/, "");
  const paddingNeeded = (4 - (paddedBase64.length % 4)) % 4;
  paddedBase64 += "=".repeat(paddingNeeded);

  const ciphertextWithTag = Uint8Array.from(atob(paddedBase64), (c) => c.charCodeAt(0));

  // Derive key using V2 legacy method
  const key = await deriveV2LegacyKey(passphrase, salt);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv, tagLength: 128 },
    key,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Decrypt encrypted content - auto-detects format from prefix
 *
 * For % prefix: Try HKDF format first (same as %=), then V2 legacy format
 * Some % prefixed files use the same format as %= but without the = character
 */
export async function decryptV2(
  encryptedData: string,
  passphrase: string
): Promise<string> {
  if (encryptedData.startsWith(HKDF_PREFIX)) {
    return decryptHKDF(encryptedData, passphrase);
  } else if (encryptedData.startsWith(INLINE_PREFIX)) {
    // For % prefix, data could be either:
    // 1. HKDF format (base64 with 12-byte IV, 32-byte salt)
    // 2. V2 legacy format (hex IV + hex salt + base64 ciphertext)
    // Check if first 32 chars after % are valid hex to determine format
    const afterPrefix = encryptedData.slice(INLINE_PREFIX.length);
    const first32 = afterPrefix.slice(0, 32);
    const isHexFormat = /^[0-9a-fA-F]{32}$/.test(first32);

    if (isHexFormat) {
      // V2 legacy: hex IV + hex salt + base64 ciphertext
      return decryptV2Legacy(encryptedData, passphrase);
    } else {
      // Same as HKDF but with % prefix instead of %=
      // This is the case for most modern inline files
      const hkdfData = HKDF_PREFIX + afterPrefix;
      return decryptHKDF(hkdfData, passphrase);
    }
  } else {
    throw new Error("Not encrypted data (missing % or %= prefix)");
  }
}

/**
 * Check if data is V2 encrypted (either HKDF or inline format)
 */
export function isV2Encrypted(data: string): boolean {
  return data.startsWith(HKDF_PREFIX) || data.startsWith(INLINE_PREFIX);
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
