/**
 * Console silencer.
 *
 * Production code logs aggressively via `console.log` / `console.warn`. The
 * test runner output is unreadable with that noise, so we patch the global
 * console while tests run. Set `QCE_TEST_VERBOSE=1` to pass through.
 */

interface SilencedConsole {
    captured: { level: 'log' | 'warn' | 'error' | 'debug' | 'info'; args: unknown[] }[];
    restore(): void;
}

export function silenceConsole(): SilencedConsole {
    if (process.env.QCE_TEST_VERBOSE) {
        return { captured: [], restore: () => undefined };
    }
    const captured: SilencedConsole['captured'] = [];
    const original = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
        info: console.info
    };
    console.log = (...args: unknown[]) => captured.push({ level: 'log', args });
    console.warn = (...args: unknown[]) => captured.push({ level: 'warn', args });
    console.error = (...args: unknown[]) => captured.push({ level: 'error', args });
    console.debug = (...args: unknown[]) => captured.push({ level: 'debug', args });
    console.info = (...args: unknown[]) => captured.push({ level: 'info', args });
    return {
        captured,
        restore() {
            console.log = original.log;
            console.warn = original.warn;
            console.error = original.error;
            console.debug = original.debug;
            console.info = original.info;
        }
    };
}
