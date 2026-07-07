"use client"

import React, { useRef } from "react"
import { cn } from "@/lib/utils"

interface DateSegmentProps {
  value: string
  onChange: (val: string) => void
  maxLength: number
  placeholder: string
  className?: string
  onNext?: () => void
  onPrev?: () => void
}

const DateSegment = React.forwardRef<HTMLInputElement, DateSegmentProps>(
  ({ value, onChange, maxLength, placeholder, className, onNext, onPrev }, ref) => {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowRight" && value.length === maxLength) {
        onNext?.()
      } else if (e.key === "ArrowLeft" && value.length === 0) {
        onPrev?.()
      } else if (e.key === "/" || e.key === "-" || e.key === ":") {
        e.preventDefault()
        onNext?.()
      }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.replace(/\D/g, "").slice(0, maxLength)
      onChange(val)
      if (val.length === maxLength) {
        onNext?.()
      }
    }

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          "bg-transparent outline-none text-center tabular-nums focus:bg-black/[0.04] dark:focus:bg-white/[0.06] rounded px-0.5 text-[13px]",
          className
        )}
      />
    )
  }
)
DateSegment.displayName = "DateSegment"

interface DateTimeInputGroupProps {
  value: string
  onChange: (val: string) => void
  className?: string
}

export function DateTimeInputGroup({ value, onChange, className }: DateTimeInputGroupProps) {
  const [year, setYear] = React.useState("")
  const [month, setMonth] = React.useState("")
  const [day, setDay] = React.useState("")
  const [hour, setHour] = React.useState("")
  const [minute, setMinute] = React.useState("")

  const yearRef = useRef<HTMLInputElement>(null)
  const monthRef = useRef<HTMLInputElement>(null)
  const dayRef = useRef<HTMLInputElement>(null)
  const hourRef = useRef<HTMLInputElement>(null)
  const minuteRef = useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (value) {
      const [datePart, timePart] = value.split("T")
      if (datePart) {
        const [y, m, d] = datePart.split("-")
        setYear(y || "")
        setMonth(m || "")
        setDay(d || "")
      }
      if (timePart) {
        const [h, min] = timePart.split(":")
        setHour(h || "")
        setMinute(min || "")
      }
    } else {
      setYear("")
      setMonth("")
      setDay("")
      setHour("")
      setMinute("")
    }
  }, [value])

  const emitChange = React.useCallback((y: string, m: string, d: string, h: string, min: string) => {
    if (y.length === 4 && m.length >= 1 && d.length >= 1) {
      const paddedM = m.padStart(2, "0")
      const paddedD = d.padStart(2, "0")
      const paddedH = (h || "00").padStart(2, "0")
      const paddedMin = (min || "00").padStart(2, "0")
      onChange(`${y}-${paddedM}-${paddedD}T${paddedH}:${paddedMin}`)
    }
  }, [onChange])

  const handleYear = (v: string) => { setYear(v); emitChange(v, month, day, hour, minute) }
  const handleMonth = (v: string) => { setMonth(v); emitChange(year, v, day, hour, minute) }
  const handleDay = (v: string) => { setDay(v); emitChange(year, month, v, hour, minute) }
  const handleHour = (v: string) => { setHour(v); emitChange(year, month, day, v, minute) }
  const handleMinute = (v: string) => { setMinute(v); emitChange(year, month, day, hour, v) }

  return (
    <div className={cn(
      "flex items-center gap-[2px] px-3 py-1.5 border border-black/[0.06] dark:border-white/[0.08] rounded-lg bg-black/[0.02] dark:bg-white/[0.03] text-[13px] text-foreground focus-within:border-black/[0.12] dark:focus-within:border-white/[0.15] transition-all w-full",
      className
    )}>
      <DateSegment
        ref={yearRef}
        placeholder="年"
        value={year}
        onChange={handleYear}
        maxLength={4}
        onNext={() => monthRef.current?.focus()}
        className="w-[38px]"
      />
      <span className="text-muted-foreground mx-[1px]">/</span>
      <DateSegment
        ref={monthRef}
        placeholder="月"
        value={month}
        onChange={handleMonth}
        maxLength={2}
        onNext={() => dayRef.current?.focus()}
        onPrev={() => yearRef.current?.focus()}
        className="w-[24px]"
      />
      <span className="text-muted-foreground mx-[1px]">/</span>
      <DateSegment
        ref={dayRef}
        placeholder="日"
        value={day}
        onChange={handleDay}
        maxLength={2}
        onNext={() => hourRef.current?.focus()}
        onPrev={() => monthRef.current?.focus()}
        className="w-[24px]"
      />
      <span className="text-muted-foreground mx-1.5">-</span>
      <DateSegment
        ref={hourRef}
        placeholder="--"
        value={hour}
        onChange={handleHour}
        maxLength={2}
        onNext={() => minuteRef.current?.focus()}
        onPrev={() => dayRef.current?.focus()}
        className="w-[24px]"
      />
      <span className="text-muted-foreground mx-[1px]">:</span>
      <DateSegment
        ref={minuteRef}
        placeholder="--"
        value={minute}
        onChange={handleMinute}
        maxLength={2}
        onPrev={() => hourRef.current?.focus()}
        className="w-[24px]"
      />
    </div>
  )
}
