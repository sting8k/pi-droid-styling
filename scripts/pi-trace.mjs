#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";

const args = parseArgs(process.argv.slice(2));
const sampleSeconds = Number(args["sample-sec"] ?? args.sample ?? 2);
const topLimit = Number(args.top ?? 10);
const nowStamp = new Date().toISOString().replace(/[:.]/g, "-");

main();

function main() {
	if (args.help || args.h) {
		usage();
		return;
	}

	section("pi processes by RSS");
	const processes = listPiProcesses();
	console.log(formatRows(processes.slice(0, topLimit)) || "(no pi process found)");

	const selected = selectProcess(processes);
	if (!selected) {
		console.log("\nNo process selected. Pass --pid <pid> or --cwd <substring>.");
		return;
	}

	section(`selected PID ${selected.pid}`);
	printProcessDetails(selected.pid);

	section("memory samples");
	for (let i = 0; i < 3; i++) {
		console.log(`sample ${i + 1} ${new Date().toISOString()}`);
		console.log(run("ps", ["-o", "pid,ppid,stat,rss,%cpu,%mem,etime,command", "-p", String(selected.pid)]).trim());
		if (i < 2) sleep(3000);
	}

	section("vmmap summary");
	const vmmapPath = `/tmp/pi-vmmap-${selected.pid}-${nowStamp}.txt`;
	const vmmap = run("vmmap", ["-summary", String(selected.pid)], { timeoutMs: 20000 });
	if (vmmap) writeFileSync(vmmapPath, vmmap);
	printVmmapSummary(vmmap, vmmapPath);

	section("native stack sample");
	const samplePath = `/tmp/pi-sample-${selected.pid}-${nowStamp}.txt`;
	run("sample", [String(selected.pid), String(sampleSeconds), "-file", samplePath], { timeoutMs: (sampleSeconds + 10) * 1000 });
	printSampleSummary(samplePath);

	const cwd = getCwd(selected.pid);
	if (cwd) {
		section("session jsonl summary (metadata only)");
		printSessionSummary(cwd);
	}
}

function usage() {
	console.log(`Usage:
  npm run trace:pi -- --pid <pid>
  npm run trace:pi -- --cwd pi-droid-styling
  node scripts/pi-trace.mjs --top 15

Options:
  --pid <pid>          Trace a specific pi PID.
  --cwd <substring>    Pick first pi process whose cwd contains substring.
  --top <n>            Number of pi processes to show, default 10.
  --sample-sec <n>     macOS sample duration, default 2.

The script prints process/memory/stack summaries and writes full vmmap/sample files to /tmp.
It summarizes session JSONL by role/tool/bytes only and never prints message/tool content.`);
}

function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) out[key] = true;
		else {
			out[key] = next;
			i++;
		}
	}
	return out;
}

function listPiProcesses() {
	const output = run("ps", ["-axo", "pid=,ppid=,pgid=,rss=,%cpu=,%mem=,etime=,lstart=,command="]);
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map(parsePsLine)
		.filter((p) => /(^|[\s/])pi([\s/]|$)/i.test(p.command))
		.sort((a, b) => b.rssKb - a.rssKb);
}

function parsePsLine(line) {
	const m = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.{24})\s+(.*)$/);
	if (!m) return { raw: line, pid: NaN, ppid: NaN, pgid: NaN, rssKb: 0, cpu: 0, mem: 0, etime: "", lstart: "", command: line };
	return {
		raw: line,
		pid: Number(m[1]),
		ppid: Number(m[2]),
		pgid: Number(m[3]),
		rssKb: Number(m[4]),
		cpu: Number(m[5]),
		mem: Number(m[6]),
		etime: m[7],
		lstart: m[8].trim(),
		command: m[9],
	};
}

function formatRows(rows) {
	return rows.map((p) => {
		const cwd = getCwd(p.pid);
		return `${String(p.pid).padStart(6)}  rss=${formatKb(p.rssKb).padStart(8)}  cpu=${String(p.cpu).padStart(5)}%  mem=${String(p.mem).padStart(4)}%  etime=${p.etime.padStart(10)}  cwd=${cwd || "?"}`;
	}).join("\n");
}

function selectProcess(processes) {
	if (args.pid) return processes.find((p) => p.pid === Number(args.pid)) ?? { pid: Number(args.pid), rssKb: 0, cpu: 0, mem: 0, command: "" };
	if (args.cwd) return processes.find((p) => (getCwd(p.pid) || "").includes(String(args.cwd)));
	return processes[0];
}

function printProcessDetails(pid) {
	console.log(run("ps", ["-o", "pid,ppid,pgid,stat,rss,vsz,%cpu,%mem,etime,lstart,command", "-p", String(pid)]).trim());
	console.log(`cwd: ${getCwd(pid) || "?"}`);
	console.log("parent chain:");
	let cur = pid;
	for (let depth = 0; depth < 8 && cur && cur !== 1; depth++) {
		const line = run("ps", ["-o", "pid=,ppid=,pgid=,stat=,rss=,etime=,command=", "-p", String(cur)]).trim();
		if (!line) break;
		console.log(`  ${line}`);
		const ppid = Number(run("ps", ["-o", "ppid=", "-p", String(cur)]).trim());
		cur = ppid;
	}
	const openFiles = run("bash", ["-lc", `lsof -p ${shellQuote(String(pid))} 2>/dev/null | wc -l | tr -d ' '`]).trim();
	console.log(`open_files: ${openFiles || "?"}`);
	console.log("connections:");
	console.log(run("bash", ["-lc", `lsof -nP -a -p ${shellQuote(String(pid))} -i 2>/dev/null | head -20`]).trim() || "  (none)");
}

function printVmmapSummary(vmmap, path) {
	if (!vmmap) {
		console.log("vmmap unavailable");
		return;
	}
	for (const line of vmmap.split("\n")) {
		if (/Physical footprint|Memory Tag 255\s|TOTAL\s/.test(line)) console.log(line);
	}
	console.log(`full_vmmap: ${path}`);
}

function printSampleSummary(path) {
	if (!existsSync(path)) {
		console.log("sample unavailable");
		return;
	}
	const text = readFileSync(path, "utf8");
	const terms = ["ArrayPrototypeFlatMap", "FlattenIntoArray", "Segmenter", "SegmentIterator", "RegExp", "StringPrototype", "Scavenge", "MarkCompact", "Garbage", "WriteString", "uv__io_poll", "TLSWrap", "JSON"];
	for (const term of terms) {
		const count = countOccurrences(text, term);
		if (count) console.log(`${term}: ${count}`);
	}
	for (const pattern of [/Builtins_[A-Za-z0-9_]+/g, /v8::internal::[A-Za-z0-9_:()]+/g, /node::[A-Za-z0-9_:()]+/g]) {
		console.log(`top ${pattern}: ${topMatches(text, pattern).join(", ")}`);
	}
	console.log(`full_sample: ${path}`);
}

function printSessionSummary(cwd) {
	const dir = sessionDirForCwd(cwd);
	if (!dir || !existsSync(dir)) {
		console.log(`no session dir found for cwd: ${cwd}`);
		return;
	}
	const files = readdirSync(dir)
		.filter((name) => name.endsWith(".jsonl"))
		.map((name) => join(dir, name))
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
		.slice(0, 3);
	for (const file of files) {
		console.log(`\n${basename(file)}  ${formatKb(Math.round(statSync(file).size / 1024))}  mtime=${statSync(file).mtime.toISOString()}`);
		console.log(summarizeJsonl(file));
	}
}

function summarizeJsonl(file) {
	const roleCounts = new Map();
	const roleBytes = new Map();
	const toolCounts = new Map();
	const toolBytes = new Map();
	const bigLines = [];
	const lines = readFileSync(file, "utf8").split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const lineBytes = Buffer.byteLength(line);
		let obj;
		try { obj = JSON.parse(line); } catch { continue; }
		const role = obj?.message?.role ?? obj?.role ?? "<none>";
		inc(roleCounts, role, 1);
		inc(roleBytes, role, lineBytes);
		if (lineBytes > 10000) bigLines.push({ line: i + 1, kb: Math.round(lineBytes / 102.4) / 10, role });
		walk(obj, (node) => {
			const name = node?.toolName ?? node?.tool_name;
			const nodeRole = node?.role;
			if (name && (nodeRole === "toolResult" || nodeRole === "tool")) {
				const bytes = textBytes(node.content);
				inc(toolCounts, name, 1);
				inc(toolBytes, name, bytes);
			}
		});
	}
	const roleText = [...roleCounts.keys()].map((role) => `  ${role}: count=${roleCounts.get(role)} jsonl_kb=${Math.round((roleBytes.get(role) ?? 0) / 102.4) / 10}`).join("\n");
	const toolText = [...toolCounts.keys()].sort((a, b) => (toolBytes.get(b) ?? 0) - (toolBytes.get(a) ?? 0)).map((name) => `  ${name}: count=${toolCounts.get(name)} text_kb=${Math.round((toolBytes.get(name) ?? 0) / 102.4) / 10}`).join("\n");
	return [`roles:\n${roleText || "  (none)"}`, `tools:\n${toolText || "  (none)"}`, `large_jsonl_lines: ${JSON.stringify(bigLines.slice(0, 10))}`].join("\n");
}

function sessionDirForCwd(cwd) {
	const root = join(homedir(), ".pi", "agent", "sessions");
	if (!existsSync(root)) return undefined;
	const normalized = cwd.replace(/^~(?=\/|$)/, homedir()).replace(/\/$/, "");
	const encoded = `--${normalized.replace(/^\//, "").replace(/\//g, "-")}--`;
	const exact = join(root, encoded);
	if (existsSync(exact)) return exact;
	return readdirSync(root).map((name) => join(root, name)).find((p) => p.endsWith(encoded));
}

function walk(value, visit) {
	if (Array.isArray(value)) {
		for (const item of value) walk(item, visit);
		return;
	}
	if (value && typeof value === "object") {
		visit(value);
		for (const child of Object.values(value)) walk(child, visit);
	}
}

function textBytes(value) {
	if (typeof value === "string") return Buffer.byteLength(value);
	if (Array.isArray(value)) return value.reduce((n, item) => n + textBytes(item), 0);
	if (value && typeof value === "object") return Object.values(value).reduce((n, item) => n + textBytes(item), 0);
	return 0;
}

function inc(map, key, amount) {
	map.set(key, (map.get(key) ?? 0) + amount);
}

function getCwd(pid) {
	return run("bash", ["-lc", `lsof -a -p ${shellQuote(String(pid))} -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1`]).trim();
}

function run(cmd, argv, options = {}) {
	try {
		return execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: options.timeoutMs ?? 10000 });
	} catch (error) {
		return String(error.stdout ?? "");
	}
}

function sleep(ms) {
	execFileSync("sleep", [String(ms / 1000)]);
}

function section(title) {
	console.log(`\n== ${title} ==`);
}

function formatKb(kb) {
	if (kb > 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}G`;
	if (kb > 1024) return `${(kb / 1024).toFixed(1)}M`;
	return `${kb}K`;
}

function countOccurrences(text, needle) {
	return text.split(needle).length - 1;
}

function topMatches(text, pattern) {
	const counts = new Map();
	for (const match of text.matchAll(pattern)) inc(counts, match[0], 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => `${name}:${count}`);
}

function shellQuote(value) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
