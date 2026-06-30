import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import {
	StreamingFieldParser,
	typeboxToStreamingSchema,
	validatePartialAgainstSchema,
} from "../src/streaming/index.ts";

describe("StreamingFieldParser", () => {
	it("parses complete JSON in one chunk", () => {
		const parser = new StreamingFieldParser();
		parser.push('{"name":"test","value":42}');
		expect(parser.partial).toEqual({ name: "test", value: 42 });
		expect(parser.valid).toBe(true);
	});

	it("parses JSON incrementally across chunks", () => {
		const parser = new StreamingFieldParser();
		parser.push('{"name":"');
		expect(parser.partial).toEqual({ name: "" });
		parser.push('test","val');
		expect(parser.partial).toEqual({ name: "test" });
		parser.push('ue":42}');
		expect(parser.partial).toEqual({ name: "test", value: 42 });
		expect(parser.valid).toBe(true);
	});

	it("handles nested objects", () => {
		const parser = new StreamingFieldParser();
		parser.push('{"outer":{"inner":"hello"}}');
		expect(parser.partial).toEqual({ outer: { inner: "hello" } });
	});

	it("handles arrays", () => {
		const parser = new StreamingFieldParser();
		parser.push('{"items":[1,2,3]}');
		expect(parser.partial).toEqual({ items: [1, 2, 3] });
	});

	it("snapshot and restore", () => {
		const parser = new StreamingFieldParser();
		parser.push('{"name":"test"');
		const snap = parser.snapshot();
		parser.push(',"extra":"data"');
		expect(parser.partial).toEqual({ name: "test", extra: "data" });
		parser.restore(snap);
		expect(parser.partial).toEqual({ name: "test" });
	});

	it("validates against schema - wrong type fails", () => {
		const schema = typeboxToStreamingSchema(Type.Object({ name: Type.String(), count: Type.Number() }));
		const result = validatePartialAgainstSchema({ count: "not a number" }, schema);
		expect(result.valid).toBe(false);
		expect(result.issue).toContain("expected type number");
	});

	it("validates against schema - missing required passes (stream incomplete)", () => {
		const schema = typeboxToStreamingSchema(Type.Object({ name: Type.String(), count: Type.Number() }));
		const result = validatePartialAgainstSchema({ name: "test" }, schema);
		expect(result.valid).toBe(true);
	});

	it("validates against schema - enum violation fails", () => {
		const schema = typeboxToStreamingSchema(
			Type.Object({ status: Type.Union([Type.Literal("active"), Type.Literal("inactive")]) }),
		);
		const result = validatePartialAgainstSchema({ status: "unknown" }, schema);
		expect(result.valid).toBe(false);
		expect(result.issue).toContain("must be one of");
	});
});

describe("typeboxToGbnf", () => {
	it("generates GBNF for simple object", () => {
		const gbnf = typeboxToStreamingSchema(Type.Object({ name: Type.String() }));
		expect(gbnf.type).toBe("object");
		expect(gbnf.children).toBeDefined();
		expect(gbnf.children![0]!.name).toBe("name");
		expect(gbnf.children![0]!.type).toBe("string");
	});
});
