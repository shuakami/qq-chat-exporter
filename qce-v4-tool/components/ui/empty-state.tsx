"use client"

import { Button } from "./button"
import { Card, CardContent } from "./card"

interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-12">
        <div className="text-neutral-300 mb-4">
          {icon}
        </div>
        <h3 className="text-lg font-medium text-neutral-900 mb-2">
          {title}
        </h3>
        <p className="text-neutral-600 text-center max-w-sm mb-6">
          {description}
        </p>
        {action && (
          <Button onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}