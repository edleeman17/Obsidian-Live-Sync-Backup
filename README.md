# livesync-backup

A headless backup tool for [Obsidian LiveSync](https://github.com/vrtmrz/obsidian-livesync). Extracts your notes directly from CouchDB, decrypts them, and creates daily zip archives - no Obsidian installation required.

## Why?

LiveSync stores your notes in CouchDB with end-to-end encryption. While this is great for syncing between devices, it means your backups are just encrypted blobs. This tool:

- Extracts notes directly from CouchDB
- Decrypts E2EE content (supports both encrypted and plaintext chunks)
- Creates timestamped zip archives
- Automatically prunes old backups
- Runs in Docker with minimal resources (~100MB RAM)

## Quick Start

```bash
# Clone the repo
git clone https://github.com/edleeman17/livesync-backup.git
cd livesync-backup

# Configure
cp .env.example .env
# Edit .env with your values (see Configuration below)

# Build and run
docker compose build
docker compose run --rm livesync-backup
```

## Configuration

Copy `.env.example` to `.env` and fill in your values:

### Required Settings

| Variable | Description | Where to find it |
|----------|-------------|------------------|
| `E2EE_PASSPHRASE` | Your LiveSync encryption passphrase | Obsidian → Settings → LiveSync → Encryption |
| `COUCHDB_URI` | CouchDB server URL | Your server address, e.g., `https://192.168.1.100:5984` |
| `COUCHDB_USER` | CouchDB username | Your CouchDB admin credentials |
| `COUCHDB_PASSWORD` | CouchDB password | Your CouchDB admin credentials |
| `COUCHDB_DATABASE` | Database name | Check Fauxton at `http://your-server:5984/_utils` |
| `NAS_PATH` | Where to save backups | Any directory path, e.g., `/mnt/nas/backups` |

### Finding Your Database Name

1. Open Fauxton (CouchDB admin) at `http://your-server:5984/_utils`
2. Look for a database starting with `obsidian`
3. It's usually just `obsidian` or `obsidian-{suffix}`

Alternatively, check your LiveSync plugin's `data.json` file:
- If `additionalSuffixOfDatabaseName` is empty → database is `obsidian`
- If it has a value like `5987ba08b1ec3c27` → database is `obsidian-5987ba08b1ec3c27`

### Optional Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `RETENTION_DAYS` | `30` | Days to keep old backups |
| `DRY_RUN` | `false` | Set to `true` to preview without making changes |
| `UPTIME_KUMA_PUSH_URL` | - | Uptime Kuma push URL for monitoring |
| `CA_CERT_HOST` | - | Path to CA certificate on host (for self-signed certs) |
| `CA_CERT` | - | Path where cert is mounted in container (e.g., `/app/certs/ca.pem`) |
| `CONFIG_PASSPHRASE` | - | For decrypting credentials from data.json (advanced) |

## Dry Run Mode

Before running a real backup, you can preview what would happen:

```bash
DRY_RUN=true docker compose run --rm livesync-backup
```

This will:
- Connect to CouchDB and verify credentials
- List all files that would be backed up
- Show what backup file would be created
- Show what old backups would be pruned

No files are written or deleted in dry run mode.

## Uptime Kuma Monitoring

Optionally notify [Uptime Kuma](https://github.com/louislam/uptime-kuma) when backups complete or fail:

1. In Uptime Kuma, add a new monitor with type "Push"
2. Copy the Push URL
3. Add to your `.env`:

```bash
UPTIME_KUMA_PUSH_URL=https://your-uptime-kuma/api/push/xxxxxxxx
```

The tool will:
- Send `status=up` with "Backup completed" on success
- Send `status=down` with error message on failure

## Scheduling Backups

Add a cron job to run backups automatically:

```bash
crontab -e
```

```cron
# Run backup daily at 2 AM
0 2 * * * cd /path/to/livesync-backup && docker compose run --rm livesync-backup >> ./backup.log 2>&1
```

## Self-Signed Certificates

If your CouchDB uses a self-signed SSL certificate, you have two options:

### Option 1: Provide your CA certificate (recommended)

Add these to your `.env`:

```bash
CA_CERT_HOST=/path/to/your/ca-certificate.pem
CA_CERT=/app/certs/ca.pem
```

The certificate will be mounted into the container and used for proper TLS verification.

### Option 2: Skip certificate verification

If no `CA_CERT` is configured, the tool automatically skips TLS verification. This is less secure but works out of the box.

## How It Works

1. Connects to CouchDB and fetches all file entries
2. Retrieves content chunks (LiveSync splits files into chunks for efficient syncing)
3. Decrypts chunks using your E2EE passphrase (or passes through plaintext for unencrypted files)
4. Reassembles files and writes to a temp directory
5. Creates a timestamped zip archive (e.g., `obsidian-2024-01-15.zip`)
6. Moves archive to your backup destination
7. Deletes backups older than retention period

## Safety

This tool is designed with safety as a top priority:

### What it will NEVER do:
- **Delete your notes** - Read-only access to CouchDB; no write or delete operations
- **Write outside backup directory** - Path traversal attacks are blocked
- **Delete non-backup files** - Only files matching `obsidian-YYYY-MM-DD.zip` can be pruned
- **Delete directories** - Only regular files are considered for pruning

### Safety features:
- **Path validation** - All file paths are validated before writing
- **Strict filename pattern** - Backup pruning uses exact regex matching
- **Dry run mode** - Preview all operations before running
- **Comprehensive test suite** - 35+ tests verify safety guarantees

## Testing

Run the test suite to verify safety guarantees:

```bash
# Run tests in Docker
docker compose run --rm --user root --entrypoint deno livesync-backup test --allow-read --allow-write --allow-env src/tests/

# Or locally with Deno
deno test --allow-read --allow-write --allow-env src/tests/
```

Tests cover:
- Path traversal prevention
- Absolute path rejection
- Null byte injection prevention
- Backup filename pattern validation
- Retention period enforcement
- Subdirectory traversal prevention

## Project Structure

```
livesync-backup/
├── src/
│   ├── main.ts        # Entry point and orchestration
│   ├── config.ts      # Configuration loading
│   ├── crypto.ts      # AES-256-GCM decryption (V2 format)
│   ├── couchdb.ts     # CouchDB client
│   ├── extractor.ts   # Chunk reassembly and file writing
│   ├── backup.ts      # Zip creation and pruning
│   ├── path_safety.ts # Path validation utilities
│   └── tests/         # Test suite
├── Dockerfile
├── docker-compose.yml
├── entrypoint.sh      # Handles CA cert vs insecure TLS
├── deno.json
└── .env.example
```

## Technical Details

### Encryption

LiveSync uses AES-256-GCM encryption with:
- Key derivation: PBKDF2-SHA256 (310,000 iterations) + HKDF-SHA256
- V2 format: `%` prefix + hex(iv[16]) + hex(salt[16]) + base64(ciphertext + tag[16])

The tool handles both V2 encrypted chunks and plaintext (for files created before E2EE was enabled).

### CouchDB Document Structure

- **File entries**: `_id` is the file path, contains `children[]` array pointing to chunks
- **Leaf chunks**: `_id` is `h:{content-hash}`, contains encrypted `data` field

## Troubleshooting

### "Cannot connect to CouchDB: 400"
Your CouchDB is using HTTPS but you specified `http://`. Change to `https://`.

### "invalid peer certificate: UnknownIssuer"
Self-signed certificate issue. The Docker image handles this automatically, but if running locally, use:
```bash
deno run --unsafely-ignore-certificate-errors ...
```

### Many files fail with "Not V2 encrypted data"
These are files created before you enabled E2EE, or files that weren't encrypted. Update to the latest version which handles plaintext chunks.

### "Database not found"
Check your `COUCHDB_DATABASE` value matches the actual database name in Fauxton.

## License

MIT
