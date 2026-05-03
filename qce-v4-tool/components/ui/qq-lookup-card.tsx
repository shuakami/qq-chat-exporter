"use client"

/**
 * 按 QQ 号反查会话（issue #204）。
 *
 * 用户场景：好友销号 / 主动从好友列表移除 / 临时窗口对方头像与昵称失踪后，
 * QCE 自带的「好友 + 群 + 最近联系人」拼出来的列表里就找不到这个号了。但
 * 本机 NTQQ 数据库里仍然留着对话历史，QCE 后端 `getUidByUinV2` 能把 uin
 * 反查到 uid，按 peer 取消息的链路依然可用。
 *
 * 这张卡片接入 `GET /api/users/lookup?uin=...`，让用户只输入一个 QQ 号
 * 就能调出对应聊天，并把它当成一条普通会话直接送进任务向导导出。
 */

import { useCallback, useState } from "react"
import { Button } from "./button"
import { Input } from "./input"
import { Avatar, AvatarFallback, AvatarImage } from "./avatar"
import { useApi } from "@/hooks/use-api"
import { Search, User, AlertCircle, Loader2 } from "lucide-react"

interface UserLookupResult {
    found: boolean
    uin: string
    uid?: string
    nick?: string
    remark?: string
    avatarUrl?: string
    isFriend?: boolean
    reason?: string
}

interface QqLookupCardProps {
    /** 初始 QQ 号；常见用法是把搜索框里的纯数字传进来。 */
    initialUin?: string
    /** 用户点击「导出聊天记录」时回调，给上层去打开任务向导。 */
    onStartExport: (preset: { chatType: number; peerUid: string; sessionName: string }) => void
    /** 用户点击「预览」时回调；不传则不展示预览按钮。 */
    onPreview?: (peer: { chatType: number; peerUid: string }, sessionName: string) => void
}

const UIN_REGEX = /^\d{4,12}$/

export function QqLookupCard({ initialUin = "", onStartExport, onPreview }: QqLookupCardProps) {
    const { apiCall } = useApi()
    const [uin, setUin] = useState(initialUin)
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<UserLookupResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    const submit = useCallback(async () => {
        const trimmed = uin.trim()
        if (!UIN_REGEX.test(trimmed)) {
            setError("请输入 4-12 位的纯数字 QQ 号")
            setResult(null)
            return
        }
        setError(null)
        setResult(null)
        setLoading(true)
        try {
            const resp = await apiCall<UserLookupResult>(`/api/users/lookup?uin=${encodeURIComponent(trimmed)}`)
            setResult(resp.data ?? null)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [apiCall, uin])

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault()
            submit()
        }
    }

    return (
        <div className="mt-6 mx-auto max-w-md text-left rounded-xl border border-black/[0.06] dark:border-white/[0.06] bg-card p-4 space-y-3">
            <div>
                <p className="text-sm font-medium text-foreground">按 QQ 号反查会话</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                    对方账号已注销 / 已删除好友、但本机仍留有聊天记录时，可以直接输入对方 QQ 号定位到那条聊天。
                </p>
            </div>

            <div className="flex gap-2">
                <Input
                    inputMode="numeric"
                    pattern="\\d*"
                    placeholder="QQ 号 (例如 123456789)"
                    value={uin}
                    onChange={(e) => setUin(e.target.value)}
                    onKeyDown={onKeyDown}
                    className="flex-1 h-9 text-sm rounded-lg"
                />
                <Button
                    onClick={submit}
                    disabled={loading || !uin.trim()}
                    size="sm"
                    className="h-9 px-3 rounded-lg"
                >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                    <span className="ml-1.5">{loading ? "查询中" : "查询"}</span>
                </Button>
            </div>

            {error && (
                <div className="flex items-start gap-2 text-xs text-destructive">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}

            {result && !result.found && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span>{result.reason || "未在本机数据中找到该 QQ 号对应的会话。"}</span>
                </div>
            )}

            {result && result.found && result.uid && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-black/[0.02] dark:bg-white/[0.03]">
                    <Avatar className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
                        <AvatarImage src={result.avatarUrl} alt={result.nick || result.uin} />
                        <AvatarFallback className="rounded-full text-xs">
                            <User className="w-4 h-4" />
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground truncate">
                                {result.remark || result.nick || `用户 ${result.uin}`}
                            </p>
                            {result.isFriend ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                    好友
                                </span>
                            ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-500">
                                    非好友 / 已注销
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground/60 font-mono truncate mt-0.5">{result.uin}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        {onPreview && (
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2.5 text-xs rounded-full"
                                onClick={() =>
                                    onPreview(
                                        { chatType: 1, peerUid: result.uid! },
                                        result.remark || result.nick || result.uin,
                                    )
                                }
                            >
                                预览
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2.5 text-xs rounded-full"
                            onClick={() =>
                                onStartExport({
                                    chatType: 1,
                                    peerUid: result.uid!,
                                    sessionName: result.remark || result.nick || result.uin,
                                })
                            }
                        >
                            导出
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
