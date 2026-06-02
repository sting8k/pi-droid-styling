import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface ModifiedFileEntry {
	path: string;
	insertions?: number;
	deletions?: number;
}

export interface GitBranchStatus {
	branch: string;
	insertions?: number;
	deletions?: number;
	modifiedFiles?: ModifiedFileEntry[];
}

interface ModifiedFileEntryWithMtime extends ModifiedFileEntry {
	modifiedAt: number;
	order: number;
}

interface StatusFileEntry extends ModifiedFileEntryWithMtime {
	xy: string;
}

type DiffStats = {
	insertions: number;
	deletions: number;
};

export type GitBranchFetcher = () => GitBranchStatus | null;

const BRANCH_FETCH_INTERVAL_MS = 5000;
const GIT_COMMAND_TIMEOUT_MS = 1000;
const MAX_UNTRACKED_STAT_BYTES = 1024 * 1024;
const MAX_UNTRACKED_INSERTION_STATS = 10;

function sameFileList(a: readonly ModifiedFileEntry[] | undefined, b: readonly ModifiedFileEntry[] | undefined): boolean {
	const left = a ?? [];
	const right = b ?? [];
	if (left.length !== right.length) return false;
	return left.every((value, index) => {
		const other = right[index];
		return value.path === other?.path && value.insertions === other?.insertions && value.deletions === other?.deletions;
	});
}

function runGit(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve) => {
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;

		const finish = (output: string) => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			resolve(output);
		};

		try {
			const p = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
			const chunks: string[] = [];
			p.stdout.on("data", (d: Buffer) => { chunks.push(d.toString("utf8")); });
			p.on("close", (code: number) => finish(code === 0 ? chunks.join("") : ""));
			p.on("error", () => finish(""));
			timeout = setTimeout(() => {
				try { p.kill(); } catch {}
				finish("");
			}, GIT_COMMAND_TIMEOUT_MS);
		} catch {
			finish("");
		}
	});
}

function parseShortstat(statText: string): { insertions: number; deletions: number } {
	const insMatch = statText.match(/(\d+) insertion/);
	const delMatch = statText.match(/(\d+) deletion/);
	return {
		insertions: insMatch ? parseInt(insMatch[1], 10) : 0,
		deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
	};
}

function addDiffStats(map: Map<string, DiffStats>, path: string, stats: DiffStats): void {
	const previous = map.get(path);
	map.set(path, {
		insertions: (previous?.insertions ?? 0) + stats.insertions,
		deletions: (previous?.deletions ?? 0) + stats.deletions,
	});
}

function parseNumstatPath(pathText: string): string {
	const raw = pathText.trim();
	const arrowIndex = raw.lastIndexOf(" -> ");
	if (arrowIndex !== -1) return unquoteGitPath(raw.slice(arrowIndex + 4));
	return unquoteGitPath(raw);
}

function parseNumstatMap(output: string): Map<string, DiffStats> {
	const statsByPath = new Map<string, DiffStats>();
	for (const line of output.split("\n")) {
		const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
		if (!match || match[1] === "-" || match[2] === "-") continue;
		const path = parseNumstatPath(match[3] ?? "");
		if (!path) continue;
		addDiffStats(statsByPath, path, {
			insertions: parseInt(match[1], 10) || 0,
			deletions: parseInt(match[2], 10) || 0,
		});
	}
	return statsByPath;
}

function unquoteGitPath(path: string): string {
	const trimmed = path.trim();
	if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
	try {
		return JSON.parse(trimmed) as string;
	} catch {
		return trimmed.slice(1, -1);
	}
}

function parseStatusPath(line: string): string {
	const raw = line.slice(3).trim();
	const arrowIndex = raw.lastIndexOf(" -> ");
	return unquoteGitPath(arrowIndex === -1 ? raw : raw.slice(arrowIndex + 4));
}

async function fileModifiedAt(cwd: string, path: string): Promise<number> {
	try {
		return (await stat(join(cwd, path))).mtimeMs;
	} catch {
		return 0;
	}
}

async function countUntrackedInsertions(cwd: string, path: string): Promise<{ insertions: number; deletions: number } | undefined> {
	try {
		const fullPath = join(cwd, path);
		const stats = await stat(fullPath);
		if (!stats.isFile() || stats.size > MAX_UNTRACKED_STAT_BYTES) return undefined;
		const text = await readFile(fullPath, "utf8");
		if (text.length === 0) return { insertions: 0, deletions: 0 };
		const newlineCount = text.match(/\n/g)?.length ?? 0;
		const insertions = newlineCount + (text.endsWith("\n") ? 0 : 1);
		return { insertions, deletions: 0 };
	} catch {
		return undefined;
	}
}

function diffStatsForEntry(entry: StatusFileEntry, unstagedStatsByPath: Map<string, DiffStats>, stagedStatsByPath: Map<string, DiffStats>): DiffStats | undefined {
	if (entry.xy === "??") return undefined;

	const staged = entry.xy[0] !== " " && entry.xy[0] !== "?";
	const unstaged = entry.xy[1] !== " " && entry.xy[1] !== "?";
	let insertions = 0;
	let deletions = 0;
	let matched = false;

	const add = (stats: DiffStats | undefined) => {
		if (!stats) return;
		insertions += stats.insertions;
		deletions += stats.deletions;
		matched = true;
	};

	if (staged) add(stagedStatsByPath.get(entry.path));
	if (unstaged || !staged) add(unstagedStatsByPath.get(entry.path));

	return matched ? { insertions, deletions } : undefined;
}

async function parseStatusEntries(cwd: string, status: string): Promise<StatusFileEntry[]> {
	const lines = status.split("\n").map((line) => line.trimEnd()).filter(Boolean);
	const entries = await Promise.all(lines.map(async (line, order): Promise<StatusFileEntry | null> => {
		const xy = line.slice(0, 2);
		const path = parseStatusPath(line);
		if (!path) return null;
		return {
			xy,
			path,
			modifiedAt: await fileModifiedAt(cwd, path),
			order,
		};
	}));
	return entries
		.filter((entry): entry is StatusFileEntry => entry !== null)
		.sort((a, b) => b.modifiedAt - a.modifiedAt || a.order - b.order);
}

async function parseModifiedFilesWithStats(cwd: string, status: string, unstagedNumstat: string, stagedNumstat: string): Promise<ModifiedFileEntry[]> {
	const entries = await parseStatusEntries(cwd, status);
	const unstagedStatsByPath = parseNumstatMap(unstagedNumstat);
	const stagedStatsByPath = parseNumstatMap(stagedNumstat);
	const modifiedFiles: ModifiedFileEntry[] = [];
	let untrackedStatsRemaining = MAX_UNTRACKED_INSERTION_STATS;

	for (const entry of entries) {
		let stats = diffStatsForEntry(entry, unstagedStatsByPath, stagedStatsByPath);
		if (entry.xy === "??" && untrackedStatsRemaining > 0) {
			untrackedStatsRemaining--;
			stats = await countUntrackedInsertions(cwd, entry.path);
		}
		modifiedFiles.push({
			path: entry.path,
			insertions: stats?.insertions || undefined,
			deletions: stats?.deletions || undefined,
		});
	}

	return modifiedFiles;
}

export function createGitBranchFetcher(cwd: string, onUpdate?: () => void): GitBranchFetcher {
	let cachedBranch: GitBranchStatus | null = null;
	let branchLastFetch = 0;
	let branchFetchInFlight = false;

	function setCachedBranch(next: GitBranchStatus | null): void {
		const previous = cachedBranch;
		cachedBranch = next;
		if (
			previous?.branch !== next?.branch ||
			previous?.insertions !== next?.insertions ||
			previous?.deletions !== next?.deletions ||
			!sameFileList(previous?.modifiedFiles, next?.modifiedFiles)
		) {
			onUpdate?.();
		}
	}

	async function refreshBranch(): Promise<void> {
		try {
			const [branchOutput, unstagedStat, stagedStat, status] = await Promise.all([
				runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
				runGit(cwd, ["diff", "--shortstat"]),
				runGit(cwd, ["diff", "--cached", "--shortstat"]),
				runGit(cwd, ["status", "--porcelain=v1"]),
			]);
			const branch = branchOutput.trim();
			if (!branch) {
				setCachedBranch(null);
				return;
			}
			const unstaged = parseShortstat(unstagedStat);
			const staged = parseShortstat(stagedStat);
			const hasModifiedFiles = status.trim().length > 0;
			const [unstagedNumstat, stagedNumstat] = hasModifiedFiles
				? await Promise.all([
					runGit(cwd, ["diff", "--numstat"]),
					runGit(cwd, ["diff", "--cached", "--numstat"]),
				])
				: ["", ""];
			const modifiedFiles = hasModifiedFiles ? await parseModifiedFilesWithStats(cwd, status, unstagedNumstat, stagedNumstat) : [];
			const insertions = unstaged.insertions + staged.insertions;
			const deletions = unstaged.deletions + staged.deletions;
			setCachedBranch({
				branch,
				insertions: insertions || undefined,
				deletions: deletions || undefined,
				modifiedFiles,
			});
		} finally {
			branchFetchInFlight = false;
		}
	}

	return () => {
		const now = Date.now();
		if (branchFetchInFlight || now - branchLastFetch < BRANCH_FETCH_INTERVAL_MS) return cachedBranch;
		branchFetchInFlight = true;
		branchLastFetch = now;
		void refreshBranch();
		return cachedBranch;
	};
}
