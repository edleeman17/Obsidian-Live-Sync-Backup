/**
 * LiveSync Backup - Main entry point
 *
 * Extracts notes from CouchDB, decrypts them, and creates daily zip backups.
 */

import { loadConfig } from "./config.ts";
import { CouchDBClient } from "./couchdb.ts";
import { Extractor } from "./extractor.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { ensureDir, emptyDir } from "https://deno.land/std@0.208.0/fs/mod.ts";

/**
 * Create a timestamped zip archive
 */
async function createZipArchive(
  sourceDir: string,
  outputPath: string
): Promise<void> {
  const date = new Date().toISOString().split("T")[0];
  const zipName = `obsidian-${date}.zip`;
  const zipPath = join(outputPath, zipName);

  console.log(`Creating backup: ${zipPath}`);

  // Use zip command (available in most environments)
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
}

/**
 * Remove old backups beyond retention period
 */
async function pruneOldBackups(
  backupDir: string,
  retentionDays: number
): Promise<void> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let pruned = 0;

  for await (const entry of Deno.readDir(backupDir)) {
    if (!entry.isFile || !entry.name.startsWith("obsidian-") || !entry.name.endsWith(".zip")) {
      continue;
    }

    const filePath = join(backupDir, entry.name);
    const stat = await Deno.stat(filePath);

    if (stat.mtime && stat.mtime.getTime() < cutoff) {
      await Deno.remove(filePath);
      console.log(`Pruned old backup: ${entry.name}`);
      pruned++;
    }
  }

  if (pruned > 0) {
    console.log(`Pruned ${pruned} old backups`);
  }
}

/**
 * Main backup process
 */
async function main() {
  console.log("=== LiveSync Backup ===");
  console.log(`Started at: ${new Date().toISOString()}`);

  try {
    // Load configuration
    const dataJsonPath = Deno.args[0]; // Optional: path to data.json as first argument
    const config = await loadConfig(dataJsonPath);

    // Create CouchDB client and test connection
    console.log("\nConnecting to CouchDB...");
    const client = new CouchDBClient(config.couchdb);
    const dbInfo = await client.testConnection();
    console.log(`Connected to database: ${dbInfo.db_name}`);
    console.log(`Document count: ${dbInfo.doc_count}`);

    // Create temp directory for extraction
    const tempDir = await Deno.makeTempDir({ prefix: "livesync-backup-" });
    console.log(`\nExtracting to: ${tempDir}`);

    try {
      // Extract all files
      const extractor = new Extractor(client, config.e2eePassphrase);
      const result = await extractor.extractAll(tempDir);

      console.log(`\nExtraction summary:`);
      console.log(`  Total files: ${result.totalFiles}`);
      console.log(`  Extracted: ${result.extractedFiles}`);
      console.log(`  Skipped: ${result.skippedFiles.length}`);
      console.log(`  Failed: ${result.failedFiles.length}`);

      // Ensure output directory exists
      await ensureDir(config.outputPath);

      // Create zip archive
      await createZipArchive(tempDir, config.outputPath);

      // Prune old backups
      await pruneOldBackups(config.outputPath, config.retentionDays);
    } finally {
      // Cleanup temp directory
      console.log("\nCleaning up temp files...");
      await Deno.remove(tempDir, { recursive: true });
    }

    console.log(`\nBackup completed successfully at: ${new Date().toISOString()}`);
  } catch (error) {
    console.error(`\nBackup failed: ${error}`);
    Deno.exit(1);
  }
}

// Run main
main();
