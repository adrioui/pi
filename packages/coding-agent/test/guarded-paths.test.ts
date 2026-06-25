/**
 * Tests for guarded paths module.
 */

import { describe, expect, it } from "vitest";
import {
	checkInputForGuardedPaths,
	GUARDED_PATH_PATTERNS,
	isGuardedPath,
} from "../src/core/permissions/guarded-paths.ts";

describe("guarded-paths", () => {
	describe("GUARDED_PATH_PATTERNS", () => {
		it("includes env file patterns", () => {
			expect(GUARDED_PATH_PATTERNS).toContain("**/.env*");
		});

		it("does not include git internals", () => {
			expect(GUARDED_PATH_PATTERNS).not.toContain("**/.git/**");
		});

		it("includes SSH configs", () => {
			expect(GUARDED_PATH_PATTERNS).toContain("**/.ssh/**");
		});

		it("includes GPG configs", () => {
			expect(GUARDED_PATH_PATTERNS).toContain("**/.gnupg/**");
		});

		it("includes Kubernetes configs", () => {
			expect(GUARDED_PATH_PATTERNS).toContain("**/.kube/**");
		});

		it("includes agent config directories", () => {
			expect(GUARDED_PATH_PATTERNS).toContain("**/.claude/**");
			expect(GUARDED_PATH_PATTERNS).toContain("**/.codex/**");
			expect(GUARDED_PATH_PATTERNS).toContain("**/.cursor/**");
			expect(GUARDED_PATH_PATTERNS).toContain("**/.windsurf/**");
			expect(GUARDED_PATH_PATTERNS).toContain("**/.amp/**");
		});

		it("includes system directories", () => {
			expect(GUARDED_PATH_PATTERNS).toContain("/etc/**");
			expect(GUARDED_PATH_PATTERNS).toContain("/usr/**");
			expect(GUARDED_PATH_PATTERNS).toContain("/var/**");
			expect(GUARDED_PATH_PATTERNS).toContain("/opt/**");
		});
	});

	describe("isGuardedPath", () => {
		it("detects .env files", () => {
			const result = isGuardedPath("/home/user/project/.env");
			expect(result).not.toBeNull();
			expect(result!.pattern).toBe("**/.env*");
			expect(result!.isGuarded).toBe(true);
		});

		it("detects .env.local", () => {
			const result = isGuardedPath("/home/user/project/.env.local");
			expect(result).not.toBeNull();
		});

		it("detects .env.production", () => {
			const result = isGuardedPath("/home/user/project/.env.production");
			expect(result).not.toBeNull();
		});

		it("does not guard .git internals", () => {
			const result = isGuardedPath("/home/user/repo/.git/config");
			expect(result).toBeNull();
		});

		it("does not guard nested .git objects", () => {
			const result = isGuardedPath("/home/user/repo/.git/objects/ab/12345");
			expect(result).toBeNull();
		});

		it("detects SSH configs", () => {
			const result = isGuardedPath("/home/user/.ssh/id_rsa");
			expect(result).not.toBeNull();
		});

		it("detects GPG configs", () => {
			const result = isGuardedPath("/home/user/.gnupg/secring.gpg");
			expect(result).not.toBeNull();
		});

		it("detects Kubernetes configs", () => {
			const result = isGuardedPath("/home/user/.kube/config");
			expect(result).not.toBeNull();
		});

		it("detects .claude directory", () => {
			const result = isGuardedPath("/home/user/.claude/settings.json");
			expect(result).not.toBeNull();
		});

		it("detects .codex directory", () => {
			const result = isGuardedPath("/home/user/.codex/config.json");
			expect(result).not.toBeNull();
		});

		it("detects system /etc paths", () => {
			const result = isGuardedPath("/etc/passwd");
			expect(result).not.toBeNull();
		});

		it("detects system /var paths", () => {
			const result = isGuardedPath("/var/log/syslog");
			expect(result).not.toBeNull();
		});

		it("does not treat /var/home user directories as system paths", () => {
			const result = isGuardedPath("/var/home/user/project/src/index.ts");
			expect(result).toBeNull();
		});

		it("returns null for safe paths", () => {
			const result = isGuardedPath("/home/user/project/src/index.ts");
			expect(result).toBeNull();
		});

		it("returns null for current dir relative paths", () => {
			const result = isGuardedPath("src/main.ts");
			expect(result).toBeNull();
		});

		it("handles backslash paths (Windows)", () => {
			const result = isGuardedPath("C:\\Users\\user\\.env");
			expect(result).not.toBeNull();
		});
	});

	describe("checkInputForGuardedPaths", () => {
		it("detects guarded paths in 'path' key", () => {
			const result = checkInputForGuardedPaths({ path: "/home/user/.env" });
			expect(result).not.toBeNull();
		});

		it("detects guarded paths in 'filePath' key", () => {
			const result = checkInputForGuardedPaths({ filePath: "/home/user/.ssh/id_rsa" });
			expect(result).not.toBeNull();
		});

		it("returns null for safe file paths", () => {
			const result = checkInputForGuardedPaths({ path: "src/index.ts" });
			expect(result).toBeNull();
		});

		it("returns null when no path keys exist", () => {
			const result = checkInputForGuardedPaths({ command: "ls -la" });
			expect(result).toBeNull();
		});
	});
});
