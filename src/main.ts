/**
 * LiveSync Backup - Main entry point
 *
 * Extracts notes from CouchDB, decrypts them, and creates daily zip backups.
 *
 * SAFETY: This tool is designed to be read-only on the source (CouchDB) and
 * only writes to designated backup locations. See the test suite for
 * verification of safety properties.
 */

import { loadConfig } from "./config.ts";
import { CouchDBClient } from "./couchdb.ts";
import { Extractor } from "./extractor.ts";
import { createZipArchive, pruneOldBackups } from "./backup.ts";
import { ensureDir } from "https://deno.land/std@0.208.0/fs/mod.ts";

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

    if (config.dryRun) {
      console.log("\n*** DRY RUN MODE - No files will be written or deleted ***\n");
    }

    // Create CouchDB client and test connection
    console.log("\nConnecting to CouchDB...");
    const client = new CouchDBClient(config.couchdb);
    const dbInfo = await client.testConnection();
    console.log(`Connected to database: ${dbInfo.db_name}`);
    console.log(`Document count: ${dbInfo.doc_count}`);

    // Fetch file entries to show what would be backed up
    console.log("\nFetching file entries from CouchDB...");
    const fileEntries = await client.getAllFileEntries();
    console.log(`Found ${fileEntries.length} files to backup`);

    if (config.dryRun) {
      // In dry run mode, just show what would happen
      console.log("\n--- DRY RUN: What would happen ---");
      console.log(`\n1. Extract ${fileEntries.length} files to temp directory`);

      // Show sample of files
      const sample = fileEntries.slice(0, 10);
      console.log("\n   Sample files:");
      for (const entry of sample) {
        console.log(`   - ${entry._id}`);
      }
      if (fileEntries.length > 10) {
        console.log(`   ... and ${fileEntries.length - 10} more`);
      }

      const today = new Date().toISOString().split("T")[0];
      console.log(`\n2. Create backup: ${config.outputPath}/obsidian-${today}.zip`);

      console.log(`\n3. Prune backups older than ${config.retentionDays} days in ${config.outputPath}`);

      // Check what would be pruned
      try {
        const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
        const backupPattern = /^obsidian-\d{4}-\d{2}-\d{2}\.zip$/;
        let wouldPrune = 0;

        for await (const entry of Deno.readDir(config.outputPath)) {
          if (entry.isFile && backupPattern.test(entry.name)) {
            const stat = await Deno.stat(`${config.outputPath}/${entry.name}`);
            if (stat.mtime && stat.mtime.getTime() < cutoff) {
              console.log(`   Would prune: ${entry.name}`);
              wouldPrune++;
            }
          }
        }
        if (wouldPrune === 0) {
          console.log("   (no old backups to prune)");
        }
      } catch {
        console.log("   (backup directory not accessible)");
      }

      console.log("\n--- DRY RUN COMPLETE - No changes made ---");
      return;
    }

    // Regular (non-dry-run) execution
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
