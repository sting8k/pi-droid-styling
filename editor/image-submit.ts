import {
	attachmentToImageContent,
	isCommandLikeInput,
	replaceImageTokensWithPaths,
	resolveImageTokens,
	type ImageAttachment,
	type ImageContentLike,
} from "./image-attachments.js";

/**
 * Hybrid image submit as a Pi `input` event policy, extracted from index.ts so the orchestrator
 * stays thin and the policy is unit-testable. It runs inside the host's own submit, so Pi keeps
 * owning input history, steer/follow-up queueing while streaming, the compaction queue, and
 * slash/bash routing. Real ImageContent parts when the active model accepts image input; tokens
 * replaced inline by their persisted file paths otherwise (read-tool compatible).
 */

export type ImageInputResult =
	| { action: "continue" }
	| { action: "transform"; text: string; images?: ImageContentLike[] };

function modalitiesIncludeImage(input: readonly string[] | undefined): boolean {
	return Array.isArray(input) && input.includes("image");
}

/**
 * Resolve `[Image #N]` tokens in submitted text. Tokens stay in the sent text (positional
 * references for the model and the conversation); unknown tokens stay literal.
 */
export function attachEditorImages(
	text: string,
	existingImages: readonly ImageContentLike[] | undefined,
	attachments: readonly ImageAttachment[],
	modelInput: readonly string[] | undefined,
): ImageInputResult {
	if (isCommandLikeInput(text)) return { action: "continue" };
	const { referenced } = resolveImageTokens(text, attachments);
	if (referenced.length === 0) return { action: "continue" };
	if (modalitiesIncludeImage(modelInput)) {
		const images = referenced
			.map((attachment) => attachmentToImageContent(attachment))
			.filter((image): image is ImageContentLike => image !== null);
		if (images.length > 0) return { action: "transform", text, images: [...(existingImages ?? []), ...images] };
		// Every persisted file vanished: degrade to path text below.
	}
	return { action: "transform", text: replaceImageTokensWithPaths(text, referenced) };
}
