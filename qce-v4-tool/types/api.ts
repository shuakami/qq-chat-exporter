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
}

export interface FriendsResponse {
  friends: Friend[]
  totalCount: number
  currentPage: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
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
  embedAvatarsAsBase64?: boolean
  /** 流式ZIP导出模式（专为超大消息量设计，>50万消息推荐使用） */
  streamingZipMode?: boolean
  /** 自定义导出路径（Issue #192） */
  outputDir?: string
  /** 在文件名中包含聊天名称（Issue #216） */
  useNameInFileName?: boolean
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
    /** 自定义导出路径（Issue #192） */
    outputDir?: string
    /** 在文件名中包含聊天名称（Issue #216） */
    useNameInFileName?: boolean
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