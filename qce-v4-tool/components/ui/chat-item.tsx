"use client"

import { Avatar, AvatarFallback, AvatarImage } from "./avatar"
import { Button } from "./button"
import { Badge } from "./badge"
import { Card, CardContent } from "./card"
import { Users, User, Circle } from "lucide-react"
import type { Group, Friend } from "@/types/api"

interface ChatItemProps {
  type: "group" | "friend"
  data: Group | Friend
  onExport: () => void
}

export function ChatItem({ type, data, onExport }: ChatItemProps) {
  const isGroup = type === "group"
  const group = isGroup ? (data as Group) : null
  const friend = !isGroup ? (data as Friend) : null
  
  const displayName = isGroup 
    ? group?.groupName 
    : (friend?.remark || friend?.nick)
    
  const identifier = isGroup 
    ? group?.groupCode 
    : friend?.uin?.toString()
    
  const avatarUrl = data.avatarUrl || ""
  const avatarFallback = displayName?.charAt(0).toUpperCase() || "?"

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <Avatar className="w-12 h-12">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="text-sm font-medium">
              {avatarFallback}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-neutral-900 truncate">
                {displayName}
              </h3>
              {!isGroup && friend?.isOnline && (
                <div className="flex items-center gap-1">
                  <Circle className="w-2 h-2 fill-green-500 text-green-500" />
                  <span className="text-xs text-green-600">在线</span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2 text-sm text-neutral-600">
              {isGroup ? (
                <>
                  <Users className="w-4 h-4" />
                  <span>{group?.memberCount} 成员</span>
                  <span className="text-neutral-400">•</span>
                  <span className="font-mono text-xs">{identifier}</span>
                </>
              ) : (
                <>
                  <User className="w-4 h-4" />
                  <span className="font-mono text-xs">{identifier}</span>
                  {friend?.remark && friend.nick !== friend.remark && (
                    <>
                      <span className="text-neutral-400">•</span>
                      <span className="text-xs text-neutral-500">{friend.nick}</span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          
          <Button 
            onClick={onExport}
            variant="outline" 
            size="sm"
            className="flex-shrink-0"
          >
            导出聊天记录
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}