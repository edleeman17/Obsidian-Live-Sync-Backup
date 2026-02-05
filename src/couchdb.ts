/**
 * CouchDB client for fetching LiveSync documents.
 *
 * Document types in LiveSync:
 * - File entries: _id is the file path, contains children[] array pointing to chunks
 * - Leaf chunks: _id is "h:<content-hash>", contains encrypted data
 * - Eden chunks: temporary inline chunks stored in parent document
 */

import type { CouchDBConnection } from "./config.ts";

export interface FileEntry {
  _id: string;
  _rev: string;
  path: string;
  ctime: number;
  mtime: number;
  size: number;
  children: string[];
  type: "notes" | "newnote" | "plain";
  eden?: Record<string, { data: string }>;
  deleted?: boolean;
}

export interface LeafChunk {
  _id: string;
  _rev: string;
  data: string;
  type: "leaf";
}

export interface AllDocsResponse<T> {
  total_rows: number;
  offset: number;
  rows: Array<{
    id: string;
    key: string;
    value: { rev: string };
    doc?: T;
  }>;
}

export class CouchDBClient {
  private baseUrl: string;
  private authHeader: string;
  private database: string;

  constructor(connection: CouchDBConnection) {
    // Remove trailing slash from URI
    this.baseUrl = connection.uri.replace(/\/$/, "");
    this.database = connection.database;

    // Create basic auth header
    const credentials = btoa(`${connection.username}:${connection.password}`);
    this.authHeader = `Basic ${credentials}`;
  }

  private async fetch<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/${this.database}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`CouchDB request failed: ${response.status} ${error}`);
    }

    return response.json();
  }

  /**
   * Test the connection to CouchDB
   */
  async testConnection(): Promise<{ db_name: string; doc_count: number }> {
    const url = `${this.baseUrl}/${this.database}`;
    const response = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(`Cannot connect to CouchDB: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Fetch all file entries (documents that are not chunks)
   */
  async getAllFileEntries(): Promise<FileEntry[]> {
    // Use _all_docs with include_docs to get all documents
    const result = await this.fetch<AllDocsResponse<FileEntry>>(
      "/_all_docs?include_docs=true"
    );

    // Filter to only file entries (not chunks, not design docs)
    return result.rows
      .filter((row) => {
        if (!row.doc) return false;
        // Skip design documents
        if (row.id.startsWith("_design/")) return false;
        // Skip chunk documents (they start with "h:")
        if (row.id.startsWith("h:")) return false;
        // Skip deleted documents
        if (row.doc.deleted) return false;
        // Must have children array (file entries have this)
        if (!Array.isArray(row.doc.children)) return false;
        return true;
      })
      .map((row) => row.doc!);
  }

  /**
   * Fetch a specific chunk by its ID
   */
  async getChunk(chunkId: string): Promise<LeafChunk> {
    return this.fetch<LeafChunk>(`/${encodeURIComponent(chunkId)}`);
  }

  /**
   * Fetch multiple chunks in bulk
   */
  async getChunks(chunkIds: string[]): Promise<Map<string, LeafChunk>> {
    const result = await this.fetch<AllDocsResponse<LeafChunk>>(
      "/_all_docs?include_docs=true",
      {
        method: "POST",
        body: JSON.stringify({ keys: chunkIds }),
      }
    );

    const chunks = new Map<string, LeafChunk>();
    for (const row of result.rows) {
      if (row.doc && row.doc.data) {
        chunks.set(row.id, row.doc);
      }
    }
    return chunks;
  }

  /**
   * Get database info
   */
  async getInfo(): Promise<{ doc_count: number; data_size: number }> {
    const url = `${this.baseUrl}/${this.database}`;
    const response = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
      },
    });
    return response.json();
  }
}
