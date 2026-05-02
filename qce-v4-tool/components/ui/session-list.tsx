"use client"

import { useMemo, useCallback, useEffect, useRef } from "react"
import { Button } from "./button"
import { Input } from "./input"
import { Avatar, AvatarFallback, AvatarImage } from "./avatar"
import { Checkbox } from "./checkbox"
import { Badge } from "./badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"
import {
  Search,
  Users,
  User,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  SortAsc,
  SortDesc,
  X,
  Filter,
  Keyboard,
} from "lucide-react"
import type { Group, Friend } from "@/types/api"
import {
  useSessionFilter,
  PAGE_SIZE_OPTIONS,
  type SessionItem,
  type SessionType,
  type SortField,
  type SortOrder,
} from "@/hooks/use-session-filter"

export interface SessionListProps {
  groups: Group[]
  friends: Friend[]
  isLoading?: boolean
  batchMode?: boolean
  selectedItems?: Set<string>
  avatarExportLoading?: string | null
  onRefresh?: () => void
  onToggleBatchMode?: () => void
  onSelectAll?: (filteredIds?: Set<string>) => void
  onClearSelection?: () => void
  onToggleItem?: (type: 'group' | 'friend', id: string) => void
  onOpenBatchExportDialog?: () => void
  onPreviewChat?: (type: 'group' | 'friend', id: string, name: string, peer: { chatType: number, peerUid: string }) => void
  onOpenTaskWizard?: (preset: { chatType: number, peerUid: string, sessionName: string }) => void
  onExportGroupAvatars?: (groupCode: string, groupName: string) => void
  onOpenEssenceModal?: (groupCode: string, groupName: string) => void
  onOpenGroupFilesModal?: (groupCode: string, groupName: string) => void
}

// Keyboard shortcuts help text
const KEYBOARD_SHORTCUTS = [
  { key: '/', description: '聚焦搜索' },
  { key: 'Esc', description: '清除搜索/退出批量模式' },
  { key: '←/→', description: '上一页/下一页' },
]

export function SessionList({
  groups,
  friends,
  isLoading = false,
  batchMode = false,
  selectedItems = new Set(),
  avatarExportLoading,
  onRefresh,
  onToggleBatchMode,
  onSelectAll,
  onClearSelection,
  onToggleItem,
  onOpenBatchExportDialog,
  onPreviewChat,
  onOpenTaskWizard,
  onExportGroupAvatars,
  onOpenEssenceModal,
  onOpenGroupFilesModal,
}: SessionListProps) {
  const {
    search,
    type,
    sortField,
    sortOrder,
    page,
    pageSize,
    setSearch,
    setType,
    setSortField,
    setSortOrder,
    setPage,
    setPageSize,
    resetFilters,
    filteredItems,
    paginatedItems,
    totalItems,
    totalPages,
    hasNextPage,
    hasPrevPage,
    groupCount,
    friendCount,
  } = useSessionFilter(groups, friends)

  const searchInputRef = useRef<HTMLInputElement>(null)

  const handleToggleSort = useCallback(() => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
  }, [sortOrder, setSortOrder])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      const isInputFocused = document.activeElement?.tagName === 'INPUT' || 
                             document.activeElement?.tagName === 'TEXTAREA'
      
      // Focus search with /
      if (e.key === '/' && !isInputFocused) {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      
      // Clear search or exit batch mode with Escape
      if (e.key === 'Escape') {
        if (search) {
          setSearch('')
        } else if (batchMode) {
          onToggleBatchMode?.()
        }
        searchInputRef.current?.blur()
        return
      }
      
      // Navigate pages with arrow keys (when not in input)
      if (!isInputFocused) {
        if (e.key === 'ArrowLeft' && hasPrevPage) {
          e.preventDefault()
          setPage(page - 1)
        } else if (e.key === 'ArrowRight' && hasNextPage) {
          e.preventDefault()
          setPage(page + 1)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [search, setSearch, batchMode, onToggleBatchMode, page, setPage, hasPrevPage, hasNextPage])

  // Close dropdown menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const dropdowns = document.querySelectorAll('[data-session-dropdown]:not(.hidden)')
      dropdowns.forEach((dropdown) => {
        if (!dropdown.contains(e.target as Node) && !dropdown.previousElementSibling?.contains(e.target as Node)) {
          dropdown.classList.add('hidden')
        }
      })
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  const hasActiveFilters = search || type !== 'all'

  const renderSessionItem = useCallback((item: SessionItem) => {
    const isSelected = selectedItems.has(`${item.type}_${item.id}`)
    const isGroup = item.type === 'group'
    const group = isGroup ? (item.raw as Group) : null
    const friend = !isGroup ? (item.raw as Friend) : null

    return (
      <div
        key={`${item.type}_${item.id}`}
        className={[
          "group flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm",
          batchMode
            ? isSelected
              ? "bg-black/[0.045] ring-1 ring-black/[0.06] dark:bg-white/[0.075] dark:ring-white/[0.08] cursor-pointer"
              : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03] cursor-pointer"
            : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
        ].join(" ")}
        onClick={() => batchMode && onToggleItem?.(item.type, item.id)}
      >
        {batchMode && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleItem?.(item.type, item.id)}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          />
        )}
        
        <Avatar className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
          <AvatarImage src={item.avatarUrl} alt={item.name} />
          <AvatarFallback className="rounded-full text-xs">
            {item.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
            {isGroup ? (
              <Users className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
            ) : (
              <User className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
            )}
            {!isGroup && friend?.isOnline && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
            {isGroup && group && (
              <>
                <span>{group.memberCount} 成员</span>
                <span>·</span>
              </>
            )}
            <span className="font-mono truncate">
              {isGroup ? group?.groupCode : friend?.uin}
            </span>
            {item.subName && (
              <>
                <span>·</span>
                <span className="truncate">{item.subName}</span>
              </>
            )}
          </div>
        </div>

        {!batchMode && (
          <div className="grid grid-cols-[64px_72px_32px] items-center gap-1 flex-shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-full px-0 text-xs rounded-full justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                onPreviewChat?.(item.type, item.id, item.name, { 
                  chatType: isGroup ? 2 : 1, 
                  peerUid: item.id 
                })
              }}
            >
              预览
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-full px-0 text-xs rounded-full justify-center"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                onOpenTaskWizard?.({
                  chatType: isGroup ? 2 : 1,
                  peerUid: item.id,
                  sessionName: item.name,
                })
              }}
            >
              导出
            </Button>
            {isGroup && group ? (
              <div className="relative h-8 w-8">
                <button
                  className="h-8 w-8 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation()
                    const menu = e.currentTarget.nextElementSibling as HTMLElement
                    if (menu) menu.classList.toggle('hidden')
                  }}
                >
                  <svg width="15" height="3" viewBox="0 0 15 3" fill="currentColor" className="text-muted-foreground">
                    <circle cx="1.5" cy="1.5" r="1.5"/>
                    <circle cx="7.5" cy="1.5" r="1.5"/>
                    <circle cx="13.5" cy="1.5" r="1.5"/>
                  </svg>
                </button>
                <div className="hidden absolute right-0 top-full mt-1 p-1.5 w-40 bg-card rounded-xl border border-black/[0.06] dark:border-white/[0.06] shadow-xl z-50" data-session-dropdown>
                  <button
                    className="w-full px-3 py-2 text-left text-[13px] text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-lg transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      onExportGroupAvatars?.(group.groupCode, group.groupName)
                      ;(e.currentTarget.parentElement as HTMLElement)?.classList.add('hidden')
                    }}
                    disabled={avatarExportLoading === group.groupCode}
                  >
                    {avatarExportLoading === group.groupCode ? '导出中...' : '导出头像'}
                  </button>
                  <button
                    className="w-full px-3 py-2 text-left text-[13px] text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-lg transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenEssenceModal?.(group.groupCode, group.groupName)
                      ;(e.currentTarget.parentElement as HTMLElement)?.classList.add('hidden')
                    }}
                  >
                    精华消息
                  </button>
                  <button
                    className="w-full px-3 py-2 text-left text-[13px] text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-lg transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenGroupFilesModal?.(group.groupCode, group.groupName)
                      ;(e.currentTarget.parentElement as HTMLElement)?.classList.add('hidden')
                    }}
                  >
                    群文件
                  </button>
                </div>
              </div>
            ) : (
              <span className="block h-8 w-8 opacity-0 pointer-events-none" aria-hidden="true" />
            )}
          </div>
        )}
      </div>
    )
  }, [batchMode, selectedItems, avatarExportLoading, onToggleItem, onPreviewChat, onOpenTaskWizard, onExportGroupAvatars, onOpenEssenceModal, onOpenGroupFilesModal])

  return (
    <div className="space-y-3">
      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <Input
            ref={searchInputRef}
            placeholder="搜索会话名称、备注或 ID... (按 / 聚焦)"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            className="pl-8 pr-8 h-10 text-sm rounded-lg border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03]"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-1.5">
          {/* Type Filter */}
          <Select value={type} onValueChange={(v: string) => setType(v as SessionType)}>
            <SelectTrigger className="w-[120px] h-10 text-sm rounded-lg">
              <SelectValue placeholder="全部类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部 ({groupCount + friendCount})</SelectItem>
              <SelectItem value="group">群组 ({groupCount})</SelectItem>
              <SelectItem value="friend">好友 ({friendCount})</SelectItem>
            </SelectContent>
          </Select>

          {/* Sort Field */}
          <Select value={sortField} onValueChange={(v: string) => setSortField(v as SortField)}>
            <SelectTrigger className="w-[100px] h-10 text-sm rounded-lg">
              <SelectValue placeholder="排序" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">名称</SelectItem>
              <SelectItem value="memberCount">人数</SelectItem>
              <SelectItem value="id">ID</SelectItem>
            </SelectContent>
          </Select>

          {/* Sort Order Toggle */}
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-lg"
            onClick={handleToggleSort}
          >
            {sortOrder === 'asc' ? (
              <SortAsc className="w-3.5 h-3.5" />
            ) : (
              <SortDesc className="w-3.5 h-3.5" />
            )}
          </Button>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-10 rounded-lg text-sm text-muted-foreground hover:text-foreground"
              onClick={resetFilters}
            >
              <X className="w-3.5 h-3.5 mr-1" />
              清除
            </Button>
          )}
        </div>
      </div>

      {/* Stats and Batch Actions */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground/60">
            {hasActiveFilters ? (
              <>找到 <span className="font-medium text-foreground/80">{totalItems}</span> 个会话</>
            ) : (
              <>共 <span className="font-medium text-foreground/80">{totalItems}</span> 个会话</>
            )}
          </span>
          {batchMode && selectedItems.size > 0 && (
            <Badge className="rounded-full text-[11px] bg-secondary text-secondary-foreground">
              已选 {selectedItems.size}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {batchMode && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/[0.06] bg-black/[0.02] px-2 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full h-8 px-3 text-[12px] text-muted-foreground hover:text-foreground"
                onClick={onToggleBatchMode}
              >
                取消批量
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full h-8 px-3 text-[12px]"
                onClick={() => {
                  const ids = new Set<string>()
                  filteredItems.forEach(item => {
                    ids.add(item.type === 'group' ? `group_${item.id}` : `friend_${item.id}`)
                  })
                  onSelectAll?.(ids)
                }}
              >
                全选当前
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full h-8 px-3 text-[12px]"
                onClick={onClearSelection}
                disabled={selectedItems.size === 0}
              >
                清空
              </Button>
              <Button
                size="sm"
                className="rounded-full h-8 px-4 text-[12px]"
                onClick={onOpenBatchExportDialog}
                disabled={selectedItems.size === 0}
              >
                导出选中 ({selectedItems.size})
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Session List */}
      {totalItems === 0 ? (
        <div className="py-16 text-center">
          {groups.length === 0 && friends.length === 0 ? (
            <>
              <p className="text-sm text-foreground">暂无会话数据</p>
              <p className="text-xs text-muted-foreground/60 mt-1">请确认 QQ 已连接，然后点击 &quot;刷新列表&quot;</p>
            </>
          ) : (
            <>
              <Filter className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-foreground">没有符合条件的会话</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                尝试调整搜索条件或
                <button 
                  onClick={resetFilters}
                  className="text-primary hover:underline ml-1"
                >
                  清除筛选
                </button>
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
          {paginatedItems.map(renderSessionItem)}
        </div>
      )}

      {/* Keyboard Shortcuts Hint */}
      {totalItems > 0 && (
        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground/40">
          <Keyboard className="w-3 h-3" />
          {KEYBOARD_SHORTCUTS.map((shortcut, idx) => (
            <span key={idx} className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-muted/40 font-mono text-[10px]">{shortcut.key}</kbd>
              <span>{shortcut.description}</span>
            </span>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 border-t border-black/[0.04] dark:border-white/[0.04]">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground/60">每页</span>
            <Select value={pageSize.toString()} onValueChange={(v: string) => setPageSize(Number(v))}>
              <SelectTrigger className="w-[72px] h-8 text-sm rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground/60">条</span>
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              disabled={page === 1}
              onClick={() => setPage(1)}
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              disabled={!hasPrevPage}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            
            <div className="flex items-center gap-1 px-2">
              <span className="text-sm font-medium">{page}</span>
              <span className="text-sm text-muted-foreground/50">/</span>
              <span className="text-sm text-muted-foreground/50">{totalPages}</span>
            </div>

            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              disabled={!hasNextPage}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              disabled={page === totalPages}
              onClick={() => setPage(totalPages)}
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="text-sm text-muted-foreground/50">
            {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, totalItems)} / {totalItems}
          </div>
        </div>
      )}
    </div>
  )
}
