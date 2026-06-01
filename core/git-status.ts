import { spawn } from "node:child_process";

export interface GitBranchStatus {
	branch: string;
	insertions?: number;
	deletions?: number;
}

export type GitBranchFetcher = () => GitBranchStatus | null;

const BRANCH_FETCH_INTERVAL_MS = 5000;
const GIT_COMMAND_TIMEOUT_MS = 1000;

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
			p.on("close", (code: number) => finish(code === 0 ? chunks.join("").trim() : ""));
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
			previous?.deletions !== next?.deletions
		) {
			onUpdate?.();
		}
	}

	async function refreshBranch(): Promise<void> {
		try {
			const [branch, stat] = await Promise.all([
				runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
				runGit(cwd, ["diff", "--shortstat"]),
			]);
			if (!branch) {
				setCachedBranch(null);
				return;
			}
			const insMatch = stat.match(/(\d+) insertion/);
			const delMatch = stat.match(/(\d+) deletion/);
			const insertions = insMatch ? parseInt(insMatch[1], 10) : 0;
			const deletions = delMatch ? parseInt(delMatch[1], 10) : 0;
			setCachedBranch({ branch, insertions: insertions || undefined, deletions: deletions || undefined });
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
