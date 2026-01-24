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
import { motion, AnimatePresence } from "framer-motion"
import { EASE, DUR, makeStagger, hoverLift } from "@/components/qce-dashboard/animations"
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
  onSelectAll?: () => void
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
    paginatedItems,
    totalItems,
    totalPages,
    hasNextPage,
    hasPrevPage,
    groupCount,
    friendCount,
  } = useSessionFilter(groups, friends)

  // Animation variants for large lists
  const hasLargeList = totalItems > 50
  const STAG = useMemo(() => makeStagger(hasLargeList ? 0 : 0.03, hasLargeList), [hasLargeList])

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

  const hasActiveFilters = search || type !== 'all'

  const renderSessionItem = useCallback((item: SessionItem) => {
    const isSelected = selectedItems.has(`${item.type}_${item.id}`)
    const isGroup = item.type === 'group'
    const group = isGroup ? (item.raw as Group) : null
    const friend = !isGroup ? (item.raw as Friend) : null

    return (
      <motion.div
        key={`${item.type}_${item.id}`}
        className={[
          "flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all duration-200",
          batchMode
            ? isSelected
              ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30"
              : "border-border bg-background/70 hover:bg-muted/50 cursor-pointer"
            : "border-border bg-background/70 hover:bg-muted/50"
        ].join(" ")}
        variants={STAG.item}
        {...hoverLift}
        onClick={() => batchMode && onToggleItem?.(item.type, item.id)}
      >
        {batchMode && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleItem?.(item.type, item.id)}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          />
        )}
        
        <div className="relative">
          <Avatar className="w-10 h-10 rounded-xl overflow-hidden">
            <AvatarImage src={item.avatarUrl} alt={item.name} />
            <AvatarFallback className="rounded-xl text-sm">
              {item.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {/* Type badge */}
          <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
            isGroup 
              ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300' 
              : 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-300'
          }`}>
            {isGroup ? <Users className="w-3 h-3" /> : <User className="w-3 h-3" />}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-foreground">{item.name}</p>
            {!isGroup && friend?.isOnline && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            {isGroup && group && (
              <>
                <span>{group.memberCount} 成员</span>
                <span className="text-muted-foreground/50">•</span>
              </>
            )}
            <span className="font-mono truncate">
              {isGroup ? group?.groupCode : friend?.uin}
            </span>
            {item.subName && (
              <>
                <span className="text-muted-foreground/50">•</span>
                <span className="truncate text-muted-foreground/70">{item.subName}</span>
              </>
            )}
          </div>
        </div>

        {!batchMode && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full h-7 px-2.5 text-xs"
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
            </motion.div>
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                size="sm"
                className="rounded-full h-7 px-2.5 text-xs"
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
            </motion.div>
            {isGroup && group && (
              <>
                <motion.div whileTap={{ scale: 0.98 }}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full h-7 px-2.5 text-xs"
                    disabled={avatarExportLoading === group.groupCode}
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation()
                      onExportGroupAvatars?.(group.groupCode, group.groupName)
                    }}
                  >
                    {avatarExportLoading === group.groupCode ? '...' : '头像'}
                  </Button>
                </motion.div>
                <motion.div whileTap={{ scale: 0.98 }}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full h-7 px-2.5 text-xs"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation()
                      onOpenEssenceModal?.(group.groupCode, group.groupName)
                    }}
                  >
                    精华
                  </Button>
                </motion.div>
                <motion.div whileTap={{ scale: 0.98 }}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full h-7 px-2.5 text-xs"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation()
                      onOpenGroupFilesModal?.(group.groupCode, group.groupName)
                    }}
                  >
                    文件
                  </Button>
                </motion.div>
              </>
            )}
          </div>
        )}
      </motion.div>
    )
  }, [batchMode, selectedItems, avatarExportLoading, STAG.item, onToggleItem, onPreviewChat, onOpenTaskWizard, onExportGroupAvatars, onOpenEssenceModal, onOpenGroupFilesModal])

  return (
    <div className="space-y-4">
      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder="搜索会话名称、备注或 ID... (按 / 聚焦)"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            className="pl-9 pr-9 h-10 rounded-xl bg-background/70"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2">
          {/* Type Filter */}
          <Select value={type} onValueChange={(v: string) => setType(v as SessionType)}>
            <SelectTrigger className="w-[120px] h-10 rounded-xl bg-background/70">
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
            <SelectTrigger className="w-[100px] h-10 rounded-xl bg-background/70">
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
            className="h-10 w-10 rounded-xl"
            onClick={handleToggleSort}
          >
            {sortOrder === 'asc' ? (
              <SortAsc className="w-4 h-4" />
            ) : (
              <SortDesc className="w-4 h-4" />
            )}
          </Button>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-10 rounded-xl text-muted-foreground hover:text-foreground"
              onClick={resetFilters}
            >
              <X className="w-4 h-4 mr-1" />
              清除
            </Button>
          )}
        </div>
      </div>

      {/* Stats and Batch Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {hasActiveFilters ? (
              <>找到 <span className="font-medium text-foreground">{totalItems}</span> 个会话</>
            ) : (
              <>共 <span className="font-medium text-foreground">{totalItems}</span> 个会话</>
            )}
          </span>
          {batchMode && selectedItems.size > 0 && (
            <Badge className="rounded-full bg-secondary text-secondary-foreground">
              已选 {selectedItems.size}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {batchMode && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full h-8"
                onClick={onSelectAll}
              >
                全选当前
              </Button>
              {selectedItems.size > 0 && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full h-8"
                    onClick={onClearSelection}
                  >
                    清空
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-full h-8"
                    onClick={onOpenBatchExportDialog}
                  >
                    导出选中 ({selectedItems.size})
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Session List */}
      {totalItems === 0 ? (
        <motion.div
          className="rounded-2xl border border-dashed border-border bg-background/60 py-14 text-center"
          initial={{ opacity: 0, scale: 0.98, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: DUR.normal, ease: EASE.inOut } }}
        >
          {groups.length === 0 && friends.length === 0 ? (
            <>
              <p className="text-foreground">暂无会话数据</p>
              <p className="text-muted-foreground mt-1">请确认 QQ 已连接，然后点击 "刷新列表"</p>
            </>
          ) : (
            <>
              <Filter className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-foreground">没有符合条件的会话</p>
              <p className="text-muted-foreground mt-1">
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
        </motion.div>
      ) : (
        <motion.div
          className="space-y-2"
          variants={STAG.container}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <AnimatePresence mode="popLayout">
            {paginatedItems.map(renderSessionItem)}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Keyboard Shortcuts Hint */}
      {totalItems > 0 && (
        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground/60">
          <Keyboard className="w-3.5 h-3.5" />
          {KEYBOARD_SHORTCUTS.map((shortcut, idx) => (
            <span key={idx} className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-muted/50 font-mono text-[10px]">{shortcut.key}</kbd>
              <span>{shortcut.description}</span>
            </span>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border/50">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">每页</span>
            <Select value={pageSize.toString()} onValueChange={(v: string) => setPageSize(Number(v))}>
              <SelectTrigger className="w-[80px] h-8 rounded-lg">
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
            <span className="text-sm text-muted-foreground">条</span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              disabled={page === 1}
              onClick={() => setPage(1)}
            >
              <ChevronsLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              disabled={!hasPrevPage}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            
            <div className="flex items-center gap-1 px-2">
              <span className="text-sm font-medium">{page}</span>
              <span className="text-sm text-muted-foreground">/</span>
              <span className="text-sm text-muted-foreground">{totalPages}</span>
            </div>

            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              disabled={!hasNextPage}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              disabled={page === totalPages}
              onClick={() => setPage(totalPages)}
            >
              <ChevronsRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="text-sm text-muted-foreground">
            {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, totalItems)} / {totalItems}
          </div>
        </div>
      )}
    </div>
  )
}
