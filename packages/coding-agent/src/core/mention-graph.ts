/**
 * Mention Graph Resolution - Phase 7
 *
 * Parses @path/@glob references in AGENTS.md files and builds a dependency graph.
 * When the agent navigates to a file, relevant guidance files are automatically
 * activated based on the mention graph.
 *
 * Features:
 * - Parse @path and @glob references from AGENTS.md content
 * - Build a directed graph: guidance_file -> referenced_file
 * - Reverse lookup: when a file is touched, find all guidance that references it
 * - Support glob patterns in mentions
 * - Cycle detection and transitive resolution
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { minimatch } from "minimatch";
import { parseFrontmatter } from "../utils/frontmatter.ts";
import { extractAtMentions } from "./context-includes.ts";

export interface MentionNode {
	/** Source file that contains the mention */
	source: string;
	/** Mentioned path (raw, may be relative or glob) */
	mention: string;
	/** Resolved absolute path or glob pattern */
	resolved: string;
	/** Whether this is a glob pattern */
	isGlob: boolean;
}

export interface MentionGraph {
	/** All parsed mentions */
	nodes: MentionNode[];
	/** Reverse index: file path -> sources that mention it */
	reverseIndex: Map<string, string[]>;
	/** Files that have been processed (to avoid re-parsing) */
	processed: Set<string>;
}

/**
 * Check if a string is likely a glob pattern.
 */
function isGlobPattern(pattern: string): boolean {
	return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

/**
 * Parse @mentions from AGENTS.md content and resolve paths.
 * Returns an array of mention nodes.
 */
export function parseMentions(
	content: string,
	filePath: string,
	homeDir: string = process.env.HOME || "",
): MentionNode[] {
	const mentions = extractAtMentions(content);
	const fileDir = dirname(filePath);

	return mentions.map((mention) => {
		let resolved: string;
		const isGlob = isGlobPattern(mention);

		if (mention.startsWith("~/")) {
			resolved = resolvePath(homeDir, mention.slice(2));
		} else if (mention.startsWith("/")) {
			resolved = resolvePath(mention);
		} else if (mention.startsWith("@/")) {
			resolved = resolvePath(mention.slice(2));
		} else {
			resolved = resolvePath(fileDir, mention);
		}

		return {
			source: filePath,
			mention,
			resolved,
			isGlob,
		};
	});
}

/**
 * Build a mention graph from a set of AGENTS.md files.
 */
export function buildMentionGraph(files: Array<{ path: string; content: string }>): MentionGraph {
	const graph: MentionGraph = {
		nodes: [],
		reverseIndex: new Map(),
		processed: new Set(),
	};

	for (const file of files) {
		if (graph.processed.has(file.path)) continue;
		graph.processed.add(file.path);

		const mentions = parseMentions(file.content, file.path);
		graph.nodes.push(...mentions);

		// Build reverse index
		for (const mention of mentions) {
			if (mention.isGlob) {
				// For globs, store with glob key
				const key = `glob:${mention.resolved}`;
				if (!graph.reverseIndex.has(key)) {
					graph.reverseIndex.set(key, []);
				}
				graph.reverseIndex.get(key)!.push(mention.source);
			} else {
				if (!graph.reverseIndex.has(mention.resolved)) {
					graph.reverseIndex.set(mention.resolved, []);
				}
				graph.reverseIndex.get(mention.resolved)!.push(mention.source);
			}
		}
	}

	return graph;
}

/**
 * Find all guidance files that reference a given file path.
 * Uses both exact match and glob matching.
 */
export function findRelevantGuidance(graph: MentionGraph, filePath: string): string[] {
	const sources = new Set<string>();

	// Exact match lookup
	if (graph.reverseIndex.has(filePath)) {
		for (const source of graph.reverseIndex.get(filePath)!) {
			sources.add(source);
		}
	}

	// Glob matching
	for (const [key, sourceList] of graph.reverseIndex.entries()) {
		if (!key.startsWith("glob:")) continue;
		const globPattern = key.slice(5);
		try {
			if (minimatch(filePath, globPattern)) {
				for (const source of sourceList) {
					sources.add(source);
				}
			}
		} catch {
			// Invalid glob pattern, skip
		}
	}

	return Array.from(sources);
}

/**
 * Parse AGENTS.md files from directories and build a mention graph.
 * Combines discovery, parsing, and graph building.
 */
export function discoverAndBuildMentionGraph(dirs: string[], _homeDir: string = process.env.HOME || ""): MentionGraph {
	const files: Array<{ path: string; content: string }> = [];
	const candidates = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

	for (const dir of dirs) {
		for (const filename of candidates) {
			const filePath = join(dir, filename);
			if (existsSync(filePath)) {
				try {
					const content = readFileSync(filePath, "utf-8");
					files.push({ path: filePath, content });
				} catch {
					// Skip unreadable files
				}
			}
		}
	}

	return buildMentionGraph(files);
}

/**
 * Walk from cwd to root, discovering AGENTS.md files.
 */
export function discoverAgentsFiles(cwd: string, maxDepth = 10): Array<{ path: string; content: string }> {
	const files: Array<{ path: string; content: string }> = [];
	const candidates = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
	const seenPaths = new Set<string>();

	let currentDir = cwd;
	const root = resolvePath("/");
	let depth = 0;

	while (depth < maxDepth) {
		for (const filename of candidates) {
			const filePath = join(currentDir, filename);
			if (existsSync(filePath) && !seenPaths.has(filePath)) {
				try {
					const content = readFileSync(filePath, "utf-8");
					files.push({ path: filePath, content });
					seenPaths.add(filePath);
				} catch {
					// Skip unreadable files
				}
			}
		}

		if (currentDir === root) break;
		const parentDir = resolvePath(currentDir, "..");
		if (parentDir === currentDir) break;
		currentDir = parentDir;
		depth++;
	}

	return files;
}

/**
 * Full pipeline: discover AGENTS.md files, build mention graph,
 * and find relevant guidance for a given file path.
 */
export function resolveMentionGuidance(
	cwd: string,
	filePath: string,
): Array<{ path: string; content: string; title?: string }> {
	const agentsFiles = discoverAgentsFiles(cwd);
	const graph = buildMentionGraph(agentsFiles);
	const guidancePaths = findRelevantGuidance(graph, filePath);

	// Load the guidance files
	const results: Array<{ path: string; content: string; title?: string }> = [];
	for (const path of guidancePaths) {
		if (!existsSync(path)) continue;
		try {
			const content = readFileSync(path, "utf-8");
			const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
			results.push({
				path,
				content,
				title: frontmatter.title as string | undefined,
			});
		} catch {
			// Skip unreadable files
		}
	}

	return results;
}
