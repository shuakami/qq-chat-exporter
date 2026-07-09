'use client';

import { isSameDay } from 'date-fns';
import { CornerDownLeft } from 'lucide-react';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { selectTriggerVariants } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface DateRangePickerProps {
  /** Start time, YYYY-MM-DDTHH:mm format; empty means unset. */
  startTime?: string;
  /** End time, YYYY-MM-DDTHH:mm format; empty means unset. */
  endTime?: string;
  onChange?: (start: string, end: string) => void;
  placeholder?: string;
  defaultMonth?: Date;
  className?: string;
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseClock(value?: string, fallback = '00:00'): string {
  if (!value) return fallback;
  const [, time] = value.split('T');
  if (!time) return fallback;
  return time.slice(0, 5);
}

function combine(date: Date | undefined, clock: string): string {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T${clock || '00:00'}`;
}

function formatDisplay(date?: Date): string {
  if (!date) return '';
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

export function DateRangePicker({
  startTime,
  endTime,
  onChange,
  placeholder = 'Pick a date range',
  defaultMonth,
  className,
}: DateRangePickerProps): React.ReactElement {
  const [isOpen, setIsOpen] = React.useState(false);

  const from = parseDate(startTime);
  const to = parseDate(endTime);
  const range: DateRange | undefined = from ? { from, to } : undefined;

  const startClock = parseClock(startTime, '00:00');
  const endClock = parseClock(endTime, '23:59');

  const emit = React.useCallback(
    (nextRange: DateRange | undefined, sClock: string, eClock: string) => {
      const s = combine(nextRange?.from, sClock);
      const e = combine(nextRange?.to ?? nextRange?.from, eClock);
      onChange?.(s, e);
    },
    [onChange],
  );

  const handleSelect = ((nextRange: DateRange | undefined, selectedDay: Date) => {
    if (range?.from && range?.to) {
      if (isSameDay(selectedDay, range.from) || isSameDay(selectedDay, range.to)) {
        emit(undefined, startClock, endClock);
        return;
      }
    }
    emit(nextRange, startClock, endClock);
  }) as (range: DateRange | undefined, selectedDay: Date) => void;

  const timeInputClass =
    'h-8 w-[120px] shrink-0 rounded-lg bg-black/[0.03] px-2 text-center text-[13px] tabular-nums outline-none transition-colors focus:bg-black/[0.05] dark:bg-white/[0.05] dark:focus:bg-white/[0.08]';

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        className={cn(selectTriggerVariants({ size: 'sm' }), 'justify-start', className)}
      >
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
          <span className="text-foreground">{placeholder}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto overflow-hidden rounded-xl p-0 shadow-xl">
        <div className="flex w-full flex-col bg-popover sm:w-max sm:flex-row">
          <div className="flex w-full shrink-0 justify-center p-3 sm:w-[280px]">
            <Calendar
              mode="range"
              defaultMonth={from ?? defaultMonth}
              selected={range}
              onSelect={handleSelect}
              numberOfMonths={1}
            />
          </div>

          <div className="flex w-full shrink-0 flex-col justify-between border-t p-4 sm:w-[236px] sm:border-t-0 sm:border-l">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] text-muted-foreground">Start</label>
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[13px] text-foreground tabular-nums">
                    {from ? formatDisplay(from) : '--'}
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
                <label className="text-[12px] text-muted-foreground">End</label>
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-[13px] text-foreground tabular-nums">
                    {to ? formatDisplay(to) : from ? formatDisplay(from) : '--'}
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

            <div className="mt-4 flex flex-col gap-3">
              <Button
                variant="outline"
                size="sm"
                className="group w-full justify-center font-normal"
                onClick={() => setIsOpen(false)}
              >
                Apply
                <CornerDownLeft className="ml-1.5 size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
              </Button>
              {(from || to) && (
                <button
                  type="button"
                  className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => {
                    emit(undefined, startClock, endClock);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
