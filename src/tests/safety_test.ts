/**
 * Safety Tests
 *
 * Critical tests to ensure the backup tool cannot:
 * - Delete files outside the backup directory
 * - Write files outside intended directories
 * - Follow path traversal attacks
 * - Accidentally remove user data
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.208.0/fs/mod.ts";

// Import the modules we're testing
import { isPathSafe, sanitizePath } from "../path_safety.ts";
import { pruneOldBackups } from "../backup.ts";

Deno.test("Path Safety: rejects absolute paths", () => {
  assertEquals(isPathSafe("/etc/passwd", "/backup"), false);
  assertEquals(isPathSafe("/Users/someone/file.md", "/backup"), false);
  assertEquals(isPathSafe("C:\\Windows\\System32", "/backup"), false);
});

Deno.test("Path Safety: rejects path traversal attempts", () => {
  assertEquals(isPathSafe("../../../etc/passwd", "/backup"), false);
  assertEquals(isPathSafe("foo/../../bar", "/backup"), false);
  assertEquals(isPathSafe("foo/../../../etc/passwd", "/backup"), false);
  assertEquals(isPathSafe("..\\..\\Windows", "/backup"), false);
});

Deno.test("Path Safety: rejects paths with null bytes", () => {
  assertEquals(isPathSafe("file\x00.md", "/backup"), false);
  assertEquals(isPathSafe("foo/bar\x00baz", "/backup"), false);
});

Deno.test("Path Safety: allows safe relative paths", () => {
  assertEquals(isPathSafe("notes/my-note.md", "/backup"), true);
  assertEquals(isPathSafe("daily/2024/01/01.md", "/backup"), true);
  assertEquals(isPathSafe("file.md", "/backup"), true);
  assertEquals(isPathSafe("folder/subfolder/deep/file.txt", "/backup"), true);
});

Deno.test("Path Safety: handles edge cases", () => {
  assertEquals(isPathSafe("", "/backup"), false);
  assertEquals(isPathSafe(".", "/backup"), false);
  assertEquals(isPathSafe("..", "/backup"), false);
  assertEquals(isPathSafe("./file.md", "/backup"), true);
});

Deno.test("Path Sanitization: normalizes paths safely", () => {
  assertEquals(sanitizePath("foo//bar"), "foo/bar");
  assertEquals(sanitizePath("foo\\bar"), "foo/bar");
  assertEquals(sanitizePath("  file.md  "), "file.md");
});

Deno.test("Pruning: only deletes files matching obsidian-*.zip pattern", async () => {
  // Create a temp directory with various files
  const tempDir = await Deno.makeTempDir({ prefix: "prune-test-" });

  try {
    // Create files that SHOULD be considered for deletion (match pattern)
    await Deno.writeTextFile(join(tempDir, "obsidian-2024-01-01.zip"), "old backup");
    await Deno.writeTextFile(join(tempDir, "obsidian-2024-01-15.zip"), "old backup");

    // Create files that should NEVER be deleted (don't match pattern)
    await Deno.writeTextFile(join(tempDir, "important-data.zip"), "important");
    await Deno.writeTextFile(join(tempDir, "notes.md"), "my notes");
    await Deno.writeTextFile(join(tempDir, "obsidian-backup.tar.gz"), "different format");
    await Deno.writeTextFile(join(tempDir, "not-obsidian-2024-01-01.zip"), "wrong prefix");
    await ensureDir(join(tempDir, "obsidian-2024-01-01"));
    await Deno.writeTextFile(join(tempDir, "obsidian-2024-01-01", "file.md"), "in folder");

    // Run pruning with 0 retention (should delete all matching old backups)
    await pruneOldBackups(tempDir, 0);

    // Verify protected files still exist
    const importantData = await Deno.readTextFile(join(tempDir, "important-data.zip"));
    assertEquals(importantData, "important", "important-data.zip should not be deleted");

    const notes = await Deno.readTextFile(join(tempDir, "notes.md"));
    assertEquals(notes, "my notes", "notes.md should not be deleted");

    const tarGz = await Deno.readTextFile(join(tempDir, "obsidian-backup.tar.gz"));
    assertEquals(tarGz, "different format", "tar.gz should not be deleted");

    const wrongPrefix = await Deno.readTextFile(join(tempDir, "not-obsidian-2024-01-01.zip"));
    assertEquals(wrongPrefix, "wrong prefix", "wrong prefix should not be deleted");

    // Verify directory was not deleted
    const folderFile = await Deno.readTextFile(join(tempDir, "obsidian-2024-01-01", "file.md"));
    assertEquals(folderFile, "in folder", "directories should not be deleted");

  } finally {
    // Cleanup
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Pruning: respects retention period", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "retention-test-" });

  try {
    // Create a "new" backup (today)
    const today = new Date().toISOString().split("T")[0];
    const newBackup = join(tempDir, `obsidian-${today}.zip`);
    await Deno.writeTextFile(newBackup, "today's backup");

    // Run pruning with 30 day retention
    await pruneOldBackups(tempDir, 30);

    // Today's backup should still exist
    const exists = await Deno.stat(newBackup).then(() => true).catch(() => false);
    assertEquals(exists, true, "Recent backup should not be deleted");

  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Pruning: does not traverse into subdirectories", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "subdir-test-" });

  try {
    // Create a subdirectory with a file that matches the pattern
    await ensureDir(join(tempDir, "subdir"));
    await Deno.writeTextFile(join(tempDir, "subdir", "obsidian-2020-01-01.zip"), "nested");

    // Run pruning
    await pruneOldBackups(tempDir, 0);

    // Nested file should still exist (pruning should only look at top level)
    const nested = await Deno.readTextFile(join(tempDir, "subdir", "obsidian-2020-01-01.zip"));
    assertEquals(nested, "nested", "Nested files should not be touched");

  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Pruning: handles empty directory gracefully", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "empty-test-" });

  try {
    // Should not throw on empty directory
    await pruneOldBackups(tempDir, 30);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Pruning: handles non-existent directory gracefully", async () => {
  // Should not throw, just warn
  await pruneOldBackups("/non/existent/path/that/does/not/exist", 30);
});
