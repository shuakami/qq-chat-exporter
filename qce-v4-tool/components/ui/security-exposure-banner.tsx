"use client"

import { useCallback, useEffect, useState } from "react"
import { useApi } from "@/hooks/use-api"

interface IpWhitelistData {
  allowedIPs: string[]
  disabled: boolean
  isDocker: boolean
  currentClientIP: string | null
}

type ExposureLevel = "critical" | "warning" | null

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""])

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost")
}

/** 判断一个 IP 是否属于回环/内网（即“非公网”）。无法判断时保守当作内网。 */
function isPrivateOrLoopbackIp(ip: string | null | undefined): boolean {
  if (!ip) return true
  const c = ip.trim().replace(/^::ffff:/i, "").replace(/^\[|\]$/g, "")
  if (c === "::1" || c === "127.0.0.1" || c.startsWith("127.")) return true
  if (c.startsWith("10.") || c.startsWith("192.168.")) return true
  const m = c.match(/^172\.(\d+)\./)
  if (m) {
    const second = Number(m[1])
    if (second >= 16 && second <= 31) return true
  }
  if (c.startsWith("169.254.")) return true
  const lower = c.toLowerCase()
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) return true
  return false
}

/** 命中「放行全部」的通配规则时，白名单形同虚设。 */
const WILDCARD_RULES = new Set(["*", "0.0.0.0", "0.0.0.0/0", "::/0"])

function hasWildcardRule(allowedIPs: string[]): boolean {
  return allowedIPs.some((rule) => WILDCARD_RULES.has(rule.trim()))
}

function computeLevel(data: IpWhitelistData): ExposureLevel {
  const host = typeof window !== "undefined" ? window.location.hostname : ""
  // 只要「页面是通过非回环域名/IP 打开的」，或「后端看到的客户端 IP 是公网」，
  // 都说明这个实例正在被本机以外的网络访问。
  const servedRemotely = !isLoopbackHost(host) || !isPrivateOrLoopbackIp(data.currentClientIP)

  const wildcard = hasWildcardRule(data.allowedIPs)
  // 白名单被关闭，或名单里含「放行全部」的通配规则，都等于没有 IP 保护。
  const whitelistOpen = data.disabled === true || wildcard

  // 通配规则最危险：开关看起来是「开」，实际对任何 IP 放行，用户很容易误以为已受保护。
  // 因此只要存在通配规则、或确实正在被远端访问且无保护，都判为红色严重告警。
  if (whitelistOpen && (servedRemotely || wildcard)) return "critical"
  if (whitelistOpen || servedRemotely) return "warning"
  return null
}

export function SecurityExposureBanner() {
  const { apiCall } = useApi()
  const [data, setData] = useState<IpWhitelistData | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [protecting, setProtecting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiCall<IpWhitelistData>("/api/security/ip-whitelist")
      if (res.success && res.data) {
        setData(res.data)
      }
    } catch {
      // 网络/鉴权异常时不打扰用户，交给全局鉴权逻辑处理。
    }
  }, [apiCall])

  useEffect(() => {
    void load()
  }, [load])

  const level = data ? computeLevel(data) : null

  const handleProtect = useCallback(async () => {
    setProtecting(true)
    try {
      // 先把当前访问 IP 加入白名单，避免开启后把自己也挡在门外。
      await apiCall("/api/security/ip-whitelist/add-current", { method: "POST" }).catch(() => null)
      // 去掉「放行全部」的通配规则，否则白名单形同虚设、告警也无法解除。
      const wildcards = (data?.allowedIPs ?? []).filter((rule) => WILDCARD_RULES.has(rule.trim()))
      for (const rule of wildcards) {
        await apiCall("/api/security/ip-whitelist", {
          method: "DELETE",
          body: JSON.stringify({ ip: rule }),
        }).catch(() => null)
      }
      // 最后开启白名单校验。
      await apiCall("/api/security/ip-whitelist/toggle", {
        method: "PUT",
        body: JSON.stringify({ disabled: false }),
      })
      await load()
    } finally {
      setProtecting(false)
    }
  }, [apiCall, data, load])

  if (!level || dismissed) return null

  const isCritical = level === "critical"
  const wildcard = !!data && hasWildcardRule(data.allowedIPs)

  const showClientIp = !!data?.currentClientIP && !isPrivateOrLoopbackIp(data.currentClientIP)

  return (
    <div
      role="alert"
      className={
        isCritical
          ? "border-b border-red-600/20 bg-red-600 text-white dark:bg-red-700"
          : "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100"
      }
    >
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">
            {isCritical
              ? wildcard
                ? "IP 白名单里有「放行全部」规则，等于对任何 IP 开放"
                : "服务正暴露在公网 / 局域网，且未开启 IP 白名单"
              : "服务可能可被本机以外的网络访问"}
          </p>
          <p
            className={
              "mt-0.5 text-[12px] leading-relaxed " +
              (isCritical ? "text-white/80" : "text-amber-800/75 dark:text-amber-200/70")
            }
          >
            {isCritical
              ? wildcard
                ? "通配规则让白名单形同虚设，只剩 Token 在守门，聊天记录一旦泄露就危险了，建议改成只放行你自己的 IP QAQ"
                : "目前只有 Token 在做保护，一旦泄露聊天记录就危险了，强烈建议开启 IP 白名单 QAQ"
              : "要是机器暴露在公网，光靠 Token 守门还是有点慌，最好加个 IP 白名单限制一下~"}
            {showClientIp && (
              <>
                {" "}当前来源 IP <span className="font-medium">{data!.currentClientIP}</span>。
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleProtect}
            disabled={protecting}
            className={
              "rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-60 " +
              (isCritical
                ? "bg-white text-red-700 hover:bg-white/90"
                : "bg-amber-600 text-white hover:bg-amber-600/90")
            }
          >
            {protecting ? "处理中…" : wildcard ? "收紧白名单" : "开启白名单保护"}
          </button>
          <button
            type="button"
            aria-label="暂时关闭提醒"
            onClick={() => setDismissed(true)}
            className={
              "px-2 py-1.5 text-[12px] transition-colors " +
              (isCritical ? "text-white/70 hover:text-white" : "text-amber-700/60 hover:text-amber-900")
            }
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

export default SecurityExposureBanner
