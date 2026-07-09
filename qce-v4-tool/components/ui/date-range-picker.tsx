"use client"

import * as React from "react"
import { isSameDay } from "date-fns"
import { CornerDownLeft, Calendar as CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Calendar } from "./calendar"
import { Button } from "./button"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

export interface DateRangePickerProps {
  /** 开始时间，格式 YYYY-MM-DDTHH:mm，留空表示未设置 */
  startTime?: string
  /** 结束时间，格式 YYYY-MM-DDTHH:mm，留空表示未设置 */
  endTime?: string
  onChange?: (start: string, end: string) => void
  className?: string
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return isNaN(d.getTime()) ? undefined : d
}

function parseClock(value?: string, fallback = "00:00"): string {
  if (!value) return fallback
  const [, time] = value.split("T")
  if (!time) return fallback
  return time.slice(0, 5)
}

function combine(date: Date | undefined, clock: string): string {
  if (!date) return ""
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}T${clock || "00:00"}`
}

function formatDisplay(date?: Date): string {
  if (!date) return ""
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`
}

export function DateRangePicker({ startTime, endTime, onChange, className }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false)

  const from = parseDate(startTime)
  const to = parseDate(endTime)
  const range: DateRange | undefined = from ? { from, to } : undefined

  const startClock = parseClock(startTime, "00:00")
  const endClock = parseClock(endTime, "23:59")

  const emit = React.useCallback(
    (nextRange: DateRange | undefined, sClock: string, eClock: string) => {
      const s = combine(nextRange?.from, sClock)
      const e = combine(nextRange?.to ?? nextRange?.from, eClock)
      onChange?.(s, e)
    },
    [onChange]
  )

  // react-day-picker range 选择回调（点击已选端点则清空）
  const handleSelect = ((nextRange: DateRange | undefined, selectedDay: Date) => {
    if (range?.from && range?.to) {
      if (isSameDay(selectedDay, range.from) || isSameDay(selectedDay, range.to)) {
        emit(undefined, startClock, endClock)
        return
      }
    }
    emit(nextRange, startClock, endClock)
  }) as (range: DateRange | undefined, selectedDay: Date) => void

  const timeInputClass =
    "w-[64px] text-center shrink-0 px-2 text-[13px] h-8 rounded-lg bg-black/[0.03] dark:bg-white/[0.05] outline-none focus:bg-black/[0.05] dark:focus:bg-white/[0.08] tabular-nums transition-colors"

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 w-full h-[36px] px-4 rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-[13px] text-foreground hover:bg-black/[0.06] dark:hover:bg-white/[0.09] transition-colors outline-none text-left",
            className
          )}
        >
          <CalendarIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          {from ? (
            <span className="flex items-center gap-2 tabular-nums">
              <span>{formatDisplay(from)}</span>
              {to && !isSameDay(from, to) && (
                <>
                  <span className="text-muted-foreground">-</span>
                  <span>{formatDisplay(to)}</span>
                </>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground/70">选择时间范围（留空导出全部）</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0 rounded-xl shadow-xl border border-black/[0.08] dark:border-white/[0.14] overflow-hidden"
      >
        <div className="flex flex-col sm:flex-row w-full sm:w-max bg-popover">
          {/* 日历 */}
          <div className="p-3 shrink-0 flex justify-center w-full sm:w-[280px]">
            <Calendar
              mode="range"
              defaultMonth={from}
              selected={range}
              onSelect={handleSelect}
              numberOfMonths={1}
            />
          </div>

          {/* 右侧输入与操作 */}
          <div className="p-4 shrink-0 flex flex-col justify-between border-t sm:border-t-0 sm:border-l border-black/[0.08] dark:border-white/[0.14] w-full sm:w-[196px]">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] text-muted-foreground">开始</label>
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[13px] tabular-nums text-foreground">
                    {from ? formatDisplay(from) : "--"}
                  </span>
                  <input
                    type="time"
                    value={startClock}
                    onChange={(e) => emit(range, e.target.value, endClock)}
                    className={timeInputClass}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] text-muted-foreground">结束</label>
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[13px] tabular-nums text-foreground">
                    {to ? formatDisplay(to) : from ? formatDisplay(from) : "--"}
                  </span>
                  <input
                    type="time"
                    value={endClock}
                    onChange={(e) => emit(range, startClock, e.target.value)}
                    className={timeInputClass}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-4">
              <Button
                variant="ghost"
                className="w-full justify-center h-8 text-[13px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                onClick={() => {
                  const today = new Date()
                  emit({ from: today, to: today }, startClock, endClock)
                }}
              >
                回到今天
              </Button>
              <Button
                variant="outline"
                className="w-full justify-center h-8 text-[13px] font-normal group bg-white dark:bg-neutral-900 border border-black/[0.08] dark:border-white/[0.1] hover:bg-neutral-50 dark:hover:bg-neutral-800 shadow-sm"
                onClick={() => setIsOpen(false)}
              >
                应用
                <CornerDownLeft className="ml-1.5 w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
              </Button>
              {(from || to) && (
                <button
                  type="button"
                  className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    emit(undefined, startClock, endClock)
                  }}
                >
                  清除
                </button>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
