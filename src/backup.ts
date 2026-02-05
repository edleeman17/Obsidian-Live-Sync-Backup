/**
 * Backup Module
 *
 * Handles zip archive creation and backup pruning with strict safety checks.
 */

import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

/**
 * Pattern for valid backup filenames.
 * Only files matching this exact pattern can be pruned.
 * Format: obsidian-YYYY-MM-DD.zip
 */
const BACKUP_FILENAME_PATTERN = /^obsidian-\d{4}-\d{2}-\d{2}\.zip$/;

/**
 * Check if a filename matches the backup pattern.
 * This is intentionally strict to prevent accidental deletion.
 */
export function isBackupFile(filename: string): boolean {
  return BACKUP_FILENAME_PATTERN.test(filename);
}

/**
 * Create a timestamped zip archive.
 * Returns the path to the created zip file.
 */
export async function createZipArchive(
  sourceDir: string,
  outputPath: string
): Promise<string> {
  const date = new Date().toISOString().split("T")[0];
  const zipName = `obsidian-${date}.zip`;
  const zipPath = join(outputPath, zipName);

  console.log(`Creating backup: ${zipPath}`);

  const process = new Deno.Command("zip", {
    args: ["-r", zipPath, "."],
    cwd: sourceDir,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stderr } = await process.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`Failed to create zip: ${errorText}`);
  }

  // Get file size for logging
  const stat = await Deno.stat(zipPath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
  console.log(`Backup created: ${zipName} (${sizeMB} MB)`);

  return zipPath;
}

/**
 * Remove old backups beyond retention period.
 *
 * SAFETY GUARANTEES:
 * - Only deletes files in the specified directory (no subdirectory traversal)
 * - Only deletes files matching the exact pattern: obsidian-YYYY-MM-DD.zip
 * - Only deletes regular files (not directories, symlinks, etc.)
 * - Silently handles non-existent directories
 */
export async function pruneOldBackups(
  backupDir: string,
  retentionDays: number
): Promise<{ pruned: string[]; skipped: string[] }> {
  const result = { pruned: [] as string[], skipped: [] as string[] };

  // Check if directory exists
  try {
    const stat = await Deno.stat(backupDir);
    if (!stat.isDirectory) {
      console.warn(`Backup path is not a directory: ${backupDir}`);
      return result;
    }
  } catch {
    console.warn(`Backup directory does not exist: ${backupDir}`);
    return result;
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  for await (const entry of Deno.readDir(backupDir)) {
    // SAFETY: Only process regular files
    if (!entry.isFile) {
      result.skipped.push(`${entry.name} (not a file)`);
      continue;
    }

    // SAFETY: Only process files matching our exact backup pattern
    if (!isBackupFile(entry.name)) {
      result.skipped.push(`${entry.name} (doesn't match backup pattern)`);
      continue;
    }

    const filePath = join(backupDir, entry.name);

    try {
      const stat = await Deno.stat(filePath);

      // Double-check it's a file (defense in depth)
      if (!stat.isFile) {
        result.skipped.push(`${entry.name} (stat says not a file)`);
        continue;
      }

      // Check if older than retention period
      if (stat.mtime && stat.mtime.getTime() < cutoff) {
        await Deno.remove(filePath);
        console.log(`Pruned old backup: ${entry.name}`);
        result.pruned.push(entry.name);
      }
    } catch (error) {
      console.error(`Error processing ${entry.name}: ${error}`);
      result.skipped.push(`${entry.name} (error: ${error})`);
    }
  }

  if (result.pruned.length > 0) {
    console.log(`Pruned ${result.pruned.length} old backup(s)`);
  }

  return result;
}
