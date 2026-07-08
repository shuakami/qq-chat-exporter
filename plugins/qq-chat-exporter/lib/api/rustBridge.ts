/**
 * Rust 服务端桥接层。
 *
 * Rust 版 qce-server 不直接嵌入 QQ 运行时，通过本模块暴露的极薄 JSON-RPC
 * 服务调用 NapCat Core API（MsgApi / GroupApi / FriendApi / FileApi /
 * WebApi / UserApi / PacketApi），并负责拉起 / 关闭 qce-server 子进程。
 *
 * 协议：`POST http://127.0.0.1:<port>/rpc`，请求体
 * `{"id": "...", "method": "MsgApi.getMsgHistory", "params": [...]}`，
 * 响应体 `{"ok": true, "result": ...}` 或 `{"ok": false, "error": "..."}`。
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { NapCatCore } from 'NapCatQQ/src/core/index.js';

const DEFAULT_BRIDGE_PORT = 40654;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

interface RpcRequest {
    id?: string | number;
    method?: string;
    params?: unknown;
}

/** NapCat Core API JSON-RPC 桥接服务。 */
export class RustBridgeServer {
    private core: NapCatCore;
    private server: http.Server | null = null;
    private port: number;

    constructor(core: NapCatCore, port?: number) {
        this.core = core;
        this.port = port ?? (Number(process.env.QCE_BRIDGE_PORT) || DEFAULT_BRIDGE_PORT);
    }

    getPort(): number {
        return this.port;
    }

    async start(): Promise<void> {
        if (this.server) return;
        const server = http.createServer((req, res) => {
            void this.handleRequest(req, res);
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(this.port, '127.0.0.1', () => {
                server.removeListener('error', reject);
                resolve();
            });
        });
        this.server = server;
    }

    async stop(): Promise<void> {
        const server = this.server;
        this.server = null;
        if (!server) return;
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            if (req.method === 'GET' && req.url === '/healthz') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
                return;
            }
            if (req.method !== 'POST' || req.url !== '/rpc') {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'not found' }));
                return;
            }
            const body = await readBody(req);
            let parsed: RpcRequest;
            try {
                parsed = JSON.parse(body) as RpcRequest;
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
                return;
            }
            const result = await this.dispatch(String(parsed.method ?? ''), parsed.params);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result: result ?? null }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            try {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: message }));
            } catch {
                /* 连接已断开 */
            }
        }
    }

    private async dispatch(method: string, params: unknown): Promise<unknown> {
        if (!method) throw new Error('缺少 method');
        if (method === 'Core.selfInfo') {
            return this.core.selfInfo;
        }
        if (method === 'MsgApi.getMsgsBySeqRange') {
            // NapCat 侧该方法在 msgService 上（而不是 MsgApi）。
            const args = Array.isArray(params) ? params : [];
            const session = this.core.context.session as unknown as {
                getMsgService: () => { getMsgsBySeqRange: (...a: unknown[]) => Promise<unknown> };
            };
            return await session.getMsgService().getMsgsBySeqRange(...args);
        }
        if (method === 'PacketApi.getGroupFileUrl') {
            const args = Array.isArray(params) ? params : [];
            const packetApi = this.core.apis.PacketApi as unknown as {
                pkt: { operation: { GetGroupFileUrl: (groupCode: string, fileId: string) => Promise<unknown> } };
            };
            return await packetApi.pkt.operation.GetGroupFileUrl(String(args[0]), String(args[1]));
        }
        const dotIndex = method.indexOf('.');
        if (dotIndex <= 0) throw new Error(`非法 method: ${method}`);
        const apiName = method.slice(0, dotIndex);
        const fnName = method.slice(dotIndex + 1);
        const apis = this.core.apis as unknown as Record<string, Record<string, unknown>>;
        const api = apis?.[apiName];
        const fn = api?.[fnName];
        if (typeof fn !== 'function') {
            throw new Error(`API 不可用: ${method}`);
        }
        const args = Array.isArray(params) ? params : params === undefined ? [] : [params];
        return await (fn as (...a: unknown[]) => Promise<unknown>).apply(api, args);
    }
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        req.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                reject(new Error('请求体过大'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

/** 查找 qce-server 可执行文件（Rust 版服务端）。 */
export function findRustServerBinary(): string | null {
    const explicit = process.env.QCE_RUST_SERVER_PATH;
    if (explicit && fs.existsSync(explicit)) return explicit;

    const names = process.platform === 'win32' ? ['qce-server.exe'] : ['qce-server'];
    const roots: string[] = [process.cwd(), path.join(process.cwd(), 'bin')];
    // 从本文件所在目录逐级向上找（lib/api → lib → 插件根 → plugins → 包根），
    // 插件宿主进程的 cwd 可能是 QQ 安装目录而不是包根。
    let dir = currentDir();
    for (let i = 0; i < 6; i++) {
        roots.push(dir, path.join(dir, 'bin'));
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    for (const root of roots) {
        for (const name of names) {
            const candidate = path.join(root, name);
            if (fs.existsSync(candidate)) return candidate;
        }
    }
    return null;
}

function currentDir(): string {
    try {
        return path.dirname(fileURLToPath(import.meta.url));
    } catch {
        return process.cwd();
    }
}

/** qce-server（Rust）子进程管理。 */
export class RustServerProcess {
    private child: ChildProcess | null = null;
    private binaryPath: string;
    private log: (message: string) => void;

    constructor(binaryPath: string, log: (message: string) => void) {
        this.binaryPath = binaryPath;
        this.log = log;
    }

    start(bridgePort: number): void {
        if (this.child) return;
        const packageRoot = path.dirname(this.binaryPath);
        const staticDir = path.join(packageRoot, 'static', 'qce');
        const child = spawn(this.binaryPath, [], {
            cwd: packageRoot,
            env: {
                ...process.env,
                QCE_BRIDGE_ENDPOINT: `http://127.0.0.1:${bridgePort}`,
                QCE_STATIC_DIR: staticDir
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        // Rust 服务端日志走 stdout（console_layer 已配置 with_writer(stdout)）。
        // 直接写出到 process.stdout 而不走 NapCat 的 logger.log()：
        //   logger.log() 会同时输出 NapCat 格式行 + console 行，导致双份日志。
        child.stdout?.on('data', (data: Buffer) => {
            const msg = data.toString().trimEnd();
            if (msg) process.stdout.write(msg + '\n');
        });
        child.stderr?.on('data', (data: Buffer) => {
            const msg = data.toString().trimEnd();
            if (msg) process.stderr.write(`[qce-server:stderr] ${msg}\n`);
        });
        child.on('exit', (code) => {
            this.log(`[QCE] qce-server 已退出，code=${code}`);
            this.child = null;
        });
        this.child = child;
    }

    stop(): void {
        const child = this.child;
        this.child = null;
        if (!child) return;
        try {
            child.kill();
        } catch {
            /* 已退出 */
        }
    }

    isRunning(): boolean {
        return this.child !== null;
    }
}
