import { describe, expect, it } from "vitest";
import { isBlockedUrl, isBlockedUrlResolved, isPrivateIp } from "../src/core/tools/web-fetch.ts";

describe("web-fetch SSRF protections", () => {
	it("detects private IPv4 and IPv6 ranges", () => {
		expect(isPrivateIp("10.0.0.1")).toBe(true);
		expect(isPrivateIp("127.0.0.1")).toBe(true);
		expect(isPrivateIp("172.16.0.1")).toBe(true);
		expect(isPrivateIp("192.168.1.1")).toBe(true);
		expect(isPrivateIp("169.254.1.1")).toBe(true);
		expect(isPrivateIp("::1")).toBe(true);
		expect(isPrivateIp("fd00::1")).toBe(true);
		expect(isPrivateIp("8.8.8.8")).toBe(false);
	});

	it("blocks encoded local IP URL forms", () => {
		expect(isBlockedUrl("http://2130706433/")).toBe(true);
		expect(isBlockedUrl("http://0x7f000001/")).toBe(true);
		expect(isBlockedUrl("http://0177.0.0.1/")).toBe(true);
		expect(isBlockedUrl("http://[::ffff:127.0.0.1]/")).toBe(true);
	});

	it("blocks local hosts before DNS resolution", async () => {
		await expect(isBlockedUrlResolved("http://localhost/")).resolves.toBe(true);
		await expect(isBlockedUrlResolved("file:///tmp/secret")).resolves.toBe(true);
	});
});
