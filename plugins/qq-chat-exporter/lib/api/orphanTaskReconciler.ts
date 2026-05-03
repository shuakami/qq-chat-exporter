/**
 * Issue #144: 服务进程重启 / 崩溃后，DB 里那些状态还停在 `running` /
 * `pending` 的任务实际已经没人在跑（in-memory 的 BatchMessageFetcher
 * 状态都没了）。直接让它们继续以「执行中」的样子鬼灯到前端会让用户
 * 一直等不到结束，所以重启后统一把这种「孤儿任务」拍成 `failed` 并写
 * 回 DB，并附上一句一眼就能看懂的 error，让用户知道是「服务重启导致
 * 进度丢失」。
 *
 * 这里抽出纯函数仅做状态归一化，不直接接触 DB，方便单测覆盖各种边界。
 */

/** 与 ExportTaskStatus 一致的字符串常量集合（只列出我们关心的几种）。 */
export type PersistedTaskStatus =
    | 'pending'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | string

/** 给前端 / DB 用的最小化任务字段视图。 */
export interface ReconcilableTask {
    status: PersistedTaskStatus
    error?: string
}

export interface ReconciledTask {
    status: PersistedTaskStatus
    error?: string
    /** 是否本次启动被识别为孤儿任务并改写了状态。 */
    wasOrphan: boolean
}

/**
 * 服务进程重启时，孤儿任务的默认错误描述。前端会原样显示在任务列表里。
 */
export const ORPHAN_TASK_ERROR_MESSAGE =
    '服务上次启动时进度丢失，请删除该任务后重新创建（issue #144）'

/**
 * 给单个任务做状态归一化：
 *
 * - `running` / `pending`：视为孤儿，置为 `failed`，并写入默认 error。
 *   如果原本就有 `error`，保留用户已经看到的描述。
 * - 其它状态（`completed` / `failed` / `paused` / `cancelled` / 未知值）：
 *   保留原样。`paused` 仍然是用户主动暂停的语义，不是崩溃。
 */
export function reconcileOrphanedTask(task: ReconcilableTask): ReconciledTask {
    const status = task.status
    if (status === 'running' || status === 'pending') {
        return {
            status: 'failed',
            error: task.error && task.error.length > 0 ? task.error : ORPHAN_TASK_ERROR_MESSAGE,
            wasOrphan: true,
        }
    }
    return {
        status,
        error: task.error,
        wasOrphan: false,
    }
}

/**
 * Issue #144: 给 WebSocket 连接刚建立时下发的「任务全量同步」消息构造
 * 一份精简 payload。挂在前端，能让前端马上拿到当前 in-memory 的所有任务
 * 进度，而不必再单独发一次 GET /api/tasks 请求。
 *
 * 我们只挑前端真正需要的字段，避免把数据库里所有附加字段都序列化一份
 * 占带宽。
 */
export interface ResyncedTaskView {
    taskId: string
    status: PersistedTaskStatus
    progress: number
    messageCount: number
    error?: string
}

export interface RawTaskLike {
    taskId?: string
    status?: PersistedTaskStatus
    progress?: number
    messageCount?: number
    error?: string
}

export function buildTaskResyncPayload(tasks: RawTaskLike[]): ResyncedTaskView[] {
    const out: ResyncedTaskView[] = []
    for (const t of tasks) {
        if (!t || typeof t.taskId !== 'string' || t.taskId.length === 0) continue
        out.push({
            taskId: t.taskId,
            status: typeof t.status === 'string' ? t.status : 'pending',
            progress: typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0,
            messageCount:
                typeof t.messageCount === 'number' && Number.isFinite(t.messageCount)
                    ? t.messageCount
                    : 0,
            error: typeof t.error === 'string' && t.error.length > 0 ? t.error : undefined,
        })
    }
    return out
}
