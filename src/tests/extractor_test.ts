/**
 * Extractor Tests
 *
 * Tests for file extraction with focus on path safety.
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { exists } from "https://deno.land/std@0.208.0/fs/mod.ts";

import { writeFileSafely } from "../extractor.ts";

Deno.test("writeFileSafely: writes file within base directory", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "extractor-test-" });

  try {
    await writeFileSafely(tempDir, "notes/test.md", "Hello, World!");

    const content = await Deno.readTextFile(join(tempDir, "notes/test.md"));
    assertEquals(content, "Hello, World!");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("writeFileSafely: creates nested directories", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "extractor-test-" });

  try {
    await writeFileSafely(tempDir, "a/b/c/d/deep.md", "Deep file");

    const content = await Deno.readTextFile(join(tempDir, "a/b/c/d/deep.md"));
    assertEquals(content, "Deep file");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("writeFileSafely: rejects path traversal attempt", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "extractor-test-" });

  try {
    // This should throw an error and NOT write any file
    await assertRejects(
      () => writeFileSafely(tempDir, "../../../tmp/livesync-traversal-test.txt", "malicious"),
      Error,
      "Unsafe path"
    );

    // Verify the file was NOT created outside the temp directory
    const escapedPath = "/tmp/livesync-traversal-test.txt";
    const fileExists = await exists(escapedPath);
    assertEquals(fileExists, false, "File should not exist outside base directory");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    // Clean up in case the test failed and created the file
    try {
      await Deno.remove("/tmp/livesync-traversal-test.txt");
    } catch {
      // File doesn't exist, which is expected
    }
  }
});

Deno.test("writeFileSafely: rejects absolute path", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "extractor-test-" });

  try {
    await assertRejects(
      () => writeFileSafely(tempDir, "/etc/passwd", "malicious"),
      Error,
      "Unsafe path"
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("writeFileSafely: rejects null byte injection", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "extractor-test-" });

  try {
    await assertRejects(
      () => writeFileSafely(tempDir, "file\x00.md", "malicious"),
      Error,
      "Unsafe path"
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("writeFileSafely: handles files with spaces and special chars", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "extractor-test-" });

  try {
    await writeFileSafely(tempDir, "my notes/2024 Q1 Review (Final).md", "Content");

    const content = await Deno.readTextFile(
      join(tempDir, "my notes/2024 Q1 Review (Final).md")
    );
    assertEquals(content, "Content");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("writeFileSafely: handles unicode filenames", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "extractor-test-" });

  try {
    await writeFileSafely(tempDir, "日本語/ノート.md", "日本語コンテンツ");

    const content = await Deno.readTextFile(join(tempDir, "日本語/ノート.md"));
    assertEquals(content, "日本語コンテンツ");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("writeFileSafely: rejects Windows-style absolute paths", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "extractor-test-" });

  try {
    await assertRejects(
      () => writeFileSafely(tempDir, "C:\\Windows\\System32\\config", "malicious"),
      Error,
      "Unsafe path"
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("writeFileSafely: rejects backslash traversal", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "extractor-test-" });

  try {
    await assertRejects(
      () => writeFileSafely(tempDir, "..\\..\\etc\\passwd", "malicious"),
      Error,
      "Unsafe path"
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
