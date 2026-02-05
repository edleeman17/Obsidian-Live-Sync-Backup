/**
 * Configuration loading and credential decryption.
 * Reads data.json from LiveSync plugin and decrypts the CouchDB connection.
 */

import { decryptV2 } from "./crypto.ts";

export interface LiveSyncDataJson {
  encrypt: boolean;
  E2EEAlgorithm: string;
  usePathObfuscation: boolean;
  additionalSuffixOfDatabaseName: string;
  encryptedPassphrase: string;
  encryptedCouchDBConnection: string;
  minimumChunkSize: number;
  longLineThreshold: number;
  hashAlg: string;
}

export interface CouchDBConnection {
  uri: string;
  username: string;
  password: string;
  database: string;
}

export interface BackupConfig {
  couchdb: CouchDBConnection;
  e2eePassphrase: string;
  usePathObfuscation: boolean;
  outputPath: string;
  retentionDays: number;
  dryRun: boolean;
  uptimeKumaPushUrl?: string;
}

/**
 * Parse the decrypted CouchDB connection string.
 * Format from LiveSync: JSON with couchDB_URI, couchDB_USER, couchDB_PASSWORD, couchDB_DBNAME
 */
function parseCouchDBConnection(
  decryptedJson: string,
  dbSuffix: string
): CouchDBConnection {
  const config = JSON.parse(decryptedJson);

  // Build database name - LiveSync uses "obsidian-" + suffix
  const database = `obsidian-${dbSuffix}`;

  return {
    uri: config.couchDB_URI,
    username: config.couchDB_USER,
    password: config.couchDB_PASSWORD,
    database: database,
  };
}

/**
 * Load configuration from environment variables and data.json
 */
export async function loadConfig(dataJsonPath?: string): Promise<BackupConfig> {
  const configPassphrase = Deno.env.get("CONFIG_PASSPHRASE");
  const e2eePassphrase = Deno.env.get("E2EE_PASSPHRASE");
  const dbSuffix =
    Deno.env.get("DB_SUFFIX") || "5987ba08b1ec3c27";
  const outputPath = Deno.env.get("NAS_PATH") || "/backup";
  const retentionDays = parseInt(Deno.env.get("RETENTION_DAYS") || "30", 10);
  const dryRun = Deno.env.get("DRY_RUN")?.toLowerCase() === "true";
  const uptimeKumaPushUrl = Deno.env.get("UPTIME_KUMA_PUSH_URL") || undefined;

  // Check for direct CouchDB config (skips data.json decryption)
  const directUri = Deno.env.get("COUCHDB_URI");
  const directUser = Deno.env.get("COUCHDB_USER");
  const directPassword = Deno.env.get("COUCHDB_PASSWORD");

  let couchdb: CouchDBConnection;
  let usePathObfuscation = false;

  if (directUri && directUser && directPassword) {
    // Use direct configuration
    // COUCHDB_DATABASE overrides the constructed name
    const directDatabase = Deno.env.get("COUCHDB_DATABASE");
    const database = directDatabase || `obsidian-${dbSuffix}`;
    couchdb = {
      uri: directUri,
      username: directUser,
      password: directPassword,
      database,
    };
    console.log("Using direct CouchDB configuration from environment");
  } else {
    // Decrypt from data.json
    if (!configPassphrase) {
      throw new Error(
        "CONFIG_PASSPHRASE environment variable required to decrypt data.json"
      );
    }

    const jsonPath = dataJsonPath || Deno.env.get("DATA_JSON_PATH") || "/app/config/data.json";
    console.log(`Loading LiveSync config from: ${jsonPath}`);

    const dataJsonContent = await Deno.readTextFile(jsonPath);
    const dataJson: LiveSyncDataJson = JSON.parse(dataJsonContent);

    // Decrypt the CouchDB connection
    const decryptedConnection = await decryptV2(
      dataJson.encryptedCouchDBConnection,
      configPassphrase
    );
    couchdb = parseCouchDBConnection(decryptedConnection, dbSuffix);
    usePathObfuscation = dataJson.usePathObfuscation;

    console.log(`CouchDB URI: ${couchdb.uri}`);
    console.log(`Database: ${couchdb.database}`);
    console.log(`Path obfuscation: ${usePathObfuscation}`);
  }

  if (!e2eePassphrase) {
    throw new Error(
      "E2EE_PASSPHRASE environment variable required to decrypt content"
    );
  }

  return {
    couchdb,
    e2eePassphrase,
    usePathObfuscation,
    outputPath,
    retentionDays,
    dryRun,
    uptimeKumaPushUrl,
  };
}
