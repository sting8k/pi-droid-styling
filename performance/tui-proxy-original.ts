/**
 * Proxy-safe capture of the "real" TUI method before an extension wrapper is
 * installed, preserving the wrapper chain.
 *
 * Pi 0.84's InteractiveMode hands extensions a stable TUI Proxy
 * (`createInteractiveTuiReference`). Its `get` trap returns a *fresh* dynamic
 * wrapper on every access that re-reads the current renderer's method at call
 * time, and its `set` trap writes to the current renderer. Capturing a method
 * as `tui.doRender.bind(tui)` therefore pins that dynamic re-reader, which on a
 * later call re-reads the (now wrapped) renderer method and bounces back into
 * the wrapper — `RangeError: Maximum call stack size exceeded`.
 *
 * To stay safe we resolve the method that actually lives on the renderer's
 * prototype chain and let callers invoke it with the runtime `this` (the
 * current renderer). When the reference is a real renderer (pre-0.84, or any
 * non-proxy) the property is stable, so we capture it directly.
 *
 * Because the proxy makes the current method unreachable as a stable reference,
 * installers explicitly record the wrapper they install via
 * `rememberTuiMethodWrapper`, stored under a Symbol on the renderer. The proxy
 * forwards non-function symbol properties to the real renderer, so this state is
 * per-renderer and survives later installers — letting the next wrapper chain to
 * the previous one (e.g. padding -> widthGuard) instead of jumping to the base
 * method and silently skipping an earlier wrapper.
 */

export type OriginalTuiMethod = (...args: unknown[]) => unknown;

const METHOD_CHAIN = Symbol.for("pi-droid-styling.tui-proxy-original.method-chain");

type MethodChain = Record<string, unknown>;

function readChain(tui: unknown): MethodChain | undefined {
	const chain = (tui as Record<PropertyKey, unknown> | null | undefined)?.[METHOD_CHAIN];
	return chain && typeof chain === "object" ? (chain as MethodChain) : undefined;
}

function writeChain(tui: unknown, chain: MethodChain): void {
	if (tui == null) return;
	(tui as Record<PropertyKey, unknown>)[METHOD_CHAIN] = chain;
}

/**
 * Returns a reference to the original method that is safe to invoke against the
 * current renderer.
 *
 * - Real renderer (stable property): returns the current method value, which
 *   may already be an extension wrapper — preserving the existing chain.
 * - Pi proxy (unstable property): returns the most recently remembered wrapper
 *   for this method (if any), otherwise walks the renderer prototype chain to
 *   the unmounted base method. The caller invokes it with the runtime `this`.
 */
export function getOriginalTuiMethod(tui: unknown, name: PropertyKey): OriginalTuiMethod {
	const key = String(name);
	const current = (tui as Record<PropertyKey, unknown> | null | undefined)?.[name];

	// A real renderer yields a stable reference; the Pi proxy yields a new
	// dynamic wrapper on every get. Only capture the current value when it is
	// stable (preserves any existing wrapper chain without recursion).
	if (typeof current === "function") {
		let stable = false;
		try {
			stable = (tui as Record<PropertyKey, unknown>)?.[name] === current;
		} catch {
			stable = false;
		}
		if (stable) return current as OriginalTuiMethod;
	}

	// Proxy (unstable) path: first honor the chain recorded by earlier
	// installers so wrappers compose; otherwise fall back to the prototype base.
	const remembered = readChain(tui)?.[key];
	if (typeof remembered === "function") return remembered as OriginalTuiMethod;

	// Walk the renderer prototype chain to find the real method owner.
	let proto: unknown = tui == null ? undefined : Object.getPrototypeOf(tui);
	while (typeof proto === "object" && proto !== null) {
		const descriptor = Object.getOwnPropertyDescriptor(proto, name);
		if (descriptor) {
			const value =
				typeof descriptor.get === "function"
					? (descriptor as PropertyDescriptor & { get: () => unknown }).get.call(tui)
					: (descriptor as PropertyDescriptor & { value: unknown }).value;
			if (typeof value === "function") return value as OriginalTuiMethod;
			// A non-function descriptor shadows the method; stop walking.
			break;
		}
		proto = Object.getPrototypeOf(proto);
	}

	// Last resort: the current value. Callers guard against the just-installed
	// wrapper via their patch symbols, so this is only reached for unusual
	// instance-only methods.
	return current as OriginalTuiMethod;
}

/**
 * Records `wrapper` as the current method-chain entry for `name` on the current
 * renderer, so a later installer of the same method chains to this wrapper
 * instead of skipping ahead to the base method. Call this immediately after
 * assigning `tui[name] = wrapper`.
 */
export function rememberTuiMethodWrapper(tui: unknown, name: PropertyKey, wrapper: unknown): void {
	if (typeof wrapper !== "function") return;
	const key = String(name);
	const chain = readChain(tui) ?? {};
	chain[key] = wrapper;
	writeChain(tui, chain);
}