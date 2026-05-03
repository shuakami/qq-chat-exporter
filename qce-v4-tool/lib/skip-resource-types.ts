/**
 * Issue #344：在创建任务、批量导出、定时导出三处都允许用户按资源类型独立控制
 * 是否跳过下载（图片 / 视频 / 音频 / 文件）。这里集中实现切换逻辑，避免三个表单
 * 各自维护一份 Set 操作出现行为漂移。
 *
 * 后端 (`ResourceHandler.setSkipDownloadTypes`) 接受这四种字符串，未识别的值会被忽略。
 */

export type SkipDownloadResourceType = 'image' | 'video' | 'audio' | 'file';

const VALID_TYPES: ReadonlySet<SkipDownloadResourceType> = new Set([
  'image',
  'video',
  'audio',
  'file',
]);

/**
 * 在现有 `skipDownloadResourceTypes` 列表上按需添加 / 移除 `type`，返回稳定排序、
 * 去重之后的新数组。`undefined` 输入按空数组处理。空结果返回 `undefined`，避免
 * 把空数组写进 API 请求体。
 *
 * 排序固定为 `image, video, audio, file`，方便快照测试和接口幂等。
 */
export function toggleSkipResourceType(
  current: readonly string[] | undefined,
  type: SkipDownloadResourceType,
  enabled: boolean,
): SkipDownloadResourceType[] | undefined {
  const next = new Set<SkipDownloadResourceType>();
  if (current) {
    for (const t of current) {
      if (VALID_TYPES.has(t as SkipDownloadResourceType)) {
        next.add(t as SkipDownloadResourceType);
      }
    }
  }
  if (enabled) {
    next.add(type);
  } else {
    next.delete(type);
  }
  if (next.size === 0) return undefined;
  const order: SkipDownloadResourceType[] = ['image', 'video', 'audio', 'file'];
  return order.filter((t) => next.has(t));
}
