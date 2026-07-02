/**
 * Streaming JSON parsing and validation infrastructure.
 *
 * Operation-based parser with parser-level snapshot/restore rollback.
 * Validates partial JSON against Typebox schemas during streaming.
 */

export { formatCorrectiveFeedback } from "./corrective-feedback.ts";
export { type FieldDiffEvent, FieldDiffer, type FieldDiffSnapshot } from "./field-diff.ts";
export { type HandlerContext, handleToken } from "./handlers.ts";
export { type Frame, type FrameType, type MachineSnapshot, type Op, StackMachine } from "./machine.ts";
export {
	type ParserSnapshot,
	type StreamingFieldEvent,
	StreamingFieldParser,
} from "./streaming-field-parser.ts";
export { JsonTokenizer, type Token, type TokenType } from "./tokenizer.ts";
export {
	allowUnknownFieldsForStreaming,
	type StreamingSchemaField,
	typeboxToStreamingSchema,
	type ValidationState,
	validatePartialAgainstSchema,
} from "./typebox-schema-adapter.ts";
