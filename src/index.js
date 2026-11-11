/**
 * Public entry point for ts-worked-time.
 *
 * Re-exporting from a single module keeps the import surface small and makes
 * it obvious which names are part of the supported API. Anything not exported
 * here is an implementation detail that may change.
 */

export { computeWorkedTime, DEFAULT_OPTIONS } from './core.js';
