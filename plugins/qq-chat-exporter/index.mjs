/**
 * QQ Chat Exporter plugin entrypoint.
 * Supports both NapCat Shell and Framework modes.
 */

import { NapCatCore } from 'NapCatQQ/src/core/index.js';

let apiLauncher = null;

/**
 * @returns {'shell' | 'framework' | 'unknown'}
 */
function detectWorkingEnv(core) {
  const workingEnv = core?.context?.workingEnv;
  if (workingEnv === 1) return 'shell';
  if (workingEnv === 2) return 'framework';

  if (typeof process !== 'undefined') {
    if (process.versions?.electron) return 'framework';
    if (process.env?.NAPCAT_SHELL) return 'shell';
  }

  return 'unknown';
}

function createFallbackCore(rawCore) {
  const safeCore = rawCore && typeof rawCore === 'object' ? rawCore : {};
  if (!safeCore.context || typeof safeCore.context !== 'object') {
    safeCore.context = {};
  }

  const existingLogger = safeCore.context.logger || {};
  const log = typeof existingLogger.log === 'function' ? existingLogger.log.bind(existingLogger) : null;
  const logError = typeof existingLogger.logError === 'function' ? existingLogger.logError.bind(existingLogger) : null;
  const logWarn = typeof existingLogger.logWarn === 'function' ? existingLogger.logWarn.bind(existingLogger) : null;
  const logDebug = typeof existingLogger.logDebug === 'function' ? existingLogger.logDebug.bind(existingLogger) : null;

  safeCore.context.logger = {
    log: (...args) => (log ? log(...args) : console.log('[QCE]', ...args)),
    logError: (...args) => (logError ? logError(...args) : console.error('[QCE]', ...args)),
    logWarn: (...args) => (logWarn ? logWarn(...args) : console.warn('[QCE]', ...args)),
    logDebug: (...args) => (logDebug ? logDebug(...args) : console.debug('[QCE]', ...args))
  };

  return safeCore;
}

function normalizePluginArgs(arg0, arg1, arg2, arg3) {
  if (arg0 && typeof arg0 === 'object' && (
    Object.prototype.hasOwnProperty.call(arg0, 'core') ||
    Object.prototype.hasOwnProperty.call(arg0, 'obContext') ||
    Object.prototype.hasOwnProperty.call(arg0, 'actions') ||
    Object.prototype.hasOwnProperty.call(arg0, 'instance')
  )) {
    return {
      core: arg0.core,
      obContext: arg0.obContext,
      actions: arg0.actions,
      instance: arg0.instance
    };
  }

  return {
    core: arg0,
    obContext: arg1,
    actions: arg2,
    instance: arg3
  };
}

export async function plugin_init(arg0, arg1, arg2, arg3) {
  try {
    const {
      core,
      obContext,
      actions: rawActions,
      instance
    } = normalizePluginArgs(arg0, arg1, arg2, arg3);

    const actions = rawActions || obContext?.actions || instance?.actions;
    if (!core) {
      throw new Error('NapCat core is missing in plugin_init context');
    }

    const workingEnv = detectWorkingEnv(core);

    // Keep the raw NapCat bridge for overlay API adapters.
    globalThis.__NAPCAT_BRIDGE__ = {
      core,
      obContext,
      actions,
      instance,
      workingEnv
    };

    console.log(
      `[QCE] Running mode: ${
        workingEnv === 'framework'
          ? 'Framework (QQNT plugin)'
          : workingEnv === 'shell'
            ? 'Shell (headless)'
            : 'unknown'
      }`
    );

    const tsx = await import('tsx/esm/api').catch(() => null);
    if (!tsx) {
      console.error('[QCE] tsx not found');
      throw new Error('Please install tsx first: npm install tsx');
    }

    tsx.register();

    const { QQChatExporterApiLauncher } = await import('./lib/api/ApiLauncher.ts');

    // Prefer NapCatCore overlay instance. Fallback to raw core with logger guards.
    let runtimeCore;
    try {
      runtimeCore = new NapCatCore();
    } catch (overlayError) {
      console.warn(
        '[QCE] NapCatCore overlay init failed, fallback to raw core:',
        overlayError?.message || overlayError
      );
      runtimeCore = createFallbackCore(core);
    }

    apiLauncher = new QQChatExporterApiLauncher(runtimeCore);
    await apiLauncher.startApiServer();
  } catch (error) {
    console.error('[QCE] Initialization failed:', error);
    console.error(error?.stack || error);
  }
}

export async function plugin_cleanup() {
  try {
    if (apiLauncher) {
      await apiLauncher.stopApiServer();
      apiLauncher = null;
    }
    delete globalThis.__NAPCAT_BRIDGE__;
  } catch (error) {
    console.error('[QCE] Cleanup failed:', error);
  }
}
