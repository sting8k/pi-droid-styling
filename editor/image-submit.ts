import { attachmentToImageContent, replaceImageTokensWithPaths, type ImageAttachment, type ImageContentLike } from "./image-attachments.js";

/**
 * Hybrid image submit, extracted from index.ts so the orchestrator stays thin and the policy is
 * unit-testable. Real ImageContent parts when the active model accepts image input; appended path
 * text otherwise (read-tool compatible). Temp files are never removed here — they survive so
 * history-recalled tokens can re-send; FIFO eviction and session shutdown own cleanup.
 */

export type ImageSubmitContent = { type: "text"; text: string } | ImageContentLike;

export interface ImageSubmitDeps {
	/** Current model input modalities; undefined means unknown/stale (degrade to path text). */
	getModelInputModalities: () => string[] | undefined;
	sendUserMessage: (content: ImageSubmitContent[]) => void;
}

function modalitiesIncludeImage(input: string[] | undefined): boolean {
	return Array.isArray(input) && input.includes("image");
}

export function submitEditorImages(deps: ImageSubmitDeps, text: string, attachments: readonly ImageAttachment[]): void {
	const contents: ImageSubmitContent[] = [];
	if (modalitiesIncludeImage(deps.getModelInputModalities())) {
		const images = attachments
			.map((attachment) => attachmentToImageContent(attachment))
			.filter((image): image is NonNullable<typeof image> => image !== null);
		if (images.length > 0) {
			contents.push({ type: "text", text }, ...images);
			deps.sendUserMessage(contents);
			return;
		}
		// Every temp file vanished — degrade to path text below.
	}
	// Degraded path: tokens resolve to their temp-file paths inline, so the conversation
	// history still shows exactly where each image was referenced.
	contents.push({ type: "text", text: replaceImageTokensWithPaths(text, attachments) });
	deps.sendUserMessage(contents);
}
