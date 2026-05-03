/**
 * 把 NapCat core 的 logger 包成「永远不会因为 logger 自己出问题而炸」的版本。
 *
 * Issue #326：QCE 被作为插件嵌入到老 / 不兼容版本的 NapCat 时，
 * `core.context.logger` 在某些路径上可能整个就是 undefined（接口被改名、
 * 字段在 setup 完成前被读、或者 NapCatQQ overlay runtime 没匹配上）。
 * 老代码直接 `this.core.context.logger.log(...)` 让 Express 中间件链炸开，
 * 外层连一个 500 都返回不出去，前端表现就是「打开 Web 界面什么都没有」。
 *
 * 这里提供一个统一的 `createSafeLogger`：
 *  - logger 不可用 / 缺指定方法时，退回到 console
 *  - logger 自己抛异常时，也退回到 console
 *  - 永远返回完整的 4 个方法（log / logWarn / logError / logDebug）
 */

export interface NapCatLoggerLike {
    log?: (...args: unknown[]) => void;
    logWarn?: (...args: unknown[]) => void;
    logError?: (...args: unknown[]) => void;
    logDebug?: (...args: unknown[]) => void;
}

export interface NapCatCoreLike {
    context?: {
        logger?: NapCatLoggerLike;
    };
}

export interface SafeLogger {
    log: (...args: unknown[]) => void;
    logWarn: (...args: unknown[]) => void;
    logError: (...args: unknown[]) => void;
    logDebug: (...args: unknown[]) => void;
}

type ConsoleSink = (...args: unknown[]) => void;

function wrap(
    fn: ((...args: unknown[]) => void) | undefined,
    target: NapCatLoggerLike | undefined,
    fallback: ConsoleSink,
): (...args: unknown[]) => void {
    if (typeof fn !== 'function') {
        return fallback;
    }
    return (...args: unknown[]) => {
        try {
            fn.apply(target, args);
        } catch {
            fallback(...args);
        }
    };
}

export function createSafeLogger(
    core: NapCatCoreLike | undefined | null,
    consoleImpl: Console = console,
): SafeLogger {
    const logger = core?.context?.logger;
    return {
        log: wrap(logger?.log, logger, (...args) => consoleImpl.log('[QCE]', ...args)),
        logWarn: wrap(logger?.logWarn, logger, (...args) => consoleImpl.warn('[QCE]', ...args)),
        logError: wrap(logger?.logError, logger, (...args) => consoleImpl.error('[QCE]', ...args)),
        logDebug: wrap(logger?.logDebug, logger, (...args) => consoleImpl.debug('[QCE]', ...args)),
    };
}
