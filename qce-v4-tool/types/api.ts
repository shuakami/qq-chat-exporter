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
  filePath?: string
  fileName?: string
  fileSize?: number
  downloadUrl?: string
  createdAt: string
  completedAt?: string
  error?: string
  isZipExport?: boolean
  originalFilePath?: string
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
    downloadUrl?: string
    completedAt?: string
    isZipExport?: boolean
    originalFilePath?: string
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