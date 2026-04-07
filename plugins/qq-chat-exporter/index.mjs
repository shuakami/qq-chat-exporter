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

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function isContextLikeObject(value) {
  return !!(value && typeof value === 'object' && (
    Object.prototype.hasOwnProperty.call(value, 'core') ||
    Object.prototype.hasOwnProperty.call(value, '_ctx') ||
    Object.prototype.hasOwnProperty.call(value, 'ctx') ||
    Object.prototype.hasOwnProperty.call(value, 'obContext') ||
    Object.prototype.hasOwnProperty.call(value, 'oneBot') ||
    Object.prototype.hasOwnProperty.call(value, 'actions') ||
    Object.prototype.hasOwnProperty.call(value, 'instance') ||
    Object.prototype.hasOwnProperty.call(value, 'logger') ||
    Object.prototype.hasOwnProperty.call(value, 'router') ||
    Object.prototype.hasOwnProperty.call(value, 'pluginManager')
  ));
}

function normalizePluginArgs(arg0, arg1, arg2, arg3) {
  if (isContextLikeObject(arg0)) {
    const nestedCtx = arg0._ctx && typeof arg0._ctx === 'object'
      ? arg0._ctx
      : arg0.ctx && typeof arg0.ctx === 'object'
        ? arg0.ctx
        : undefined;
    const core = pickFirstDefined(
      arg0.core,
      nestedCtx?.core,
      arg0.NapCatCore,
      nestedCtx?.NapCatCore,
      arg0.instance?.core,
      nestedCtx?.instance?.core,
      arg0.instance,
      nestedCtx?.instance
    );
    const obContext = pickFirstDefined(
      arg0.obContext,
      nestedCtx?.obContext,
      arg0.oneBot,
      nestedCtx?.oneBot,
      arg0._ctx?.obContext,
      arg0._ctx?.oneBot,
      arg0.ctx?.obContext,
      arg0.ctx?.oneBot
    );
    const actions = pickFirstDefined(
      arg0.actions,
      nestedCtx?.actions,
      obContext?.actions,
      arg0.instance?.actions,
      nestedCtx?.instance?.actions
    );
    const instance = pickFirstDefined(
      arg0.instance,
      nestedCtx?.instance,
      core
    );

    return {
      core,
      obContext,
      actions,
      instance,
      ctx: arg0,
      nestedCtx
    };
  }

  return {
    core: arg0,
    obContext: arg1,
    actions: arg2,
    instance: arg3,
    ctx: undefined,
    nestedCtx: undefined
  };
}

export async function plugin_init(arg0, arg1, arg2, arg3) {
  try {
    const {
      core,
      obContext,
      actions: rawActions,
      instance,
      ctx,
      nestedCtx
    } = normalizePluginArgs(arg0, arg1, arg2, arg3);

    const actions = rawActions || obContext?.actions || instance?.actions || ctx?.actions || nestedCtx?.actions;
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
      ctx,
      pluginContext: ctx,
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
