export interface SessionMetadata {
	id?: string;
	name?: string;
}

function cleanString(value: unknown): string | undefined {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const text = String(value).replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
	return text || undefined;
}

function firstString(source: Record<string, unknown> | undefined, keys: string[]): string | undefined {
	if (!source) return undefined;
	for (const key of keys) {
		const value = cleanString(source[key]);
		if (value) return value;
	}
	return undefined;
}

function callString(source: Record<string, unknown> | undefined, key: string): string | undefined {
	const fn = source?.[key];
	if (typeof fn !== "function") return undefined;
	try {
		return cleanString(fn.call(source));
	} catch {
		return undefined;
	}
}

export function readSessionMetadata(ctx: unknown): SessionMetadata {
	const root = ctx && typeof ctx === "object" ? ctx as Record<string, unknown> : undefined;
	const sessionManager = root?.sessionManager && typeof root.sessionManager === "object"
		? root.sessionManager as Record<string, unknown>
		: undefined;
	const nestedCandidates = [
		sessionManager,
		root?.session,
		root?.sessionInfo,
		root?.session_info,
		root?.conversation,
	].filter((value): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value));
	const candidates = [root, ...nestedCandidates];
	const idKeys = ["sessionId", "sessionID", "session_id", "id"];
	const nameKeys = ["sessionName", "session_name", "name", "title"];
	return {
		id: callString(sessionManager, "getSessionId") ?? candidates.map((candidate) => firstString(candidate, idKeys)).find(Boolean),
		name: callString(sessionManager, "getSessionName") ?? candidates.map((candidate) => firstString(candidate, nameKeys)).find(Boolean),
	};
}
