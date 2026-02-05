/**
 * Backup Module Tests
 *
 * Tests for zip creation and backup filename validation.
 */

import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import { isBackupFile } from "../backup.ts";

Deno.test("isBackupFile: accepts valid backup filenames", () => {
  assertEquals(isBackupFile("obsidian-2024-01-01.zip"), true);
  assertEquals(isBackupFile("obsidian-2024-12-31.zip"), true);
  assertEquals(isBackupFile("obsidian-1999-01-01.zip"), true);
  assertEquals(isBackupFile("obsidian-2099-12-31.zip"), true);
});

Deno.test("isBackupFile: rejects wrong extension", () => {
  assertEquals(isBackupFile("obsidian-2024-01-01.tar"), false);
  assertEquals(isBackupFile("obsidian-2024-01-01.tar.gz"), false);
  assertEquals(isBackupFile("obsidian-2024-01-01.rar"), false);
  assertEquals(isBackupFile("obsidian-2024-01-01"), false);
});

Deno.test("isBackupFile: rejects wrong prefix", () => {
  assertEquals(isBackupFile("backup-2024-01-01.zip"), false);
  assertEquals(isBackupFile("notes-2024-01-01.zip"), false);
  assertEquals(isBackupFile("Obsidian-2024-01-01.zip"), false); // case sensitive
  assertEquals(isBackupFile("OBSIDIAN-2024-01-01.zip"), false);
});

Deno.test("isBackupFile: rejects malformed dates", () => {
  assertEquals(isBackupFile("obsidian-24-01-01.zip"), false); // 2-digit year
  assertEquals(isBackupFile("obsidian-2024-1-01.zip"), false); // 1-digit month
  assertEquals(isBackupFile("obsidian-2024-01-1.zip"), false); // 1-digit day
  assertEquals(isBackupFile("obsidian-2024-1-1.zip"), false);
  assertEquals(isBackupFile("obsidian-20240101.zip"), false); // no dashes
});

Deno.test("isBackupFile: rejects path traversal in filename", () => {
  assertEquals(isBackupFile("../obsidian-2024-01-01.zip"), false);
  assertEquals(isBackupFile("foo/obsidian-2024-01-01.zip"), false);
  assertEquals(isBackupFile("obsidian-2024-01-01.zip/../../etc"), false);
});

Deno.test("isBackupFile: rejects files with extra content", () => {
  assertEquals(isBackupFile("obsidian-2024-01-01.zip.bak"), false);
  assertEquals(isBackupFile("obsidian-2024-01-01.zip "), false);
  assertEquals(isBackupFile(" obsidian-2024-01-01.zip"), false);
  assertEquals(isBackupFile("obsidian-2024-01-01-extra.zip"), false);
  assertEquals(isBackupFile("my-obsidian-2024-01-01.zip"), false);
});

Deno.test("isBackupFile: rejects empty and special strings", () => {
  assertEquals(isBackupFile(""), false);
  assertEquals(isBackupFile("."), false);
  assertEquals(isBackupFile(".."), false);
  assertEquals(isBackupFile(".zip"), false);
});
