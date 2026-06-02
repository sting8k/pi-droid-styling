import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
let cachedPiVersion: string | undefined;
let resolved = false;

function readVersionFromPackageJson(path: string): string | undefined {
	try {
		const raw = JSON.parse(readFileSync(path, "utf8"));
		return typeof raw?.version === "string" && raw.version.trim() ? raw.version.trim() : undefined;
	} catch {
		return undefined;
	}
}

function readVersionFromDirectory(dir: string): string | undefined {
	let current = dir;
	for (let i = 0; i < 8; i++) {
		const candidate = join(current, "package.json");
		if (existsSync(candidate)) {
			const version = readVersionFromPackageJson(candidate);
			if (version) return version;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return undefined;
}

function readVersionFromNodeResolutionPaths(): string | undefined {
	const paths = require.resolve.paths(PI_PACKAGE_NAME) ?? [];
	for (const base of paths) {
		const version = readVersionFromPackageJson(join(base, PI_PACKAGE_NAME, "package.json"));
		if (version) return version;
	}
	return undefined;
}

export function getPiVersion(): string | undefined {
	if (resolved) return cachedPiVersion;
	resolved = true;

	try {
		cachedPiVersion = require(`${PI_PACKAGE_NAME}/package.json`)?.version;
		if (typeof cachedPiVersion === "string" && cachedPiVersion.trim()) return cachedPiVersion.trim();
	} catch {
		// Package exports can hide package.json.
	}

	try {
		cachedPiVersion = readVersionFromDirectory(dirname(require.resolve(PI_PACKAGE_NAME)));
		if (cachedPiVersion) return cachedPiVersion;
	} catch {
		// Some Pi packages expose no package root entrypoint.
	}

	cachedPiVersion = readVersionFromNodeResolutionPaths();
	return cachedPiVersion;
}
