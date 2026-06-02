import { Buffer } from "node:buffer";
import { appendFileSync } from "node:fs";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const PROFILE_STATE = Symbol.for("pi-droid-styling.profiler.state");
const DEFAULT_INTERVAL_MS = 5000;
const MIN_INTERVAL_MS = 250;
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

type CpuSnapshot = ReturnType<typeof process.cpuUsage>;
type EventLoopMonitor = ReturnType<typeof monitorEventLoopDelay>;
type EventLoopUsage = ReturnType<typeof performance.eventLoopUtilization>;

type SampleSummary = {
	count: number;
	avg: number;
	p50: number;
	p95: number;
	max: number;
};

type CounterSummary = {
	count: number;
	perSec: number;
};

type ProfileState = {
	enabled: boolean;
	intervalMs: number;
	out: string;
	lastFlushAt: number;
	lastCpuUsage?: CpuSnapshot;
	lastEventLoopUsage?: EventLoopUsage;
	counters: Map<string, number>;
	samples: Map<string, number[]>;
	reporter?: ReturnType<typeof setInterval>;
	loopDelay?: EventLoopMonitor;
	exitHandlerInstalled: boolean;
};

type ProfileRecord = {
	type: "pi-droid-profile";
	reason: string;
	ts: string;
	pid: number;
	intervalMs: number;
	memory: {
		rssMb: number;
		heapUsedMb: number;
		heapTotalMb: number;
		externalMb: number;
	};
	cpu: {
		userMs: number;
		systemMs: number;
		totalMs: number;
		percentOneCore: number;
	};
	eventLoop?: {
		meanMs: number;
		p95Ms: number;
		maxMs: number;
	};
	eventLoopUtilization?: {
		idleMs: number;
		activeMs: number;
		utilization: number;
	};
	counters: Record<string, CounterSummary>;
	samples: Record<string, SampleSummary>;
};

function envFlag(name: string): boolean {
	return TRUE_VALUES.has(String(process.env[name] ?? "").trim().toLowerCase());
}

function envIntervalMs(): number {
	const value = Number(process.env.PI_DROID_PROFILE_INTERVAL_MS);
	if (!Number.isFinite(value) || value <= 0) return DEFAULT_INTERVAL_MS;
	return Math.max(MIN_INTERVAL_MS, Math.floor(value));
}

function round(value: number, digits = 3): number {
	if (!Number.isFinite(value)) return 0;
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function mb(bytes: number): number {
	return round(bytes / 1024 / 1024, 2);
}

function nowMs(): number {
	return performance.now();
}

function createState(): ProfileState {
	return {
		enabled: envFlag("PI_DROID_PROFILE"),
		intervalMs: envIntervalMs(),
		out: String(process.env.PI_DROID_PROFILE_OUT ?? "stderr").trim() || "stderr",
		lastFlushAt: nowMs(),
		counters: new Map(),
		samples: new Map(),
		exitHandlerInstalled: false,
	};
}

function getState(): ProfileState {
	const host = globalThis as typeof globalThis & { [PROFILE_STATE]?: ProfileState };
	if (!host[PROFILE_STATE]) host[PROFILE_STATE] = createState();
	return host[PROFILE_STATE];
}

const state = getState();

function ensureReporter(): void {
	if (!state.enabled) return;
	if (!state.lastCpuUsage) {
		state.lastCpuUsage = process.cpuUsage();
	}
	if (!state.lastEventLoopUsage) {
		try {
			state.lastEventLoopUsage = performance.eventLoopUtilization();
		} catch {
			state.lastEventLoopUsage = undefined;
		}
	}
	if (!state.loopDelay) {
		try {
			state.loopDelay = monitorEventLoopDelay({ resolution: 20 });
			state.loopDelay.enable();
		} catch {
			state.loopDelay = undefined;
		}
	}
	if (!state.reporter) {
		state.reporter = setInterval(() => flushProfile("interval"), state.intervalMs);
		state.reporter.unref?.();
	}
	if (!state.exitHandlerInstalled) {
		state.exitHandlerInstalled = true;
		process.once("exit", () => flushProfile("exit"));
	}
}

function sampleSummary(values: number[]): SampleSummary {
	const sorted = [...values].sort((a, b) => a - b);
	const count = sorted.length;
	const percentile = (percent: number): number => {
		if (count === 0) return 0;
		const index = Math.min(count - 1, Math.max(0, Math.ceil((percent / 100) * count) - 1));
		return sorted[index] ?? 0;
	};
	const sum = sorted.reduce((total, value) => total + value, 0);
	return {
		count,
		avg: round(sum / Math.max(1, count)),
		p50: round(percentile(50)),
		p95: round(percentile(95)),
		max: round(sorted[count - 1] ?? 0),
	};
}

function writeRecord(record: ProfileRecord): void {
	const line = `${JSON.stringify(record)}\n`;
	if (state.out === "stderr") {
		process.stderr.write(line);
		return;
	}
	if (state.out === "stdout") {
		process.stdout.write(line);
		return;
	}
	try {
		appendFileSync(state.out, line, "utf8");
	} catch {
		process.stderr.write(line);
	}
}

export function isProfilingEnabled(): boolean {
	return state.enabled;
}

export function profileNow(): number {
	return state.enabled ? nowMs() : 0;
}

export function profileCount(name: string, value = 1): void {
	if (!state.enabled || !Number.isFinite(value) || value === 0) return;
	ensureReporter();
	state.counters.set(name, (state.counters.get(name) ?? 0) + value);
}

export function profileTextBytes(name: string, text: string): void {
	if (!state.enabled || text.length === 0) return;
	profileCount(name, Buffer.byteLength(text, "utf8"));
}

export function profileSample(name: string, value: number): void {
	if (!state.enabled || !Number.isFinite(value)) return;
	ensureReporter();
	const values = state.samples.get(name);
	if (values) {
		values.push(value);
	} else {
		state.samples.set(name, [value]);
	}
}

export function profileDuration(name: string, startMs: number): void {
	if (!state.enabled || startMs <= 0) return;
	profileSample(name, nowMs() - startMs);
}

export function flushProfile(reason = "manual"): void {
	if (!state.enabled) return;
	const flushedAt = nowMs();
	const intervalMs = Math.max(1, flushedAt - state.lastFlushAt);
	state.lastFlushAt = flushedAt;

	const counters: Record<string, CounterSummary> = {};
	for (const [name, count] of state.counters) {
		counters[name] = {
			count: round(count),
			perSec: round((count * 1000) / intervalMs),
		};
	}
	state.counters.clear();

	const samples: Record<string, SampleSummary> = {};
	for (const [name, values] of state.samples) {
		samples[name] = sampleSummary(values);
	}
	state.samples.clear();

	const memoryUsage = process.memoryUsage();
	const currentCpuUsage = process.cpuUsage();
	const previousCpuUsage = state.lastCpuUsage;
	state.lastCpuUsage = currentCpuUsage;
	const cpuUserMs = previousCpuUsage ? Math.max(0, (currentCpuUsage.user - previousCpuUsage.user) / 1000) : 0;
	const cpuSystemMs = previousCpuUsage ? Math.max(0, (currentCpuUsage.system - previousCpuUsage.system) / 1000) : 0;
	const cpuTotalMs = cpuUserMs + cpuSystemMs;
	let loopUsageDelta: EventLoopUsage | undefined;
	try {
		const currentLoopUsage = performance.eventLoopUtilization();
		if (state.lastEventLoopUsage) {
			loopUsageDelta = performance.eventLoopUtilization(currentLoopUsage, state.lastEventLoopUsage);
		}
		state.lastEventLoopUsage = currentLoopUsage;
	} catch {
		state.lastEventLoopUsage = undefined;
	}
	const loopDelay = state.loopDelay;
	const record: ProfileRecord = {
		type: "pi-droid-profile",
		reason,
		ts: new Date().toISOString(),
		pid: process.pid,
		intervalMs: round(intervalMs),
		memory: {
			rssMb: mb(memoryUsage.rss),
			heapUsedMb: mb(memoryUsage.heapUsed),
			heapTotalMb: mb(memoryUsage.heapTotal),
			externalMb: mb(memoryUsage.external),
		},
		cpu: {
			userMs: round(cpuUserMs),
			systemMs: round(cpuSystemMs),
			totalMs: round(cpuTotalMs),
			percentOneCore: round((cpuTotalMs * 100) / intervalMs),
		},
		counters,
		samples,
	};
	if (loopDelay) {
		record.eventLoop = {
			meanMs: round(loopDelay.mean / 1_000_000),
			p95Ms: round(loopDelay.percentile(95) / 1_000_000),
			maxMs: round(loopDelay.max / 1_000_000),
		};
		loopDelay.reset();
	}
	if (loopUsageDelta) {
		record.eventLoopUtilization = {
			idleMs: round(loopUsageDelta.idle),
			activeMs: round(loopUsageDelta.active),
			utilization: round(loopUsageDelta.utilization),
		};
	}
	writeRecord(record);
}
