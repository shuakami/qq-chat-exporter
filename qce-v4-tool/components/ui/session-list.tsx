"use client"

import { useCallback, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "./button"
import { Input } from "./input"
import { Avatar, AvatarFallback, AvatarImage } from "./avatar"

import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ArrowUpNarrowWide,
  ArrowDownWideNarrow,
  X,
  Filter,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./dropdown-menu"
import { PillDropdown } from "./pill-dropdown"
import type { Group, Friend } from "@/types/api"
import {
  useSessionFilter,
  PAGE_SIZE_OPTIONS,
  type SessionItem,
  type SessionType,
  type SortField,
  type SortOrder,
} from "@/hooks/use-session-filter"
import {
  formatCompactCount,
  formatRelativeFromNow,
  type SessionTaskStats,
} from "@/lib/session-sort"
import { QqLookupCard } from "./qq-lookup-card"

const UIN_PATTERN = /^\d{4,12}$/

export interface SessionListProps {
  groups: Group[]
  friends: Friend[]
  isLoading?: boolean
  batchMode?: boolean
  selectedItems?: Set<string>
  avatarExportLoading?: string | null
  /**
   * Issue #344: peerUid (group.groupCode / friend.uid) → 最近一条消息 ISO 时间。
   * 供「按最近活跃」排序 / 列表徽标显示。
   */
  recentActivityMap?: Record<string, string | undefined>
  taskStatsMap?: Record<string, SessionTaskStats | undefined>
  onRefresh?: () => void
  onToggleBatchMode?: () => void
  onSelectAll?: (filteredIds?: Set<string>) => void
  onClearSelection?: () => void
  onToggleItem?: (type: 'group' | 'friend', id: string) => void
  /**
   * Issue #344: shift+click 区间多选 / 区间反选 用的批量增删接口。
   * 不传时会退化成逐项调用 onToggleItem，行为不变。
   */
  onSelectMany?: (ids: Set<string>, mode: 'add' | 'remove') => void
  onOpenBatchExportDialog?: () => void
  onPreviewChat?: (type: 'group' | 'friend', id: string, name: string, peer: { chatType: number, peerUid: string }) => void
  onOpenTaskWizard?: (preset: { chatType: number, peerUid: string, sessionName: string }) => void
  onExportGroupAvatars?: (groupCode: string, groupName: string) => void
  onOpenEssenceModal?: (groupCode: string, groupName: string) => void
  onOpenGroupFilesModal?: (groupCode: string, groupName: string) => void
}


export function SessionList({
  groups,
  friends,
  isLoading = false,
  batchMode = false,
  selectedItems = new Set(),
  avatarExportLoading,
  recentActivityMap,
  taskStatsMap,
  onRefresh,
  onToggleBatchMode,
  onSelectAll,
  onClearSelection,
  onToggleItem,
  onSelectMany,
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
  } = useSessionFilter(groups, friends, {
    recentActivityMap,
    taskStatsMap,
  })

  const searchInputRef = useRef<HTMLInputElement>(null)
  // Issue #344: 记住上一次点击的 row key，用于 shift+click 区间多选。
  const lastClickedKeyRef = useRef<string | null>(null)

  const handleToggleSort = useCallback(() => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
  }, [sortOrder, setSortOrder])

  /**
   * Issue #344: 处理批量模式下的行点击。
   * - 普通点击：和原本一样，反转单项选中状态。
   * - shift + 点击：把上次点击与本次点击之间所有项一起切换到「本次点击命中后的状态」，
   *   行为对齐 Windows 资源管理器；首次点击或上次点击的项不在当前可见列表里时退回普通点击。
   */
  const handleRowClick = useCallback(
    (e: React.MouseEvent, item: SessionItem) => {
      if (!batchMode) return
      const key = `${item.type}_${item.id}`
      if (e.shiftKey && lastClickedKeyRef.current && lastClickedKeyRef.current !== key) {
        const visible = paginatedItems
        const lastIdx = visible.findIndex(
          (it) => `${it.type}_${it.id}` === lastClickedKeyRef.current
        )
        const curIdx = visible.findIndex((it) => `${it.type}_${it.id}` === key)
        if (lastIdx >= 0 && curIdx >= 0) {
          const [lo, hi] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx]
          const rangeIds = new Set<string>()
          for (let i = lo; i <= hi; i++) {
            const it = visible[i]
            rangeIds.add(`${it.type}_${it.id}`)
          }
          // 以本次点击的目标命中状态决定整段是加选还是反选：当前未选中 -> 全部加进选区；
          // 当前已选中 -> 整段一起退出选区。
          const targetMode: 'add' | 'remove' = selectedItems.has(key) ? 'remove' : 'add'
          if (onSelectMany) {
            onSelectMany(rangeIds, targetMode)
          } else {
            // 调用方没实现批量接口时退化成逐项 toggle，至少保留功能。
            rangeIds.forEach((rid) => {
              const [t, ...rest] = rid.split('_')
              const id = rest.join('_')
              const isSelected = selectedItems.has(rid)
              if (
                (targetMode === 'add' && !isSelected) ||
                (targetMode === 'remove' && isSelected)
              ) {
                onToggleItem?.(t as 'group' | 'friend', id)
              }
            })
          }
          lastClickedKeyRef.current = key
          return
        }
      }
      onToggleItem?.(item.type, item.id)
      lastClickedKeyRef.current = key
    },
    [batchMode, paginatedItems, selectedItems, onSelectMany, onToggleItem]
  )

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

  const renderSessionItem = useCallback((item: SessionItem, index: number, items: SessionItem[]) => {
    const isSelected = selectedItems.has(`${item.type}_${item.id}`)
    const isPreviousSelected =
      index > 0 && selectedItems.has(`${items[index - 1].type}_${items[index - 1].id}`)
    const isNextSelected =
      index < items.length - 1 && selectedItems.has(`${items[index + 1].type}_${items[index + 1].id}`)
    const isGroup = item.type === 'group'
    const group = isGroup ? (item.raw as Group) : null
    const friend = !isGroup ? (item.raw as Friend) : null

    return (
      <div
        key={`${item.type}_${item.id}`}
        className={[
          "group flex items-center gap-3 px-3 py-3 transition-colors text-sm",
          batchMode
            ? isSelected
              ? "bg-black/[0.045] dark:bg-white/[0.075] cursor-pointer"
              : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03] cursor-pointer"
            : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]",
          isSelected && batchMode
            ? `${isPreviousSelected ? "rounded-t-none" : "rounded-t-xl"} ${isNextSelected ? "rounded-b-none" : "rounded-b-xl"}`
            : "rounded-xl",
        ].join(" ")}
        onClick={(e: React.MouseEvent) => batchMode && handleRowClick(e, item)}
      >
        <AnimatePresence initial={false}>
          {batchMode && (
            <motion.div
              initial={{ width: 0, opacity: 0, marginRight: 0 }}
              animate={{ width: 14, opacity: 1, marginRight: 0 }}
              exit={{ width: 0, opacity: 0, marginRight: 0 }}
              transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
              className="flex-shrink-0 overflow-hidden"
            >
              <div
                className={[
                  "flex items-center justify-center w-[14px] h-[14px] rounded-[3.5px] transition-colors cursor-pointer border",
                  isSelected
                    ? "bg-[#317CFF] border-[#317CFF]"
                    : "bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-600 hover:border-[#317CFF]",
                ].join(" ")}
              >
                <AnimatePresence>
                  {isSelected && (
                    <motion.svg
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ type: "tween", duration: 0.15, ease: "easeOut" }}
                      viewBox="0 0 24 24"
                      fill="none"
                      className="w-2.5 h-2.5 text-white"
                    >
                      <path d="M4.5 12.75l6 6 9-13.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </motion.svg>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Avatar className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
          <AvatarImage src={item.avatarUrl} alt={item.name} />
          <AvatarFallback className="rounded-full text-xs">
            {item.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
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
            {/* Issue #344: 最近一条消息时间。没有数据时不渲染。 */}
            {item.lastMessageTime && (
              <>
                <span>·</span>
                <span title={item.lastMessageTime} className="truncate">
                  {formatRelativeFromNow(item.lastMessageTime)}
                </span>
              </>
            )}
            {/* Issue #344: 已导出消息累计。0 不渲染，避免噪声。 */}
            {!!item.exportedMessageCount && (
              <>
                <span>·</span>
                <span className="truncate">已导出 {formatCompactCount(item.exportedMessageCount)} 条</span>
              </>
            )}
          </div>
        </div>

        {!batchMode && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              className="inline-flex items-center justify-center h-7 px-3 text-[12px] font-medium text-muted-foreground bg-transparent hover:text-foreground rounded-full transition-colors opacity-0 group-hover:opacity-100"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                onPreviewChat?.(item.type, item.id, item.name, {
                  chatType: isGroup ? 2 : 1,
                  peerUid: item.id,
                })
              }}
            >
              预览
            </button>
            {isGroup && group ? (
              <div className="flex items-center bg-white dark:bg-neutral-900 border border-black/5 dark:border-white/10 shadow-[0_1px_2px_rgba(0,0,0,0.04)] rounded-full overflow-hidden hover:border-black/10 transition-all">
                <button
                  className="inline-flex items-center justify-center h-7 pl-3 pr-2 text-[12px] font-medium text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors border-r border-neutral-200/80 dark:border-white/10"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation()
                    onOpenTaskWizard?.({
                      chatType: 2,
                      peerUid: item.id,
                      sessionName: item.name,
                    })
                  }}
                >
                  导出
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="inline-flex items-center justify-center h-7 pl-1.5 pr-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors outline-none"
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem
                      disabled={avatarExportLoading === group.groupCode}
                      onClick={() => onExportGroupAvatars?.(group.groupCode, group.groupName)}
                    >
                      {avatarExportLoading === group.groupCode ? '导出中...' : '导出头像'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onOpenEssenceModal?.(group.groupCode, group.groupName)}>
                      精华消息
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onOpenGroupFilesModal?.(group.groupCode, group.groupName)}>
                      群文件
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <button
                className="inline-flex items-center justify-center h-7 px-3 text-[12px] font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 border border-black/5 dark:border-white/10 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-black/10 hover:bg-neutral-50 dark:hover:bg-white/5 hover:text-neutral-900 dark:hover:text-white rounded-full transition-all"
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
              </button>
            )}
          </div>
        )}
      </div>
    )
  }, [batchMode, selectedItems, avatarExportLoading, onToggleItem, onPreviewChat, onOpenTaskWizard, onExportGroupAvatars, onOpenEssenceModal, onOpenGroupFilesModal])

  return (
    <div className="space-y-0">
      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-1.5">
        {/* Search Input */}
        <div className="relative w-full flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60 pointer-events-none" />
          <Input
            ref={searchInputRef}
            placeholder="搜索会话名称、备注或 ID..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            className="h-8 pl-9 pr-8 text-[13px] rounded-full bg-white dark:bg-neutral-900 border border-black/[0.03] dark:border-white/10 shadow-[0_1px_2px_rgba(0,0,0,0.02)] hover:border-black/[0.08] focus-visible:ring-0 focus-visible:border-black/[0.12] transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2">
          {/* Type Filter */}
          <PillDropdown
            value={type}
            onChange={(v) => setType(v as SessionType)}
            options={[
              { value: "all", label: `全部 (${groupCount + friendCount})` },
              { value: "group", label: `群组 (${groupCount})` },
              { value: "friend", label: `好友 (${friendCount})` },
            ]}
          />

          {/* Sort Field */}
          <PillDropdown
            value={sortField}
            onChange={(v) => setSortField(v as SortField)}
            options={[
              { value: "frequentExport", label: "常用导出" },
              { value: "name", label: "名称" },
              { value: "memberCount", label: "人数" },
              { value: "id", label: "ID" },
              // Issue #344: 按最近一条消息时间 / 已导出消息数排序。
              { value: "lastActivity", label: "最近活跃" },
              { value: "exportedCount", label: "已导出条数" },
            ]}
          />

          {/* Sort Order Toggle */}
          <button
            className="flex-shrink-0 h-8 w-8 rounded-full bg-white dark:bg-neutral-900 border border-black/[0.03] dark:border-white/10 shadow-[0_1px_2px_rgba(0,0,0,0.02)] flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:border-black/[0.08] hover:bg-neutral-50 dark:hover:bg-white/5 hover:text-neutral-900 dark:hover:text-white transition-all"
            onClick={handleToggleSort}
          >
            {sortOrder === 'asc' ? (
              <ArrowUpNarrowWide className="w-4 h-4" />
            ) : (
              <ArrowDownWideNarrow className="w-4 h-4" />
            )}
          </button>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full text-[13px] leading-none text-muted-foreground hover:text-foreground"
              onClick={resetFilters}
            >
              <X className="w-3.5 h-3.5" />
              清除
            </Button>
          )}
        </div>
      </div>

      {/* Session List */}
      {totalItems === 0 ? (
        <div className="py-16 mt-4 text-center">
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
              {/*
                * Issue #204：搜索词是合法 QQ 号但好友/群/最近联系人都搜不到时，
                * 把搜索框里的数字直接喂给 /api/users/lookup，让用户能定位到
                * 已注销 / 已删好友的历史会话。
                */}
              {UIN_PATTERN.test(search.trim()) && onOpenTaskWizard && (
                <QqLookupCard
                  initialUin={search.trim()}
                  onStartExport={(preset) => onOpenTaskWizard(preset)}
                  onPreview={onPreviewChat ? (peer, name) => onPreviewChat('friend', peer.peerUid, name, peer) : undefined}
                />
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col mt-4">
          {paginatedItems.map(renderSessionItem)}
        </div>
      )}

      {/* Floating Batch Toolbar */}
      <AnimatePresence>
        {batchMode && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 400, damping: 35, mass: 0.8 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="flex items-center gap-1 rounded-full bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] border border-black/[0.06] dark:border-white/[0.08] px-2 py-1.5">
              <span className="text-[13px] font-medium text-foreground px-3 tabular-nums">
                已选择 {selectedItems.size} 项
              </span>
              {selectedItems.size > 0 && (
                <button
                  onClick={onClearSelection}
                  className="px-2 py-0.5 text-[12px] text-muted-foreground/60 hover:text-muted-foreground rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors mr-1"
                >
                  清空
                </button>
              )}
              <span className="w-px h-4 bg-black/[0.08] dark:bg-white/[0.1]" />
              {type === 'all' && (
                <>
                  <button
                    onClick={() => {
                      const ids = new Set<string>()
                      filteredItems.forEach((item) => {
                        if (item.type === 'group') ids.add(`group_${item.id}`)
                      })
                      onSelectMany ? onSelectMany(ids, 'add') : onSelectAll?.(ids)
                    }}
                    className="px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                  >
                    全选群
                  </button>
                  <button
                    onClick={() => {
                      const ids = new Set<string>()
                      filteredItems.forEach((item) => {
                        if (item.type === 'friend') ids.add(`friend_${item.id}`)
                      })
                      onSelectMany ? onSelectMany(ids, 'add') : onSelectAll?.(ids)
                    }}
                    className="px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                  >
                    全选好友
                  </button>
                </>
              )}
              <button
                onClick={() => {
                  const ids = new Set<string>()
                  filteredItems.forEach(item => {
                    ids.add(item.type === 'group' ? `group_${item.id}` : `friend_${item.id}`)
                  })
                  onSelectAll?.(ids)
                }}
                className="px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
              >
                全选当前
              </button>
              <span className="w-px h-4 bg-black/[0.08] dark:bg-white/[0.1]" />
              <button
                onClick={onOpenBatchExportDialog}
                disabled={selectedItems.size === 0}
                className="px-4 py-1.5 text-[13px] font-medium text-white bg-[#317CFF] rounded-full hover:bg-[#2867d6] transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                导出
              </button>
              <button
                onClick={onToggleBatchMode}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors ml-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>



      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground/60">每页</span>
            <PillDropdown
              value={pageSize.toString()}
              onChange={(v) => setPageSize(Number(v))}
              options={PAGE_SIZE_OPTIONS.map((size) => ({
                value: size.toString(),
                label: size.toString(),
              }))}
            />
            <span className="text-sm text-muted-foreground/60">条</span>
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              disabled={page === 1}
              onClick={() => setPage(1)}
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
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
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              disabled={!hasNextPage}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
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
