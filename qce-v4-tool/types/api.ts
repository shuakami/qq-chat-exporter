// API Response Types
export interface APIResponse<T> {
  success: boolean
  data?: T
  error?: {
    type: string
    message: string
    context?: {
      code: string
      requestId?: string
    }
  }
  timestamp: string
  requestId: string
}

// System Types
export interface SystemInfo {
  name: string
  version: string
  /**
   * 后端运行形态。Issue #340：独立模式下没有 NapCat、没有 QQ 登录态，前端
   * 看到这个值就应该跳过 /api/friends 和 /api/groups（这两个端点固定返回 503
   * STANDALONE_MODE 错误），并在「会话」一类需要登录态的页面上提示用户走
   * 「聊天记录」浏览历史导出。
   */
  mode?: 'plugin' | 'standalone'
  napcat: {
    version: string
    online: boolean
    workingEnv?: 'shell' | 'framework' | 'unknown'
    workingEnvLabel?: string
    selfInfo: {
      uid: string
      uin: string
      nick: string
      avatarUrl?: string
      longNick?: string
      sex?: number
      age?: number
      qqLevel?: {
        sunNum: number
        moonNum: number
        starNum: number
      }
      vipFlag?: boolean
      svipFlag?: boolean
      vipLevel?: number
    }
  }
  runtime: {
    nodeVersion: string
    platform: string
    arch?: string
    uptime: number
    memory?: {
      rss: number
      heapTotal: number
      heapUsed: number
      external: number
    }
  }
}

// Chat Types
export interface Group {
  groupCode: string
  groupName: string
  memberCount: number
  maxMember: number
  remark?: string
  avatarUrl?: string
}

export interface GroupMember {
  uid: string
  uin?: string
  nick: string
  cardName?: string
  avatarUrl?: string
  role: 'owner' | 'admin' | 'member'
}

export interface GroupsResponse {
  groups: Group[]
  totalCount: number
  currentPage: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

export interface Friend {
  uid: string
  uin: number
  nick: string
  remark?: string
  avatarUrl?: string
  isOnline?: boolean
  status?: number
  categoryId?: number
  /**
   * NTQQ ChatType（默认 1=好友）。来自最近联系人合并的会话（QQ Bot、服务号、临时会话等）
   * 会保留原始 chatType（例如 118），导出时直接传给后端，避免被错误归类为普通好友。
   */
  chatType?: number
  /** 来自 /api/recent-contacts 合并的特殊会话标记（Issue #364） */
  isSpecial?: boolean
  /** 当 isSpecial 为 true 时的细分（service / temp / public_account / unknown 等） */
  specialKind?: string
}

export interface FriendsResponse {
  friends: Friend[]
  totalCount: number
  currentPage: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

/** 最近联系人中无法归类为好友 / 群聊的会话（QQ Bot、服务号、临时会话等，Issue #364） */
export interface RecentContact {
  /** NTQQ ChatType 原值（1=好友, 2=群聊, 100=临时, 118=服务助手等） */
  chatType: number
  peerUid: string
  peerUin?: string
  /** 显示名（peerName / sendNickName / sendMemberName，按可用性回退） */
  name: string
  sendNickName?: string
  sendMemberName?: string
  avatarUrl?: string
  lastMsgId?: string
  /** ISO 时间戳 */
  lastMsgTime?: string
  /** 后端分类：special 表示既不在好友列表也不在群组列表 */
  classification: 'friend' | 'group' | 'private' | 'special'
}

export interface RecentContactsResponse {
  contacts: RecentContact[]
  totalCount: number
  rawCount: number
}

// Task Types
export interface ExportTask {
  id: string
  peer: {
    chatType: number
    peerUid: string
    guildId: string
  }
  sessionName: string
  status: "pending" | "running" | "completed" | "failed"
  progress: number
  format: string
  startTime?: number
  endTime?: number
  keywords?: string
  includeRecalled?: boolean
  messageCount?: number
  /** 当前进度消息 */
  progressMessage?: string
  filePath?: string
  fileName?: string
  fileSize?: number
  downloadUrl?: string
  createdAt: string
  completedAt?: string
  error?: string
  isZipExport?: boolean
  originalFilePath?: string
  /** 是否为流式导出模式 */
  streamingMode?: boolean
  /**
   * 本次导出的资源下载摘要（issue #363）。
   * 后端在 `processMessageResources` 完成后填充；纯文字消息或显式跳过资源下载时为 undefined。
   */
  resourceSummary?: ExportResourceSummary
}

/**
 * 单次导出资源处理结果（issue #363）。
 * 用来在任务列表 / 详情中给出明确结论，避免用户被 NapCat 终端的 `[Rkey] 所有服务均已禁用`
 * 日志误导以为整个导出失败。
 */
export interface ExportResourceSummary {
  /** 命中的总资源条数（包含跳过、命中本地的）。 */
  attempted: number
  /** 入口扫描时已经在本地、不需要重新下载的。 */
  alreadyAvailable: number
  /** 本次新下载完成的。 */
  downloaded: number
  /** 拿不到链接 / 健康检查不过的。 */
  failed: number
  /** 因 skipDownloadResourceTypes 主动跳过的。 */
  skipped: number
  /** 失败资源的简短样本（最多 5 个），用于在 UI 中显示具体哪些资源没下到。 */
  failedSamples: string[]
}

export interface CreateTaskForm {
  chatType: number
  peerUid: string
  sessionName: string
  format: string
  startTime?: string
  endTime?: string
  keywords?: string
  includeRecalled: boolean
  includeSystemMessages: boolean
  filterPureImageMessages: boolean
  exportAsZip?: boolean
  excludeUserUins?: string
  /** Issue #369：仅导出这些 QQ 的消息（逗号分隔），与 excludeUserUins 互不冲突。 */
  includeUserUins?: string
  embedAvatarsAsBase64?: boolean
  /**
   * Issue #311: HTML 格式专用 — 资源以 base64 内联生成单个自包含 HTML。
   * 启用后不再导出同级 `resources/` 目录。
   */
  embedResourcesAsDataUri?: boolean
  /** 流式ZIP导出模式（专为超大消息量设计，>50万消息推荐使用） */
  streamingZipMode?: boolean
  /** 自定义导出路径（Issue #192） */
  outputDir?: string
  /** 在文件名中包含聊天名称（Issue #216） */
  useNameInFileName?: boolean
  /**
   * 使用友好文件名格式 `<名称>(<QQ号>).<扩展名>`（Issue #134）。
   * 启用后丢掉业务前缀与时间戳；同名碰撞时会自动追加 `_<日期>_<时间>` 后缀。
   * 优先级高于 useNameInFileName；缺少可用 sessionName 时退回默认名称。
   */
  useFriendlyFileName?: boolean
  /** 群聊导出时优先使用群成员名称（Issue #358） */
  preferGroupMemberName?: boolean
  /**
   * 仅保留元数据、跳过下载的资源类型（Issue #341）。
   * 'image' | 'video' | 'audio' | 'file'
   */
  skipDownloadResourceTypes?: Array<'image' | 'video' | 'audio' | 'file'>
}

export interface CreateTaskRequest {
  peer: {
    chatType: number
    peerUid: string
    guildId: string
  }
  sessionName?: string
  format: string
  filter: {
    startTime?: number
    endTime?: number
    keywords?: string[]
    includeRecalled: boolean
  }
  options: {
    batchSize: number
    includeResourceLinks: boolean
    includeSystemMessages: boolean
    filterPureImageMessages: boolean
    prettyFormat: boolean
    exportAsZip?: boolean
    /** 嵌入头像为Base64 */
    embedAvatarsAsBase64?: boolean
    /** Issue #311: 自包含 HTML（资源 base64 内联）。 */
    embedResourcesAsDataUri?: boolean
    /** 自定义导出路径（Issue #192） */
    outputDir?: string
    /** 在文件名中包含聊天名称（Issue #216） */
    useNameInFileName?: boolean
    /** 使用友好文件名格式 `<名称>(<QQ号>).<扩展名>`（Issue #134） */
    useFriendlyFileName?: boolean
    /** 群聊导出时优先使用群成员名称（Issue #358） */
    preferGroupMemberName?: boolean
    /** 仅保留元数据、跳过下载的资源类型（Issue #341） */
    skipDownloadResourceTypes?: Array<'image' | 'video' | 'audio' | 'file'>
  }
}

// WebSocket Types
export interface WebSocketMessage {
  type: string
  data?: any
}

export interface ExportProgressMessage {
  type: "exportProgress"
  data: {
    taskId: string
    progress: number
    status: string
  }
}

export interface NotificationMessage {
  type: "notification"
  data: {
    message: string
  }
}

// Tasks API Response Types
export interface TasksResponse {
  tasks: ExportTask[]
  totalCount: number
}

export interface TaskResponse {
  task: ExportTask
}

export interface CreateTaskResponse {
  taskId: string
  messageCount?: number
  fileName?: string
  downloadUrl?: string
}

// WebSocket Progress Message Types  
export interface WebSocketProgressMessage {
  type: "export_progress" | "export_complete" | "export_error"
  data: {
    taskId: string
    progress: number
    status: "running" | "completed" | "failed"
    error?: string
    fileName?: string
    filePath?: string
    fileSize?: number
    downloadUrl?: string
    completedAt?: string
    isZipExport?: boolean
    originalFilePath?: string
    streamingMode?: boolean
    chunkCount?: number
    message?: string
    messageCount?: number
  }
}

// Scheduled Export Types
export interface ScheduledExport {
  id: string
  name: string
  peer: {
    chatType: number
    peerUid: string
    guildId: string
  }
  scheduleType: 'daily' | 'weekly' | 'monthly' | 'custom'
  cronExpression?: string
  executeTime: string
  timeRangeType: 'yesterday' | 'last-week' | 'last-month' | 'last-7-days' | 'last-30-days' | 'custom'
  customTimeRange?: {
    startTime: number
    endTime: number
  }
  format: string
  options: {
    includeResourceLinks?: boolean
    includeSystemMessages?: boolean
    filterPureImageMessages?: boolean
    prettyFormat?: boolean
    preferGroupMemberName?: boolean
    /** Issue #341: 仅保留元数据、跳过下载的资源类型 */
    skipDownloadResourceTypes?: Array<'image' | 'video' | 'audio' | 'file'>
    /** Issue #311: 自包含 HTML（资源 base64 内联）。 */
    embedResourcesAsDataUri?: boolean
  }
  outputDir?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastRun?: string
  nextRun?: string
  createdBy?: string
}

export interface ScheduledExportHistory {
  id: string
  scheduledExportId: string
  executedAt: string
  status: 'success' | 'failed' | 'partial'
  messageCount?: number
  filePath?: string
  fileSize?: number
  error?: string
  duration: number
}

export interface CreateScheduledExportForm {
  name: string
  chatType: number
  peerUid: string
  sessionName: string
  scheduleType: 'daily' | 'weekly' | 'monthly' | 'custom'
  cronExpression?: string
  executeTime: string
  timeRangeType: 'yesterday' | 'last-week' | 'last-month' | 'last-7-days' | 'last-30-days' | 'custom'
  customTimeRange?: {
    startTime: number
    endTime: number
  }
  format: string
  enabled: boolean
  outputDir?: string
  includeResourceLinks?: boolean
  includeSystemMessages?: boolean
  filterPureImageMessages?: boolean
  preferGroupMemberName?: boolean
  /** Issue #341: 仅保留元数据、跳过下载的资源类型 */
  skipDownloadResourceTypes?: Array<'image' | 'video' | 'audio' | 'file'>
}

export interface ScheduledExportsResponse {
  scheduledExports: ScheduledExport[]
}

// Chat History File Types
export interface ChatFile {
  fileName: string
  filePath: string
  relativePath: string
  size: number
  createTime: string
  modifyTime: string
  chatType: 'friend' | 'group'
  chatId: string
  exportDate: string
  displayName: string
  avatarUrl: string
  isScheduled?: boolean
  messageCount?: number
  senderName?: string
  timeRange?: string
  exportTime?: string
}

export interface ChatFilesResponse {
  files: ChatFile[]
}

export interface ChatFileInfoResponse extends ChatFile {
  // 可能包含额外的详细信息
}

// Group Essence Message Types
export interface EssenceMessageContent {
  type: 'text' | 'image' | 'unknown'
  text?: string
  url?: string
  data?: any
}

export interface EssenceMessage {
  msgSeq: number
  msgRandom: number
  senderUin: string
  senderNick: string
  senderTime: number
  senderTimeFormatted?: string
  addDigestUin: string
  addDigestNick: string
  addDigestTime: number
  addDigestTimeFormatted?: string
  content: EssenceMessageContent[]
  canBeRemoved: boolean
}

export interface EssenceMessagesResponse {
  messages: EssenceMessage[]
  totalCount: number
  groupCode: string
}

export interface EssenceExportResponse {
  success: boolean
  groupCode: string
  groupName: string
  totalCount: number
  format: string
  fileName: string
  filePath: string
  fileSize: number
  downloadUrl: string
}


// Group Album Types
export interface AlbumInfo {
  albumId: string
  albumName: string
  photoCount?: number
}

export interface AlbumMediaItem {
  id: string
  url: string
  thumbUrl?: string
  type: 'image' | 'video'
  uploadTime?: number
  uploaderUin?: string
  uploaderNick?: string
  width?: number
  height?: number
  fileSize?: number
}

export interface AlbumExportResult {
  success: boolean
  groupCode: string
  groupName: string
  albumCount: number
  mediaCount: number
  downloadedCount: number
  failedCount: number
  exportPath: string
  exportId: string
  error?: string
}

export interface AlbumExportRecord {
  id: string
  groupCode: string
  groupName: string
  albumCount: number
  mediaCount: number
  downloadedCount: number
  exportPath: string
  exportTime: string
  success: boolean
  error?: string
}

export interface AlbumsResponse {
  albums: AlbumInfo[]
  totalCount: number
}

export interface AlbumMediaResponse {
  media: AlbumMediaItem[]
  totalCount: number
}

// Group Files Types
export interface GroupFileInfo {
  fileId: string
  fileName: string
  fileSize: number
  uploadTime: number
  uploaderUin?: string
  uploaderNick?: string
  downloadCount?: number
  deadTime?: number
  modifyTime?: number
  parentFolderId?: string
}

export interface GroupFolderInfo {
  folderId: string
  folderName: string
  createTime?: number
  creatorUin?: string
  creatorNick?: string
  totalFileCount?: number
  parentFolderId?: string
}

export interface FileExportResult {
  success: boolean
  groupCode: string
  groupName: string
  fileCount: number
  folderCount: number
  downloadedCount: number
  failedCount: number
  totalSize: number
  exportPath: string
  exportId: string
  error?: string
}

export interface FileExportRecord {
  id: string
  groupCode: string
  groupName: string
  fileCount: number
  folderCount: number
  downloadedCount: number
  totalSize: number
  exportPath: string
  exportTime: string
  success: boolean
  error?: string
}

export interface GroupFilesResponse {
  files: GroupFileInfo[]
  folders: GroupFolderInfo[]
  fileCount: number
  folderCount: number
}

export interface GroupFileCountResponse {
  count: number
}
