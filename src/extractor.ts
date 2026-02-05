/**
 * Document extraction - reassembles chunks and writes files.
 *
 * LiveSync stores files as:
 * 1. A file entry document with metadata and children[] array
 * 2. Multiple chunk documents containing the actual content
 *
 * Chunks can be:
 * - Regular chunks: stored in separate "h:<hash>" documents
 * - Eden chunks: stored inline in the file entry's eden{} object
 *
 * SAFETY: All file writes go through writeFileSafely() which validates
 * paths to prevent directory traversal and other path-based attacks.
 */

import { CouchDBClient, FileEntry, LeafChunk } from "./couchdb.ts";
import { decryptChunk } from "./crypto.ts";
import { isPathSafe, sanitizePath } from "./path_safety.ts";
import { join, dirname } from "https://deno.land/std@0.208.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.208.0/fs/mod.ts";

export interface ExtractionResult {
  totalFiles: number;
  extractedFiles: number;
  failedFiles: string[];
  skippedFiles: string[];
}

/**
 * Write a file safely within a base directory.
 *
 * SAFETY GUARANTEES:
 * - Validates the path doesn't escape the base directory
 * - Rejects path traversal attempts (../)
 * - Rejects absolute paths
 * - Rejects null byte injection
 *
 * Throws an error if the path is unsafe.
 */
export async function writeFileSafely(
  baseDir: string,
  relativePath: string,
  content: string
): Promise<void> {
  // Validate the path is safe
  if (!isPathSafe(relativePath, baseDir)) {
    throw new Error(`Unsafe path rejected: ${relativePath}`);
  }

  // Sanitize and construct full path
  const safePath = sanitizePath(relativePath);
  const fullPath = join(baseDir, safePath);

  // Ensure directory exists
  await ensureDir(dirname(fullPath));

  // Write file
  await Deno.writeTextFile(fullPath, content);
}

export class Extractor {
  private client: CouchDBClient;
  private passphrase: string;
  private chunkCache: Map<string, LeafChunk> = new Map();

  constructor(client: CouchDBClient, e2eePassphrase: string) {
    this.client = client;
    this.passphrase = e2eePassphrase;
  }

  /**
   * Prefetch all chunks to avoid many individual requests
   */
  private async prefetchChunks(fileEntries: FileEntry[]): Promise<void> {
    // Collect all unique chunk IDs
    const allChunkIds = new Set<string>();
    for (const entry of fileEntries) {
      for (const chunkId of entry.children) {
        // Skip eden chunks (they're inline)
        if (!chunkId.startsWith("h:")) continue;
        allChunkIds.add(chunkId);
      }
    }

    console.log(`Prefetching ${allChunkIds.size} chunks...`);

    // Fetch in batches to avoid overwhelming CouchDB
    const BATCH_SIZE = 100;
    const chunkIdArray = Array.from(allChunkIds);

    for (let i = 0; i < chunkIdArray.length; i += BATCH_SIZE) {
      const batch = chunkIdArray.slice(i, i + BATCH_SIZE);
      const chunks = await this.client.getChunks(batch);

      for (const [id, chunk] of chunks) {
        this.chunkCache.set(id, chunk);
      }

      const progress = Math.min(i + BATCH_SIZE, chunkIdArray.length);
      console.log(`  Fetched ${progress}/${chunkIdArray.length} chunks`);
    }
  }

  /**
   * Get chunk data, either from cache or eden
   */
  private async getChunkData(
    chunkId: string,
    entry: FileEntry
  ): Promise<string | null> {
    // Check if it's an eden chunk (inline in the document)
    if (entry.eden && entry.eden[chunkId]) {
      return entry.eden[chunkId].data;
    }

    // Get from cache
    const chunk = this.chunkCache.get(chunkId);
    if (chunk) {
      return chunk.data;
    }

    // Fallback: fetch individually (shouldn't happen with prefetch)
    try {
      const fetchedChunk = await this.client.getChunk(chunkId);
      return fetchedChunk.data;
    } catch {
      return null;
    }
  }

  /**
   * Reassemble and decrypt a file's content from its chunks
   */
  private async reassembleFile(entry: FileEntry): Promise<string> {
    const decryptedChunks: string[] = [];

    for (const chunkId of entry.children) {
      const encryptedData = await this.getChunkData(chunkId, entry);
      if (!encryptedData) {
        throw new Error(`Missing chunk: ${chunkId}`);
      }

      const decrypted = await decryptChunk(encryptedData, this.passphrase);
      decryptedChunks.push(decrypted);
    }

    return decryptedChunks.join("");
  }

  /**
   * Extract all files to a directory
   *
   * SAFETY: Each file path is validated before writing to prevent
   * path traversal attacks from malicious CouchDB data.
   */
  async extractAll(outputDir: string): Promise<ExtractionResult> {
    const result: ExtractionResult = {
      totalFiles: 0,
      extractedFiles: 0,
      failedFiles: [],
      skippedFiles: [],
    };

    console.log("Fetching file entries from CouchDB...");
    const fileEntries = await this.client.getAllFileEntries();
    result.totalFiles = fileEntries.length;
    console.log(`Found ${fileEntries.length} files`);

    // Prefetch all chunks
    await this.prefetchChunks(fileEntries);

    // Extract each file
    for (const entry of fileEntries) {
      const filePath = entry._id;

      // Skip internal files if desired
      if (filePath.startsWith(".obsidian/")) {
        result.skippedFiles.push(filePath);
        continue;
      }

      try {
        const content = await this.reassembleFile(entry);

        // SAFETY: Use writeFileSafely to validate path before writing
        await writeFileSafely(outputDir, filePath, content);
        result.extractedFiles++;

        // Progress indicator
        if (result.extractedFiles % 50 === 0) {
          console.log(
            `  Extracted ${result.extractedFiles}/${result.totalFiles} files`
          );
        }
      } catch (error) {
        console.error(`Failed to extract ${filePath}: ${error}`);
        result.failedFiles.push(filePath);
      }
    }

    console.log(`Extraction complete: ${result.extractedFiles} files extracted`);
    if (result.failedFiles.length > 0) {
      console.error(`Failed files: ${result.failedFiles.join(", ")}`);
    }

    return result;
  }
}
