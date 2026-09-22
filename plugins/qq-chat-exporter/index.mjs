/**
 * QQ Chat Exporter plugin entrypoint.
 * Supports both NapCat Shell and Framework modes.
 */

let pluginLifecycle = null;
const lifecyclesByContext = new WeakMap();

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

export function createFallbackCore(rawCore) {
  const safeCore = rawCore && typeof rawCore === 'object' ? rawCore : {};
  if (!safeCore.context || typeof safeCore.context !== 'object') {
    safeCore.context = {};
  }

  const logger = safeCore.context.logger;
  const existingLogger = logger && (typeof logger === 'object' || typeof logger === 'function')
    ? logger
    : {};
  const fallbacks = new Map([
    ['log', (...args) => console.log('[QCE]', ...args)],
    ['logError', (...args) => console.error('[QCE]', ...args)],
    ['logWarn', (...args) => console.warn('[QCE]', ...args)],
    ['logDebug', (...args) => console.debug('[QCE]', ...args)]
  ]);

  safeCore.context.logger = new Proxy(existingLogger, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      if (typeof property === 'string' && fallbacks.has(property)) {
        return fallbacks.get(property);
      }
      return value;
    }
  });

  return safeCore;
}

/**
 * Test-only introspection for the last adapter produced by createApiAdapter.
 * Tracks at most the most recent adapter.
 */
export const __apiAdapterDebug = {
  lastApis: undefined,
};

/**
 * API adapter that wraps the real NapCat apis and provides fallback implementations
 * for methods that are missing or have different signatures in NapCat 4.18.6.
 * 
 * This adapter receives the REAL NapCat APIs (from the bridge), not the stub Proxy.
 * It provides stub fallbacks for methods that don't exist or return wrong types.
 * Non-function properties of the real APIs are passed through untouched.
 */
export function createApiAdapter(apis) {
  // Known methods that QCE expects, organized by API namespace
  const knownMethods = {
    GroupApi: ['getGroups', 'fetchGroupDetail', 'getGroupMemberAll', 'getGroupFileCount'],
    FriendApi: ['getBuddy', 'getBuddyV2ExWithCate', 'getFriends'],
    WebApi: ['getGroupEssenceMsgAll'],
  };

  const stubs = {
    GroupApi: {
      getGroups: async () => [],
      fetchGroupDetail: async (groupCode) => ({ groupCode, groupName: 'Unknown' }),
      getGroupMemberAll: async () => ({ result: { infos: new Map() } }),
      getGroupFileCount: async () => ({ groupFileCounts: [] }),
    },
    FriendApi: {
      getBuddy: async () => [],
      getBuddyV2ExWithCate: async () => [],
      getFriends: async () => [],
    },
    WebApi: {
      getGroupEssenceMsgAll: async () => [],
    },
  };

  const adapter = new Proxy({}, {
    get(target, apiName) {
      if (!(apiName in target)) {
        target[apiName] = new Proxy({}, {
          get(apiTarget, methodName) {
            const methodList = knownMethods[apiName];
            const methodStubs = stubs[apiName];

            // If this is a known QCE method
            if (methodList && methodList.includes(methodName)) {
              // Try the real API first
              const realApi = apis?.[apiName];
              const realMethod = realApi?.[methodName];
              if (typeof realMethod === 'function') {
                return realMethod.bind(realApi);
              }
              // Pass through non-function properties (Maps, objects) untouched
              if (realApi && methodName in realApi) {
                return realMethod;
              }
              // Fall back to stub
              return methodStubs?.[methodName] || (async () => []);
            }

            // For unknown methods, try real API first
            const realApi = apis?.[apiName];
            const realMethod = realApi?.[methodName];
            if (typeof realMethod === 'function') {
              return realMethod.bind(realApi);
            }
            // Pass through non-function properties (Maps, objects) untouched
            if (realApi && methodName in realApi) {
              return realMethod;
            }
            return async () => ({ result: 0, errMsg: '' });
          }
        });
      }
      return target[apiName];
    }
  });

  __apiAdapterDebug.lastApis = adapter;
  return adapter;
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
  let startupSignal;
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

    const previousShutdown = globalThis.__NAPCAT_BRIDGE__?.shutdown
      || pluginLifecycle?.shutdown;
    let apiLauncher = null;
    let shutdownPromise;
    let initializationPromise;
    let previousShutdownFailed = false;
    let previousShutdownError;
    const startupController = new AbortController();
    startupSignal = startupController.signal;

    // Register this instance before its first asynchronous startup step.
    // NapCat only exposes getPluginExports after plugin_init has completed,
    // but startup can already have spawned qce-server before that point.
    const bridge = {
      core,
      obContext,
      actions,
      instance,
      ctx,
      pluginContext: ctx,
      workingEnv,
      shutdown() {
        if (!shutdownPromise) {
          shutdownPromise = Promise.resolve().then(async () => {
            startupController.abort();
            // plugin_init reports startup errors. The launcher separately
            // tracks whether startup cleanup actually released its resources.
            try { await initializationPromise; } catch {}
            await apiLauncher?.stopApiServer();
            if (previousShutdownFailed) throw previousShutdownError;
            // Keep a failed shutdown discoverable. A reload may also have
            // published a newer bridge while we waited; never remove it.
            if (globalThis.__NAPCAT_BRIDGE__ === bridge) {
              delete globalThis.__NAPCAT_BRIDGE__;
            }
          });
        }
        return shutdownPromise;
      }
    };
    initializationPromise = Promise.resolve().then(async () => {
      try {
        await previousShutdown?.();
      } catch (error) {
        previousShutdownFailed = true;
        previousShutdownError = error;
        throw error;
      }
      startupController.signal.throwIfAborted();
      console.log(
        `[QCE] Running mode: ${
          workingEnv === 'framework'
            ? 'Framework (QQNT plugin)'
            : workingEnv === 'shell'
              ? 'Shell (headless)'
              : 'unknown'
        }`
      );

      const { QQChatExporterApiLauncher } = await import('./runtime/ApiLauncher.mjs');
      startupController.signal.throwIfAborted();
      const runtimeCore = createFallbackCore(core);
      const adapter = createApiAdapter(bridge.core?.apis || runtimeCore.apis);
      // Keep NapCat's core.apis untouched, including during an overlapping reload.
      const qceCore = runtimeCore === core
        ? Object.assign(Object.create(Object.getPrototypeOf(core)), core, { apis: adapter })
        : runtimeCore;
      if (qceCore === runtimeCore) {
        runtimeCore.apis = adapter;
      }
      apiLauncher = new QQChatExporterApiLauncher(qceCore);
      await apiLauncher.startApiServer({ signal: startupController.signal });
    });
    pluginLifecycle = bridge;
    lifecyclesByContext.set(ctx || core, bridge);
    globalThis.__NAPCAT_BRIDGE__ = bridge;
    await initializationPromise;
  } catch (error) {
    // Cancellation only has this exact reason after owned startup resources
    // are confirmed stopped. Cleanup failures remain distinct and reject init.
    if (startupSignal?.aborted && error === startupSignal.reason) return;
    console.error('[QCE] Initialization failed:', error);
    console.error(error?.stack || error);
    throw error;
  }
}

export function plugin_cleanup(context = undefined) {
  // Return the same promise as the early shutdown hook. Cleanup errors must
  // reach the host so it can report a failed shutdown instead of exit code 0.
  const lifecycle = context && typeof context === 'object'
    ? lifecyclesByContext.get(context)
    : pluginLifecycle;
  return lifecycle?.shutdown() ?? Promise.resolve();
}
