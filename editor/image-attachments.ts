import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { homedir, tmpdir } from "os";

/**
 * Text-token image attachments for the BoxEditor (the Claude Code model), backed by a durable store.
 *
 * Paste flow: the host clipboard-image branch calls `editor.insertTextAtCursor(<tmpdir>/
 * pi-clipboard-<uuid>.<ext>)`; BoxEditor diverts that call here — the bytes are copied immediately
 * to `<session dir>/images/<N>.<ext>`, the tmp file is deleted, and a literal `[Image #N] `
 * token goes into the text buffer. A pasted image *file* path (host Ctrl+V with a file on the
 * clipboard, or a terminal paste of a copied file) takes the same route but keeps the source.
 * Because the token is plain text, arrow-key history, Backspace
 * deletion, and moving/copying the reference all work with zero custom key routing.
 *
 * Numbering: ids are globally monotonic and NEVER reused — the serial is seeded from a disk scan
 * at process start (`max(existing ids) + 1`). Pi's /resume re-renders the persisted transcript, so
 * a `[Image #7]` in a week-old message must never collide with a new paste.
 *
 * Two registries over the same store:
 * - the edit registry (ImageAttachmentList, newest 16): powers submit-time re-send
 * - the global link table (module map): powers OSC 8 hyperlinks in rendered history
 * Both are rebuilt from disk on startup; only the startup sweep (files older than
 * IMAGE_DISK_RETENTION_DAYS, always keeping the newest so the serial survives) ever deletes files.
 * Submit consumes nothing; /tmp is a pass-through, never a dependency.
 */

export interface ImageAttachment {
	/** Token number: the N in `[Image #N]`. Globally monotonic, never reused. */
	id: string;
	/** Persisted file in the store — the single source of truth. */
	path: string;
	mimeType: string;
	bytes: number;
	/** Friendly display name (`pasted-image-<n>.<ext>`). */
	label: string;
}

export interface ImageContentLike {
	type: "image";
	data: string;
	mimeType: string;
}

export interface TokenResolution {
	/** Text with resolved tokens stripped (kept for tests/tooling; the submit path keeps tokens). */
	cleanText: string;
	/** Attachments referenced by at least one token, in first-reference order. */
	referenced: ImageAttachment[];
	/** Attachments no token references. */
	orphans: ImageAttachment[];
}

const IMAGE_EXTENSION_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
};

const HOST_CLIPBOARD_IMAGE_NAME_RE =
	/^pi-clipboard-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp|bmp)$/i;

const PERSISTED_IMAGE_NAME_RE = /^(\d+)\.(png|jpe?g|gif|webp|bmp)$/i;

/** Single source of truth for the `[Image #N]` token syntax shared by all consumers. */
export const IMAGE_TOKEN_RE = /\[Image #(\d+)\]/g;
/** Internal placeholder used while collapsing spacing around removed tokens. */
const TOKEN_SENTINEL = "\u0000";

/**
 * Durable store; the filename IS the index (`<id>.<ext>`), no metadata file. The store lives with
 * the session directory for the current cwd (Pi groups sessions under
 * `~/.pi/agent/sessions/--<cwd>--/`), so images share the sessions' lifecycle: deleting a project's
 * session directory takes its images along, fork/resume within the same cwd share one store, and
 * different projects never see each other's ids (all resolution is scoped to the current store).
 */
let persistedImageDir = join(homedir(), ".pi", "agent", "droid-images");
/** Edit-registry depth: how many attachments stay re-sendable from history. */
export const IMAGE_ATTACHMENT_RETENTION = 16;
/** Disk bound: the startup sweep deletes store files older than N days (mtime). */
export const IMAGE_DISK_RETENTION_DAYS = 7;

let attachmentSerial = 0;
let diskScanned = false;

/**
 * Point the store at a session directory (called by BoxEditor with `<sessionDir>/images`).
 * Resets the one-shot scan so the registries rebuild against the new location.
 */
export function setImageStoreDir(dir: string): void {
	if (dir === persistedImageDir) return;
	persistedImageDir = dir;
	diskScanned = false;
	globalImageLinks.clear();
	attachmentSerial = 0;
}

/** id → persisted path, used to hyperlink tokens in rendered history. */
const globalImageLinks = new Map<string, string>();

export function getGlobalImageLink(tokenId: string): string | undefined {
	return globalImageLinks.get(tokenId);
}

/** True for temp files produced by the host clipboard-image branch (uuid name + image extension). */
export function isHostClipboardImagePath(filePath: string): boolean {
	if (typeof filePath !== "string" || filePath.length === 0) return false;
	if (dirname(filePath) !== tmpdir()) return false;
	return HOST_CLIPBOARD_IMAGE_NAME_RE.test(basename(filePath));
}

/**
 * The image file a paste refers to, or null. Accepts one path as the host's Ctrl+V file branch
 * inserts it (raw), or as a terminal pastes a copied file (shell-escaped `\ ` or quoted). The
 * file must exist and carry an image extension; anything else stays plain text.
 */
export function pastedImageFilePath(text: string): string | null {
	if (typeof text !== "string") return null;
	let candidate = text.trim();
	if (!candidate || candidate.includes("\n")) return null;
	const quoted = /^(['"])(.*)\1$/.exec(candidate);
	candidate = quoted ? quoted[2]! : candidate.replace(/\\(.)/g, "$1");
	if (candidate.startsWith("~/")) candidate = join(homedir(), candidate.slice(2));
	if (!candidate.startsWith("/") || !inferMime(candidate)) return null;
	try {
		statSync(candidate);
		return candidate;
	} catch {
		return null;
	}
}

/** Inputs that must keep the host submit path (slash commands, `!` bash mode). */
export function isCommandLikeInput(text: string): boolean {
	const first = text.trimStart();
	return first.startsWith("/") || first.startsWith("!");
}

function inferMime(filePath: string): string | undefined {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTENSION_MIME[ext];
}

interface PersistedEntry {
	id: string;
	ext: string;
	path: string;
	bytes: number;
	mtimeMs: number;
}

function parsePersistedName(name: string): { id: string; ext: string } | null {
	const match = PERSISTED_IMAGE_NAME_RE.exec(name);
	if (!match) return null;
	// Normalize away leading zeros so the map key matches the runtime id format.
	return { id: String(Number(match[1])), ext: match[2].toLowerCase() };
}

function readPersistedImages(): PersistedEntry[] {
	let names: string[];
	try {
		names = readdirSync(persistedImageDir);
	} catch {
		return []; // store does not exist yet
	}
	const entries: PersistedEntry[] = [];
	for (const name of names) {
		const parsed = parsePersistedName(name);
		if (!parsed) continue;
		const path = join(persistedImageDir, name);
		try {
			const stats = statSync(path);
			entries.push({ id: parsed.id, ext: parsed.ext, path, bytes: stats.size, mtimeMs: stats.mtimeMs });
		} catch {
			// Vanished mid-scan — skip.
		}
	}
	entries.sort((a, b) => Number(a.id) - Number(b.id));
	return entries;
}

/**
 * One-time per process: scan the store, seed the serial past every existing id, sweep files
 * beyond the disk cap, and rebuild the global link table. Later calls just re-read the store
 * (so a replacement editor sees attachments pasted since startup).
 */
function scanPersistedImages(): PersistedEntry[] {
	if (diskScanned) return readPersistedImages();
	diskScanned = true;
	const entries = readPersistedImages();
	if (entries.length === 0) return entries;
	const maxId = Number(entries[entries.length - 1].id);
	if (maxId > attachmentSerial) attachmentSerial = maxId;
	// Age-based sweep: delete files older than the retention window; survivors keep their links.
	// The newest file always stays: it is what seeds the serial on the next start, so ids are never
	// handed out again after every older file has aged out.
	const cutoff = Date.now() - IMAGE_DISK_RETENTION_DAYS * 24 * 60 * 60 * 1000;
	for (let i = entries.length - 2; i >= 0; i -= 1) {
		if (entries[i].mtimeMs >= cutoff) continue;
		try {
			unlinkSync(entries[i].path);
		} catch {
			// Best effort.
		}
		entries.splice(i, 1);
	}
	for (const entry of entries) globalImageLinks.set(entry.id, entry.path);
	return entries;
}

function toAttachment(entry: PersistedEntry): ImageAttachment {
	return {
		id: entry.id,
		path: entry.path,
		mimeType: IMAGE_EXTENSION_MIME[entry.ext] ?? "image/png",
		bytes: entry.bytes,
		label: `pasted-image-${entry.id}.${entry.ext}`,
	};
}

/** Read the persisted bytes into a pi-ai ImageContent; null when the file vanished. */
export function attachmentToImageContent(attachment: ImageAttachment): ImageContentLike | null {
	try {
		const data = readFileSync(attachment.path);
		return { type: "image", data: data.toString("base64"), mimeType: attachment.mimeType };
	} catch {
		return null;
	}
}

/**
 * Resolve `[Image #N]` tokens against a set of attachments. Hits are reported in first-reference
 * order; unknown tokens (hand-typed, or swept from disk) stay as literal text. `cleanText` strips
 * hit tokens (token-only lines dropped, inline spacing collapsed) for callers that need it.
 */
export function resolveImageTokens(text: string, attachments: readonly ImageAttachment[]): TokenResolution {
	const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
	const referenced: ImageAttachment[] = [];
	let hadResolved = false;
	const stripped = text.replace(IMAGE_TOKEN_RE, (match, id: string) => {
		const attachment = byId.get(id);
		if (!attachment) return match;
		if (!referenced.includes(attachment)) referenced.push(attachment);
		hadResolved = true;
		return TOKEN_SENTINEL;
	});
	let cleanText = text;
	if (hadResolved) {
		const outLines: string[] = [];
		for (const line of stripped.split("\n")) {
			if (!line.includes(TOKEN_SENTINEL)) {
				outLines.push(line);
				continue;
			}
			if (line.replace(/\u0000/g, "").trim().length === 0) {
				continue; // token-only line: drop entirely
			}
			outLines.push(
				line
					.replace(/[ \t]*\u0000[ \t]*/g, " ")
					.replace(/\u0000/g, "")
					.replace(/[ \t]+$/g, ""),
			);
		}
		cleanText = outLines.join("\n");
	}
	const referencedSet = new Set(referenced);
	return {
		cleanText,
		referenced,
		orphans: attachments.filter((attachment) => !referencedSet.has(attachment)),
	};
}

/**
 * Replace `[Image #N]` tokens that resolve to a live attachment with the persisted file path,
 * inline (degraded text-only submits). Unknown tokens stay as literal text.
 */
export function replaceImageTokensWithPaths(text: string, attachments: readonly ImageAttachment[]): string {
	const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
	return text.replace(IMAGE_TOKEN_RE, (match, id: string) => byId.get(id)?.path ?? match);
}

/**
 * Edit-registry over the durable store. Construction restores the newest entries from disk so
 * history-recalled tokens keep resolving (and re-sending) after restart. Eviction past the cap
 * only drops re-sendability — the file and its history link stay alive until the disk sweep.
 */
export class ImageAttachmentList {
	private items: ImageAttachment[] = [];

	constructor() {
		this.items = scanPersistedImages().slice(-IMAGE_ATTACHMENT_RETENTION).map(toAttachment);
	}

	count(): number {
		return this.items.length;
	}

	list(): readonly ImageAttachment[] {
		return this.items;
	}

	/**
	 * Copy a pasted image file into the store and register it. Only the host's own temp file is
	 * deleted afterwards; a user's file is never touched. Returns null for non-images, vanished
	 * files, or persist failures — the caller then falls back to inserting the raw path.
	 */
	addFromPath(tmpPath: string): ImageAttachment | null {
		const mimeType = inferMime(tmpPath);
		if (!mimeType) return null;
		let bytes: number;
		try {
			bytes = statSync(tmpPath).size;
		} catch {
			return null;
		}
		const serial = ++attachmentSerial;
		const ext = tmpPath.split(".").pop()?.toLowerCase() ?? "png";
		const path = join(persistedImageDir, `${serial}.${ext}`);
		try {
			mkdirSync(persistedImageDir, { recursive: true });
			writeFileSync(path, readFileSync(tmpPath));
			if (isHostClipboardImagePath(tmpPath)) unlinkSync(tmpPath);
		} catch {
			return null;
		}
		const attachment: ImageAttachment = {
			id: `${serial}`,
			path,
			mimeType,
			bytes,
			label: `pasted-image-${serial}.${ext}`,
		};
		this.items.push(attachment);
		globalImageLinks.set(attachment.id, path);
		// Eviction drops re-sendability only; the file stays for history links until the disk sweep.
		const overflow = this.items.length - IMAGE_ATTACHMENT_RETENTION;
		if (overflow > 0) this.items.splice(0, overflow);
		return attachment;
	}
}
