/**
 * 服务器启动失败时的可读诊断信息。
 *
 * Issue #450：当 API 端口（默认 40653）被占用、或被 Windows 系统保留（WinNAT）时，
 * server.listen 会抛出 EADDRINUSE / EACCES。原本只把原始 error 打到控制台，
 * 非 debug 模式下用户基本看不到有效提示，表现为“什么都不报错直接挂掉”。
 * 这里根据错误码给出明确、可操作的中文提示。
 */

interface ErrnoLike {
    code?: string;
    message?: string;
}

/**
 * 根据启动错误与端口，生成面向用户的可操作提示。
 * 纯函数，便于单测。
 */
export function describeServerStartupError(error: ErrnoLike | undefined, port: number): string {
    const code = error?.code;

    if (code === 'EADDRINUSE') {
        return [
            `[QCE] 启动失败：端口 ${port} 已被占用，或被系统保留，无法启动 Web 服务。`,
            `[QCE] 可能原因：已有一个 QCE / 其它程序正在使用该端口，或该端口被 Windows 保留（WinNAT 动态端口段）。`,
            `[QCE] 解决方法：`,
            `[QCE]   1. 关闭占用该端口的程序后重试；`,
            `[QCE]   2. 若为 Windows 端口保留导致，请以管理员身份执行：`,
            `[QCE]        net stop winnat`,
            `[QCE]        netsh interface ipv4 add excludedportrange protocol=tcp startport=${port} numberofports=1 store=persistent`,
            `[QCE]        net start winnat`,
        ].join('\n');
    }

    if (code === 'EACCES') {
        return [
            `[QCE] 启动失败：没有权限绑定端口 ${port}。`,
            `[QCE] 解决方法：请以管理员 / 更高权限运行，或释放该端口后重试。`,
        ].join('\n');
    }

    return `[QCE] 服务器启动失败: ${error?.message ?? String(error)}`;
}
