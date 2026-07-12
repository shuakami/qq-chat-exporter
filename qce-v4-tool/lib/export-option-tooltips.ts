export const EXPORT_OPTION_TOOLTIPS = {
  allMessages: "选择“全部消息”后，QCE 将导出当前会话中的全部消息。",
  streaming:
    "启用后，QCE 会在读取消息的同时写入文件，以降低大规模导出时的内存占用。该选项更适合消息量较大的会话。",
  includeSystemMessages:
    "关闭后，导出结果将不包含入群、退群、撤回等系统事件。完整存档时建议保持开启。",
  quickExport:
    "启用后，QCE 会跳过图片、视频、语音和文件的下载，仅保留消息文本与资源信息，从而缩短导出时间。",
  fileMetadataOnly:
    "启用后，QCE 不会下载文件，只会保留文件名、大小和 MD5 等信息。图片、视频和语音的下载不受影响。",
  skipImages:
    "启用后，QCE 不会下载图片。HTML 导出会显示占位内容，其他格式会保留相关信息。",
  skipVideos:
    "启用后，QCE 不会下载视频，可减少导出耗时、网络流量和磁盘占用。",
  skipAudio:
    "启用后，QCE 不会下载或转码语音，只会保留对应的消息记录与资源信息。",
  preferGroupMemberName:
    "启用后，导出结果会优先显示群名片；无法获取群名片时，QCE 会使用 QQ 昵称。",
  exportAsZip:
    "启用后，QCE 会将 HTML 文件和资源目录打包为一个 ZIP 文件，便于传输和归档。",
  includeChatName:
    "关闭后，导出文件名将只包含会话 ID 和时间信息。",
  friendlyFileName:
    "启用后，导出文件将使用“名称(QQ号).扩展名”的格式命名。出现重名时，QCE 会自动追加日期和时间。",
  embedAvatars:
    "启用后，QCE 会将头像数据直接写入 JSON，不再依赖外部头像链接。导出的 JSON 文件会因此增大。",
  selfContainedHtml:
    "启用后，QCE 会将资源数据直接写入 HTML，生成可独立打开的单个文件。文件体积会增大，资源较多时加载速度可能下降。",
} as const
