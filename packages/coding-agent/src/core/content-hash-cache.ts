/**
 * Content Hash Caching - Phase 8
 *
 * Implements SHA-256 content hashing for AGENTS.md files to avoid
 * re-sending unchanged guidance to the model. Reduces context window usage
 * and token costs by only updating guidance when content actually changes.
 *
 * Features:
 * - SHA-256 hashing of AGENTS.md content
 * - Cache of file path -> hash -> content
 * - Quick change detection: compare hashes before loading content
 * - Integration with resource loader for cache-aware reloads
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export interface ContentHashEntry {
	/** File path */
	path: string;
	/** SHA-256 hash of file content */
	hash: string;
	/** Last modification time */
	mtime: number;
	/** File size in bytes */
	size: number;
}

export interface ContentHashCache {
	/** Cache entries keyed by file path */
	entries: Map<string, ContentHashEntry>;
	/** Cache of content keyed by hash (for deduplication) */
	contentByHash: Map<string, string>;
}

/**
 * Compute SHA-256 hash of a string.
 */
export function computeContentHash(content: string): string {
	return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Get file metadata and compute its content hash.
 * Returns null if file doesn't exist or is unreadable.
 */
export function hashFile(filePath: string): ContentHashEntry | null {
	if (!existsSync(filePath)) {
		return null;
	}

	try {
		const content = readFileSync(filePath, "utf-8");
		const stats = statSync(filePath);
		const hash = computeContentHash(content);

		return {
			path: filePath,
			hash,
			mtime: stats.mtimeMs,
			size: stats.size,
		};
	} catch {
		return null;
	}
}

/**
 * Create a new content hash cache.
 */
export function createContentHashCache(): ContentHashCache {
	return {
		entries: new Map(),
		contentByHash: new Map(),
	};
}

/**
 * Check if a file has changed since it was last cached.
 * Returns true if the file is new, modified, or not in cache.
 */
export function hasFileChanged(cache: ContentHashCache, filePath: string): boolean {
	const currentEntry = hashFile(filePath);
	if (!currentEntry) {
		// File doesn't exist or is unreadable
		return cache.entries.has(filePath);
	}

	const cachedEntry = cache.entries.get(filePath);
	if (!cachedEntry) {
		return true; // Not in cache
	}

	// Quick check: if mtime and size are the same, content is likely the same
	if (cachedEntry.mtime === currentEntry.mtime && cachedEntry.size === currentEntry.size) {
		return false;
	}

	// Full check: compare hashes
	return cachedEntry.hash !== currentEntry.hash;
}

/**
 * Update the cache with a file's current state.
 * Returns the content (either from cache or freshly read).
 */
export function updateCache(cache: ContentHashCache, filePath: string): string | null {
	const currentEntry = hashFile(filePath);
	if (!currentEntry) {
		// Remove from cache if file no longer exists
		cache.entries.delete(filePath);
		return null;
	}

	cache.entries.set(filePath, currentEntry);

	// Only store content if hash is new (deduplication)
	if (!cache.contentByHash.has(currentEntry.hash)) {
		try {
			const content = readFileSync(filePath, "utf-8");
			cache.contentByHash.set(currentEntry.hash, content);
		} catch {
			return null;
		}
	}

	return cache.contentByHash.get(currentEntry.hash) || null;
}

/**
 * Get cached content for a file if it hasn't changed.
 * Returns null if file not in cache or has changed.
 */
export function getCachedContent(cache: ContentHashCache, filePath: string): string | null {
	const entry = cache.entries.get(filePath);
	if (!entry) {
		return null;
	}

	if (hasFileChanged(cache, filePath)) {
		return null;
	}

	return cache.contentByHash.get(entry.hash) || null;
}

/**
 * Batch update: hash multiple files and update cache.
 * Returns a map of path -> content for files that changed or are new.
 */
export function batchUpdateCache(cache: ContentHashCache, filePaths: string[]): Map<string, string> {
	const changedFiles = new Map<string, string>();

	for (const filePath of filePaths) {
		const cachedContent = getCachedContent(cache, filePath);
		const currentEntry = hashFile(filePath);

		if (!currentEntry) {
			// File no longer exists
			cache.entries.delete(filePath);
			continue;
		}

		if (!cachedContent) {
			// File is new or changed
			const content = updateCache(cache, filePath);
			if (content) {
				changedFiles.set(filePath, content);
			}
		} else {
			// File unchanged, no need to reload
		}
	}

	return changedFiles;
}

/**
 * Discover AGENTS.md files from cwd to root and hash them.
 * Returns a map of path -> content hash entry.
 */
export function hashAgentsFiles(cwd: string): Map<string, ContentHashEntry> {
	const entries = new Map<string, ContentHashEntry>();
	const candidates = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

	let currentDir = cwd;
	const root = resolve("/");

	while (true) {
		for (const filename of candidates) {
			const filePath = join(currentDir, filename);
			const entry = hashFile(filePath);
			if (entry) {
				entries.set(filePath, entry);
			}
		}

		if (currentDir === root) break;
		const parentDir = resolve(currentDir, "..");
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	return entries;
}

/**
 * Compare two sets of file hashes to detect changes.
 * Returns true if any file was added, removed, or modified.
 */
export function hashesChanged(
	oldHashes: Map<string, ContentHashEntry>,
	newHashes: Map<string, ContentHashEntry>,
): boolean {
	if (oldHashes.size !== newHashes.size) {
		return true;
	}

	for (const [path, newEntry] of newHashes) {
		const oldEntry = oldHashes.get(path);
		if (!oldEntry || oldEntry.hash !== newEntry.hash) {
			return true;
		}
	}

	return false;
}
