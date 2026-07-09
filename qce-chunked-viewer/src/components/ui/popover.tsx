'use client';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const Popover: typeof PopoverPrimitive.Root = PopoverPrimitive.Root;
export const PopoverTrigger: typeof PopoverPrimitive.Trigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'start',
  ...props
}: PopoverPrimitive.Popup.Props & {
  side?: PopoverPrimitive.Positioner.Props['side'];
  sideOffset?: PopoverPrimitive.Positioner.Props['sideOffset'];
  align?: PopoverPrimitive.Positioner.Props['align'];
}): React.ReactElement {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        className="z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          className={cn(
            'origin-(--transform-origin) rounded-lg border bg-popover text-foreground shadow-lg/5 outline-none',
            className,
          )}
          data-slot="popover-popup"
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}
