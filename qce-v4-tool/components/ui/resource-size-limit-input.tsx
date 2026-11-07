"use client"

import { useEffect, useState } from "react"
import { Input } from "./input"
import { PillDropdown } from "./pill-dropdown"

/**
 * Issue #663：资源下载大小上限输入框。
 *
 * 对外是「字节」数值（与后端 `options.maxFileDownloadSizeBytes` /
 * `maxVideoDownloadSizeBytes` 契约一致，0 / undefined = 不限制）；对内用
 * 「数值 + 单位（MB/GB）」的方式编辑，避免用户手算字节。
 *
 * 单位按 1024 进制换算，与 `formatFileSize` 的显示口径一致。
 */

const PILL_INPUT =
  "h-[36px] px-3.5 rounded-full border-0 bg-black/[0.04] dark:bg-white/[0.06] text-[13px] outline-none placeholder:text-muted-foreground/70 focus:bg-black/[0.06] dark:focus:bg-white/[0.09] transition-colors"

type SizeUnit = "MB" | "GB"

const UNIT_BYTES: Record<SizeUnit, number> = {
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
}

const UNIT_OPTIONS: { value: SizeUnit; label: string }[] = [
  { value: "MB", label: "MB" },
  { value: "GB", label: "GB" },
]

/** 从外部字节值推导「数值 + 单位」：>= 1GB 用 GB 展示，否则用 MB。 */
function bytesToDisplay(bytes: number | undefined): { amount: string; unit: SizeUnit } {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return { amount: "", unit: "MB" }
  }
  if (bytes >= UNIT_BYTES.GB) {
    const gb = bytes / UNIT_BYTES.GB
    // 保留至多 2 位小数，去掉多余的 0。
    return { amount: String(parseFloat(gb.toFixed(2))), unit: "GB" }
  }
  const mb = bytes / UNIT_BYTES.MB
  return { amount: String(parseFloat(mb.toFixed(2))), unit: "MB" }
}

export function ResourceSizeLimitInput({
  label,
  placeholder = "不限制",
  valueBytes,
  onChange,
  disabled,
}: {
  /** 字段标签，例如「文件大小上限」。 */
  label: string
  /** 数值输入框占位文本，默认「不限制」。 */
  placeholder?: string
  /** 当前上限（字节）；undefined / 0 / 负数均视为不限制。 */
  valueBytes?: number
  /** 编辑后回调：有效正数为字节数，清空或非法输入回调 undefined。 */
  onChange: (bytes: number | undefined) => void
  disabled?: boolean
}) {
  const [amount, setAmount] = useState("")
  const [unit, setUnit] = useState<SizeUnit>("MB")

  // 外部值变化（预填充 / 重置 / 偏好恢复）时同步显示态。
  useEffect(() => {
    const display = bytesToDisplay(valueBytes)
    setAmount(display.amount)
    setUnit(display.unit)
    // 只在外部字节值变化时同步，避免打字过程中被自身回写打断。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueBytes])

  const emit = (nextAmount: string, nextUnit: SizeUnit) => {
    const parsed = parseFloat(nextAmount)
    if (!nextAmount.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      onChange(undefined)
      return
    }
    onChange(Math.floor(parsed * UNIT_BYTES[nextUnit]))
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-medium text-foreground/80">{label}</label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          placeholder={placeholder}
          value={amount}
          disabled={disabled}
          onChange={(e) => {
            setAmount(e.target.value)
            emit(e.target.value, unit)
          }}
          className={PILL_INPUT + " flex-1 min-w-0"}
        />
        <PillDropdown
          value={unit}
          onChange={(next) => {
            setUnit(next)
            emit(amount, next)
          }}
          options={UNIT_OPTIONS}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
