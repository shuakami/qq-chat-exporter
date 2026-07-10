export type ScheduleType = 'daily' | 'weekly' | 'monthly' | 'custom';

export type TimeRangeType =
    | 'yesterday'
    | 'last-week'
    | 'last-month'
    | 'last-7-days'
    | 'last-30-days'
    | 'custom';

export type BackupMode = 'full' | 'incremental';

export interface ScheduledExportConfig {
    id: string;
    name: string;
    peer: {
        chatType: number;
        peerUid: string;
        guildId: string;
    };
    scheduleType: ScheduleType;
    cronExpression?: string;
    executeTime: string;
    timeRangeType: TimeRangeType;
    customTimeRange?: {
        startTime: number;
        endTime: number;
    };
    format: 'JSON' | 'HTML' | 'TXT';
    options: {
        includeResourceLinks?: boolean;
        includeSystemMessages?: boolean;
        filterPureImageMessages?: boolean;
        prettyFormat?: boolean;
        preferGroupMemberName?: boolean;
        skipDownloadResourceTypes?: Array<'image' | 'video' | 'audio' | 'file'>;
        skipFileDownload?: boolean;
        embedResourcesAsDataUri?: boolean;
        maxEmbedFileSizeBytes?: number;
        showSearchBar?: boolean;
        enableVirtualScroll?: boolean;
    };
    backupMode?: BackupMode;
    lastBackupMessageId?: string;
    lastBackupTimestamp?: number;
    outputDir?: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
    lastRun?: Date;
    nextRun?: Date;
    createdBy?: string;
}

export interface ExecutionHistory {
    id: string;
    scheduledExportId: string;
    executedAt: Date;
    status: 'success' | 'failed' | 'partial';
    messageCount?: number;
    filePath?: string;
    fileSize?: number;
    error?: string;
    duration: number;
    resourceSummary?: {
        attempted: number;
        alreadyAvailable: number;
        downloaded: number;
        failed: number;
        skipped: number;
        failedSamples: string[];
    };
}
