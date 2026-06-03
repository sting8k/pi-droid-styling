#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BEGIN_SYNC = "\x1b[?2026h";
const DISABLE_AUTOWRAP = "\x1b[?7l";
const SAVE_CURSOR = "\x1b[s";
const DEFAULT_DIR = join(tmpdir(), "pi-droid-render-debug");

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
	usage();
	process.exit(0);
}

const logFile = resolveLogFile(args);
const records = readRecords(logFile);
const frames = records.filter((record) => record?.type === "frame");
const markers = records.filter((record) => record?.type === "marker");
const top = Math.max(1, numberOption(args.top, 12));
const summary = summarizeFrames(frames, markers);

printSummary(logFile, summary);
printSuspiciousFrames(summary.suspiciousFrames.slice(-top));

function resolveLogFile(options) {
	if (options.file) return resolve(String(options.file));
	const dir = resolve(String(options.dir || process.env.PI_DROID_RENDER_DEBUG_DIR || DEFAULT_DIR));
	if (!existsSync(dir)) throw new Error(`render debug dir not found: ${dir}`);
	const files = readdirSync(dir)
		.filter((name) => /^(render-frame|do-render)-\d+\.jsonl$/.test(name))
		.map((name) => join(dir, name))
		.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
	if (files.length === 0) throw new Error(`no render-frame JSONL logs found in ${dir}`);
	return files[0];
}

function readRecords(path) {
	const lines = readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean);
	const records = [];
	for (const line of lines) {
		try {
			records.push(JSON.parse(line));
		} catch {
			// Keep the summary resilient to partial writes during a live session.
		}
	}
	return records;
}

function summarizeFrames(frames, markers) {
	const summary = {
		frames: frames.length,
		markers: markers.length,
		markerFrames: markers.map((marker) => marker?.frame).filter((frame) => Number.isFinite(Number(frame))),
		logicalDupFrames: 0,
		renderDupFrames: 0,
		viewportMovedFrames: 0,
		appendedFrames: 0,
		leadingRelativeMoveFrames: 0,
		rawLeadingRelativeMoveFrames: 0,
		leadingAbsoluteAnchorFrames: 0,
		anchorRewriteFrames: 0,
		physicalSelfHealFrames: 0,
		bandRepaintFrames: 0,
		fullViewportRepaintFrames: 0,
		rowCoverageRiskFrames: 0,
		rowCoverageExpectedRows: 0,
		rowCoverageTouchedRows: 0,
		rowCoverageMissedRows: 0,
		rowCoverageWrapAdvances: 0,
		rowCoverageScrollEvents: 0,
		screenSimulationRiskFrames: 0,
		screenSimulationComparedRows: 0,
		screenSimulationMismatchRows: 0,
		screenSimulationWrapAdvances: 0,
		screenSimulationScrollEvents: 0,
		selfHealReasonCounts: {},
		selfHealBandRows: 0,
		selfHealFullRows: 0,
		totalWriteBytes: 0,
		suspiciousFrames: [],
	};

	for (const frame of frames) {
		const flags = collectFrameFlags(frame);
		if (flags.logicalDup) summary.logicalDupFrames++;
		if (flags.renderDup) summary.renderDupFrames++;
		if (flags.viewportMoved) summary.viewportMovedFrames++;
		if (flags.appended) summary.appendedFrames++;
		if (flags.leadingRelativeMove) summary.leadingRelativeMoveFrames++;
		if (flags.rawLeadingRelativeMove) summary.rawLeadingRelativeMoveFrames++;
		if (flags.leadingAbsoluteAnchor) summary.leadingAbsoluteAnchorFrames++;
		if (flags.anchorRewrite) summary.anchorRewriteFrames++;
		if (flags.physicalSelfHeal) summary.physicalSelfHealFrames++;
		if (flags.bandRepaint) summary.bandRepaintFrames++;
		if (flags.fullViewportRepaint) summary.fullViewportRepaintFrames++;
		if (flags.rowCoverageRisk) summary.rowCoverageRiskFrames++;
		if (flags.screenSimulationRisk) summary.screenSimulationRiskFrames++;
		summary.rowCoverageExpectedRows += flags.rowCoverageExpectedRows;
		summary.rowCoverageTouchedRows += flags.rowCoverageTouchedRows;
		summary.rowCoverageMissedRows += flags.rowCoverageMissedRows;
		summary.rowCoverageWrapAdvances += flags.rowCoverageWrapAdvances;
		summary.rowCoverageScrollEvents += flags.rowCoverageScrollEvents;
		summary.screenSimulationComparedRows += flags.screenSimulationComparedRows;
		summary.screenSimulationMismatchRows += flags.screenSimulationMismatchRows;
		summary.screenSimulationWrapAdvances += flags.screenSimulationWrapAdvances;
		summary.screenSimulationScrollEvents += flags.screenSimulationScrollEvents;
		if (flags.selfHealReason) summary.selfHealReasonCounts[flags.selfHealReason] = (summary.selfHealReasonCounts[flags.selfHealReason] ?? 0) + 1;
		summary.selfHealBandRows += flags.bandRows;
		summary.selfHealFullRows += flags.fullRows;
		summary.totalWriteBytes += Number(frame?.writes?.bytes ?? 0);
		if (flags.suspicious) {
			summary.suspiciousFrames.push({
				frame: frame.frame,
				durationMs: frame.durationMs,
				viewportTop: frame?.after?.previousViewportTop,
				height: frame?.after?.previousHeight,
				firstChanged: frame?.changed?.firstChanged,
				lastChanged: frame?.changed?.lastChanged,
				writeBytes: frame?.writes?.bytes,
				flags: flags.names,
				selfHealReason: flags.selfHealReason,
				selfHealRanges: flags.selfHealRanges,
				rowCoverageMissedRanges: flags.rowCoverageMissedRanges,
				rowCoverageExpectedRanges: flags.rowCoverageExpectedRanges,
				rowCoverageTouchedRanges: flags.rowCoverageTouchedRanges,
				screenSimulationMismatchRanges: flags.screenSimulationMismatchRanges,
				screenSimulationMismatchSample: flags.screenSimulationMismatchSample,
			});
		}
	}
	return summary;
}

function collectFrameFlags(frame) {
	const writes = getWriteTexts(frame);
	const logicalDup = Array.isArray(frame?.duplicateRuns) && frame.duplicateRuns.length > 0;
	const renderDup = Array.isArray(frame?.capturedRenders) && frame.capturedRenders.some((render) => Array.isArray(render?.duplicateRuns) && render.duplicateRuns.length > 0);
	const viewportMoved = frame?.viewportMoved === true;
	const appended = frame?.changed?.appended === true;
	const leadingRelativeMove = writes.some((text) => /^\x1b\[\?2026h\x1b\[\d+[AB]\r/u.test(text));
	const leadingAbsoluteAnchor = writes.some((text) => /^\x1b\[\?2026h\x1b\[\d+;1H/u.test(text));
	const parsedSelfHealRows = writes.flatMap((text) => readPhysicalSelfHealRows(text));
	const physicalSync = frame?.physicalSync;
	const selfHeal = physicalSync?.selfHeal;
	const selfHealReason = typeof selfHeal?.reason === "string" ? selfHeal.reason : undefined;
	const selfHealRows = Math.max(0, numberOption(selfHeal?.rows, 0));
	const selfHealRanges = Array.isArray(selfHeal?.ranges) ? selfHeal.ranges : [];
	const physicalSelfHeal = selfHealRows > 0 || parsedSelfHealRows.length > 0;
	const fullViewportRepaint = selfHealRows > 0 ? selfHeal?.fullViewport === true : isFullViewportRepaint(parsedSelfHealRows, frame?.after?.previousHeight);
	const bandRepaint = physicalSelfHeal && !fullViewportRepaint;
	const rawLeadingRelativeMove = Number(physicalSync?.rawLeadingRelativeCount ?? 0) > 0;
	const anchorRewrite = Number(physicalSync?.anchorRewriteCount ?? 0) > 0;
	const rowCoverage = frame?.rowCoverage;
	const rowCoverageMissedRows = Array.isArray(rowCoverage?.missedRows) ? rowCoverage.missedRows.length : 0;
	const rowCoverageExpectedRows = Array.isArray(rowCoverage?.expectedRows) ? rowCoverage.expectedRows.length : 0;
	const rowCoverageTouchedRows = Array.isArray(rowCoverage?.touchedRows) ? rowCoverage.touchedRows.length : 0;
	const rowCoverageRisk = rowCoverageMissedRows > 0;
	const rowCoverageMissedRanges = Array.isArray(rowCoverage?.missedRanges) ? rowCoverage.missedRanges : [];
	const rowCoverageExpectedRanges = Array.isArray(rowCoverage?.expectedRanges) ? rowCoverage.expectedRanges : [];
	const rowCoverageTouchedRanges = Array.isArray(rowCoverage?.touchedRanges) ? rowCoverage.touchedRanges : [];
	const rowCoverageWrapAdvances = Math.max(0, numberOption(rowCoverage?.wrapAdvances, 0));
	const rowCoverageScrollEvents = Math.max(0, numberOption(rowCoverage?.scrollEvents, 0));
	const screenSimulation = frame?.screenSimulation;
	const screenSimulationMismatchRows = Array.isArray(screenSimulation?.mismatchRows) ? screenSimulation.mismatchRows.length : 0;
	const screenSimulationComparedRows = Math.max(0, numberOption(screenSimulation?.comparedRows, 0));
	const screenSimulationRisk = screenSimulationMismatchRows > 0;
	const screenSimulationMismatchRanges = Array.isArray(screenSimulation?.mismatchRanges) ? screenSimulation.mismatchRanges : [];
	const screenSimulationMismatchSample = Array.isArray(screenSimulation?.mismatchSample) ? screenSimulation.mismatchSample : [];
	const screenSimulationWrapAdvances = Math.max(0, numberOption(screenSimulation?.wrapAdvances, 0));
	const screenSimulationScrollEvents = Math.max(0, numberOption(screenSimulation?.scrollEvents, 0));
	const bandRows = bandRepaint ? selfHealRows || parsedSelfHealRows.length : 0;
	const fullRows = fullViewportRepaint ? selfHealRows || parsedSelfHealRows.length : 0;
	const suspicious = logicalDup || renderDup || leadingRelativeMove || rowCoverageRisk || screenSimulationRisk;
	const names = [];
	if (logicalDup) names.push("logicalDup");
	if (renderDup) names.push("renderDup");
	if (viewportMoved) names.push("viewportMoved");
	if (appended) names.push("appended");
	if (leadingRelativeMove) names.push("leadingRelativeMove");
	if (rawLeadingRelativeMove) names.push("rawLeadingRelativeMove");
	if (leadingAbsoluteAnchor) names.push("leadingAbsoluteAnchor");
	if (anchorRewrite) names.push("anchorRewrite");
	if (bandRepaint) names.push("bandRepaint");
	if (fullViewportRepaint) names.push("fullViewportRepaint");
	if (rowCoverageRisk) names.push("rowCoverageMiss");
	if (screenSimulationRisk) names.push("screenSimulationMismatch");
	return { logicalDup, renderDup, viewportMoved, appended, leadingRelativeMove, rawLeadingRelativeMove, leadingAbsoluteAnchor, anchorRewrite, physicalSelfHeal, bandRepaint, fullViewportRepaint, selfHealReason, selfHealRanges, bandRows, fullRows, rowCoverageRisk, rowCoverageExpectedRows, rowCoverageTouchedRows, rowCoverageMissedRows, rowCoverageMissedRanges, rowCoverageExpectedRanges, rowCoverageTouchedRanges, rowCoverageWrapAdvances, rowCoverageScrollEvents, screenSimulationRisk, screenSimulationComparedRows, screenSimulationMismatchRows, screenSimulationMismatchRanges, screenSimulationMismatchSample, screenSimulationWrapAdvances, screenSimulationScrollEvents, suspicious, names };
}

function readPhysicalSelfHealRows(text) {
	if (!text.startsWith(DISABLE_AUTOWRAP + SAVE_CURSOR + BEGIN_SYNC)) return [];
	const rows = [];
	const rowPattern = /\x1b\[(\d+);1H\x1b\[2K/gu;
	for (const match of text.matchAll(rowPattern)) rows.push(Number(match[1]));
	return rows.filter((row) => Number.isFinite(row));
}

function isFullViewportRepaint(rows, height) {
	const expectedHeight = Math.max(1, numberOption(height, 0));
	if (rows.length < expectedHeight) return false;
	const rowSet = new Set(rows);
	for (let row = 1; row <= expectedHeight; row++) {
		if (!rowSet.has(row)) return false;
	}
	return true;
}

function getWriteTexts(frame) {
	const chunks = frame?.writes?.chunks;
	if (Array.isArray(chunks) && chunks.length > 0) return chunks.map((chunk) => String(chunk?.text ?? ""));
	return [String(frame?.writes?.text ?? "")];
}

function printSummary(logFile, summary) {
	console.log(`log: ${logFile}`);
	console.log(`frames: ${summary.frames}`);
	console.log(`marker_count: ${summary.markers}`);
	console.log(`marker_frames: ${JSON.stringify(summary.markerFrames)}`);
	console.log(`logical_dup_frames: ${summary.logicalDupFrames}`);
	console.log(`render_dup_frames: ${summary.renderDupFrames}`);
	console.log(`viewport_moved_frames: ${summary.viewportMovedFrames}`);
	console.log(`appended_frames: ${summary.appendedFrames}`);
	console.log(`leading_relative_move_frames: ${summary.leadingRelativeMoveFrames}`);
	console.log(`raw_leading_relative_move_frames: ${summary.rawLeadingRelativeMoveFrames}`);
	console.log(`leading_absolute_anchor_frames: ${summary.leadingAbsoluteAnchorFrames}`);
	console.log(`anchor_rewrite_frames: ${summary.anchorRewriteFrames}`);
	console.log(`physical_self_heal_frames: ${summary.physicalSelfHealFrames}`);
	console.log(`band_repaint_frames: ${summary.bandRepaintFrames}`);
	console.log(`full_viewport_repaint_frames: ${summary.fullViewportRepaintFrames}`);
	console.log(`row_coverage_risk_frames: ${summary.rowCoverageRiskFrames}`);
	console.log(`row_coverage_expected_rows: ${summary.rowCoverageExpectedRows}`);
	console.log(`row_coverage_touched_rows: ${summary.rowCoverageTouchedRows}`);
	console.log(`row_coverage_missed_rows: ${summary.rowCoverageMissedRows}`);
	console.log(`row_coverage_wrap_advances: ${summary.rowCoverageWrapAdvances}`);
	console.log(`row_coverage_scroll_events: ${summary.rowCoverageScrollEvents}`);
	console.log(`screen_simulation_risk_frames: ${summary.screenSimulationRiskFrames}`);
	console.log(`screen_simulation_compared_rows: ${summary.screenSimulationComparedRows}`);
	console.log(`screen_simulation_mismatch_rows: ${summary.screenSimulationMismatchRows}`);
	console.log(`screen_simulation_wrap_advances: ${summary.screenSimulationWrapAdvances}`);
	console.log(`screen_simulation_scroll_events: ${summary.screenSimulationScrollEvents}`);
	console.log(`self_heal_reason_counts: ${JSON.stringify(summary.selfHealReasonCounts)}`);
	console.log(`self_heal_band_rows: ${summary.selfHealBandRows}`);
	console.log(`self_heal_full_rows: ${summary.selfHealFullRows}`);
	console.log(`total_write_bytes: ${summary.totalWriteBytes}`);
}

function printSuspiciousFrames(frames) {
	if (frames.length === 0) return;
	console.log("\nsuspicious_frames:");
	for (const frame of frames) {
		console.log(`- frame=${frame.frame} duration=${frame.durationMs}ms viewport=${frame.viewportTop}+${frame.height} changed=${frame.firstChanged}..${frame.lastChanged} bytes=${frame.writeBytes} flags=${frame.flags.join(",")} selfHeal=${frame.selfHealReason ?? "-"} ranges=${JSON.stringify(frame.selfHealRanges ?? [])} missed=${JSON.stringify(frame.rowCoverageMissedRanges ?? [])} expected=${JSON.stringify(frame.rowCoverageExpectedRanges ?? [])} touched=${JSON.stringify(frame.rowCoverageTouchedRanges ?? [])} simulatedMiss=${JSON.stringify(frame.screenSimulationMismatchRanges ?? [])} simulatedSample=${JSON.stringify(frame.screenSimulationMismatchSample ?? [])}`);
	}
}

function numberOption(value, fallback) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("--")) continue;
		const eq = arg.indexOf("=");
		if (eq >= 0) {
			out[arg.slice(2, eq)] = arg.slice(eq + 1);
			continue;
		}
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

function usage() {
	console.log(`Usage:
  npm run debug:render-log -- [--dir <dir> | --file <jsonl>] [--top <n>]

Examples:
  rm -rf /tmp/pi-droid-render-debug
  PI_DROID_RENDER_DEBUG=1 PI_DROID_RENDER_DEBUG_DIR=/tmp/pi-droid-render-debug pi
  npm run debug:render-log -- --dir /tmp/pi-droid-render-debug

The summary expects frame logs from PI_DROID_RENDER_DEBUG=1 and highlights logical duplicates, render duplicates, raw/final cursor anchoring, physical self-heal reasons/ranges, changed-row write coverage misses, debug markers, and ANSI screen simulation mismatches.`);
}
