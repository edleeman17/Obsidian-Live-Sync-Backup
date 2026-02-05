/**
 * Path Safety Module
 *
 * Provides functions to validate and sanitize file paths to prevent:
 * - Path traversal attacks (../)
 * - Absolute path injection
 * - Null byte injection
 * - Writing outside intended directories
 */

import { join, normalize, isAbsolute } from "https://deno.land/std@0.208.0/path/mod.ts";

/**
 * Check if a path is safe to use within a base directory.
 *
 * A path is considered safe if:
 * - It's not empty or just "." or ".."
 * - It doesn't contain null bytes
 * - It's not an absolute path
 * - After normalization, it doesn't escape the base directory
 */
export function isPathSafe(filePath: string, baseDir: string): boolean {
  // Reject empty paths
  if (!filePath || filePath.trim() === "") {
    return false;
  }

  // Reject paths with null bytes (potential injection attack)
  if (filePath.includes("\x00")) {
    return false;
  }

  // Reject standalone . or ..
  if (filePath === "." || filePath === "..") {
    return false;
  }

  // Normalize backslashes to forward slashes for cross-platform safety
  const normalizedInput = filePath.replace(/\\/g, "/");

  // Reject absolute paths
  if (isAbsolute(normalizedInput) || normalizedInput.startsWith("/")) {
    return false;
  }

  // Check for Windows absolute paths (C:\, D:\, etc.)
  if (/^[a-zA-Z]:/.test(normalizedInput)) {
    return false;
  }

  // Normalize the path and check it stays within base
  const fullPath = normalize(join(baseDir, normalizedInput));
  const normalizedBase = normalize(baseDir);

  // The resolved path must start with the base directory
  if (!fullPath.startsWith(normalizedBase)) {
    return false;
  }

  // Additional check: the path after base must not be empty (would mean it IS the base)
  const relativePart = fullPath.slice(normalizedBase.length);
  if (relativePart === "" && normalizedInput !== "") {
    return false;
  }

  return true;
}

/**
 * Sanitize a path for safe filesystem operations.
 * This does NOT make an unsafe path safe - use isPathSafe() to validate first.
 *
 * This function:
 * - Trims whitespace
 * - Normalizes slashes
 * - Collapses multiple slashes
 */
export function sanitizePath(filePath: string): string {
  return filePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
}

/**
 * Validate and return a safe path, or throw an error.
 * Use this when you want to fail loudly on unsafe paths.
 */
export function requireSafePath(filePath: string, baseDir: string): string {
  if (!isPathSafe(filePath, baseDir)) {
    throw new Error(`Unsafe path rejected: ${filePath}`);
  }
  return sanitizePath(filePath);
}
