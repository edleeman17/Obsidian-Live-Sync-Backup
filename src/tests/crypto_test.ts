/**
 * Crypto Tests
 *
 * Tests for the encryption/decryption module.
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import { isV2Encrypted, decryptV2, decryptChunk } from "../crypto.ts";

Deno.test("isV2Encrypted: detects V2 prefix", () => {
  assertEquals(isV2Encrypted("%someencrypteddata"), true);
  assertEquals(isV2Encrypted("%"), true);
});

Deno.test("isV2Encrypted: rejects non-V2 data", () => {
  assertEquals(isV2Encrypted("plaintext"), false);
  assertEquals(isV2Encrypted(""), false);
  assertEquals(isV2Encrypted("$%wrongprefix"), false);
  assertEquals(isV2Encrypted("% $spaceinprefix"), false);
});

Deno.test("decryptV2: rejects data without V2 prefix", async () => {
  await assertRejects(
    () => decryptV2("plaintext", "passphrase"),
    Error,
    "Not V2 encrypted data"
  );
});

Deno.test("decryptV2: rejects malformed base64", async () => {
  await assertRejects(
    () => decryptV2("%!!!notbase64!!!", "passphrase"),
    Error
  );
});

Deno.test("decryptV2: rejects data too short for header", async () => {
  // V2 needs at least: salt(16) + iv(12) + tag(16) = 44 bytes minimum
  // This base64 decodes to less than that
  await assertRejects(
    () => decryptV2("%dG9vc2hvcnQ=", "passphrase"),
    Error
  );
});

Deno.test("decryptChunk: passes through plaintext", async () => {
  const plaintext = "This is not encrypted";
  const result = await decryptChunk(plaintext, "any-passphrase");
  assertEquals(result, plaintext);
});

Deno.test("decryptChunk: passes through empty string", async () => {
  const result = await decryptChunk("", "any-passphrase");
  assertEquals(result, "");
});

Deno.test("decryptChunk: attempts decryption for V2 data", async () => {
  // This will fail because it's not validly encrypted, but it should
  // attempt decryption (not pass through)
  await assertRejects(
    () => decryptChunk("%dG9vc2hvcnQ=", "passphrase"),
    Error
  );
});

// Integration test - only runs if real encrypted data is available
Deno.test({
  name: "decryptV2: decrypts real V2 data (integration)",
  ignore: !Deno.env.get("TEST_ENCRYPTED_DATA") || !Deno.env.get("TEST_PASSPHRASE"),
  fn: async () => {
    const encrypted = Deno.env.get("TEST_ENCRYPTED_DATA")!;
    const passphrase = Deno.env.get("TEST_PASSPHRASE")!;
    const expected = Deno.env.get("TEST_EXPECTED_PLAINTEXT") || "";

    const result = await decryptV2(encrypted, passphrase);

    if (expected) {
      assertEquals(result, expected);
    } else {
      // Just verify it doesn't throw and returns something
      assertEquals(typeof result, "string");
    }
  },
});
