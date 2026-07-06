"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const MOCK_MESSAGES = [
  {
    msgId: "1",
    msgTime: 1751788800,
    sendType: 0,
    senderUid: "12519212",
    senderName: "速冻饺子",
    elements: [
      { textElement: { content: "大家好，今天更新了新版本" } }
    ]
  },
  {
    msgId: "2",
    msgTime: 1751788860,
    sendType: 0,
    senderUid: "12519212",
    senderName: "速冻饺子",
    elements: [
      { marketFaceElement: { faceName: "[肘击]", emojiId: "123" } }
    ]
  },
  {
    msgId: "3",
    msgTime: 1751788920,
    sendType: 1,
    senderUid: "self",
    senderName: "我",
    elements: [
      { picElement: { sourcePath: "/img/test.jpg", thumbPath: "/img/thumb.jpg" } }
    ]
  },
  {
    msgId: "4",
    msgTime: 1751788980,
    sendType: 0,
    senderUid: "98765432",
    senderName: "小岳唷",
    elements: [
      { replyElement: { sourceMsgText: "大家好，今天更新了新版本", sourceMsgTextElems: [{ textElemContent: "大家好，今天更新了新版本" }] } },
      { textElement: { content: "标价290" } }
    ]
  },
  {
    msgId: "5",
    msgTime: 1751789040,
    sendType: 0,
    senderUid: "11223344",
    senderName: "测试用户",
    elements: [
      { faceElement: { faceIndex: 14, faceType: 1 } }
    ]
  },
  {
    msgId: "6",
    msgTime: 1751789100,
    sendType: 0,
    senderUid: "55667788",
    senderName: "文件分享",
    elements: [
      { fileElement: { fileName: "项目计划.docx", fileSize: "2048000" } }
    ]
  },
  {
    msgId: "7",
    msgTime: 1751789160,
    sendType: 0,
    senderUid: "99887766",
    senderName: "语音哥",
    elements: [
      { pttElement: { duration: 15 } }
    ]
  },
  {
    msgId: "8",
    msgTime: 1751789220,
    sendType: 0,
    senderUid: "44332211",
    senderName: "视频达人",
    elements: [
      { videoElement: { videoMd5: "abc123" } }
    ]
  },
  {
    msgId: "9",
    msgTime: 1751789280,
    sendType: 0,
    senderUid: "12519212",
    senderName: "速冻饺子",
    elements: [
      { marketFaceElement: { faceName: "[龇牙]" } }
    ]
  },
  {
    msgId: "10",
    msgTime: 1751789340,
    sendType: 0,
    senderUid: "12519212",
    senderName: "速冻饺子",
    elements: [
      { arkElement: { bytesData: "{}" } }
    ]
  },
  {
    msgId: "11",
    msgTime: 1751789400,
    sendType: 0,
    senderUid: "12519212",
    senderName: "速冻饺子",
    elements: [
      { multiForwardMsgElement: { xmlContent: "" } }
    ]
  },
]

function formatMessageElements(elements: any[]): React.ReactNode[] {
  if (!elements?.length) return [<span key="empty" className="text-muted-foreground/50 italic">无文本内容</span>]
  const nodes: React.ReactNode[] = []
  let hasContent = false
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    if (el.replyElement) {
      const replyText = el.replyElement.sourceMsgTextElems
        ?.map((e: any) => e.textElemContent || '').join('').trim()
        || el.replyElement.sourceMsgText || ''
      nodes.push(
        <span key={`reply-${i}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 bg-black/[0.04] dark:bg-white/[0.06] rounded px-1.5 py-0.5 mr-1 align-middle">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          {replyText ? <span className="truncate max-w-[120px]">{replyText}</span> : '回复'}
        </span>
      )
      hasContent = true
    } else if (el.textElement?.content) {
      nodes.push(<span key={`text-${i}`}>{el.textElement.content}</span>)
      hasContent = true
    } else if (el.picElement) {
      nodes.push(
        <span key={`pic-${i}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground/70 align-middle">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
          图片
        </span>
      )
      hasContent = true
    } else if (el.marketFaceElement) {
      const faceName = el.marketFaceElement.faceName || '表情'
      nodes.push(
        <span key={`mface-${i}`} className="inline-flex items-center gap-0.5 text-sm align-middle">
          <span className="text-muted-foreground/70">{faceName}</span>
        </span>
      )
      hasContent = true
    } else if (el.faceElement) {
      const faceId = el.faceElement.faceIndex ?? el.faceElement.faceType ?? ''
      nodes.push(
        <span key={`face-${i}`} className="text-muted-foreground/70">[表情{faceId ? ` #${faceId}` : ''}]</span>
      )
      hasContent = true
    } else if (el.pttElement) {
      const duration = el.pttElement.duration ? `${el.pttElement.duration}"` : ''
      nodes.push(
        <span key={`ptt-${i}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground/70 align-middle">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
          语音{duration ? ` ${duration}` : ''}
        </span>
      )
      hasContent = true
    } else if (el.videoElement) {
      nodes.push(
        <span key={`video-${i}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground/70 align-middle">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg>
          视频
        </span>
      )
      hasContent = true
    } else if (el.fileElement) {
      const fileName = el.fileElement.fileName || '文件'
      nodes.push(
        <span key={`file-${i}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground/70 align-middle">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
          {fileName}
        </span>
      )
      hasContent = true
    } else if (el.arkElement) {
      nodes.push(<span key={`ark-${i}`} className="text-muted-foreground/70">[卡片消息]</span>)
      hasContent = true
    } else if (el.multiForwardMsgElement) {
      nodes.push(<span key={`fwd-${i}`} className="text-muted-foreground/70">[合并转发]</span>)
      hasContent = true
    }
  }
  if (!hasContent) return [<span key="empty" className="text-muted-foreground/50 italic">无文本内容</span>]
  return nodes
}

function formatTime(ts: number) {
  const d = new Date(ts * 1000)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function DemoPage() {
  const [batchMode] = useState(true)
  const [selectedItems] = useState(new Set(["group_12345"]))
  const [chatType, setChatType] = useState<'friend' | 'group' | 'manual-friend' | 'manual-group'>('friend')

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-5xl mx-auto space-y-12">

        <div>
          <h1 className="text-2xl font-semibold mb-2">QCE UI Demo</h1>
          <p className="text-sm text-muted-foreground">组件预览 - 展示所有 UI 修改</p>
        </div>

        {/* Section 1: Message Rendering */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">1. 消息渲染 (修复空消息 bug)</h2>
          <p className="text-sm text-muted-foreground">
            修复了 marketFaceElement、picElement、replyElement 等消息类型的渲染。之前这些类型会显示为"空消息"。
          </p>
          <div className="rounded-2xl bg-card border border-black/[0.04] dark:border-white/[0.04] overflow-hidden">
            <div className="px-6 py-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold">Bug 交流群</h3>
                  <p className="text-xs text-muted-foreground">群聊 · {MOCK_MESSAGES.length} 条消息</p>
                </div>
              </div>
            </div>
            <div className="px-6 pb-4 space-y-1">
              {MOCK_MESSAGES.map((msg, idx) => (
                <div
                  key={msg.msgId}
                  className="flex gap-3 px-4 py-3 rounded-xl transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                >
                  <Avatar className="w-8 h-8 flex-shrink-0 rounded-full">
                    <AvatarImage src={`https://q1.qlogo.cn/g?b=qq&nk=${msg.senderUid}&s=40`} />
                    <AvatarFallback className="bg-muted text-muted-foreground rounded-full text-xs">
                      {msg.senderName[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-foreground truncate">{msg.senderName}</span>
                      <span className="text-xs text-muted-foreground/50">{formatTime(msg.msgTime)}</span>
                    </div>
                    <p className="text-sm text-foreground/80 break-words leading-relaxed">
                      {formatMessageElements(msg.elements)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 2: Batch Toolbar */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">2. 批量操作工具栏 (去边框 + 浅灰背景)</h2>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-black/[0.025] px-2 py-1.5 dark:bg-white/[0.025]">
            <Button variant="ghost" size="sm" className="rounded-full h-8 px-3 text-[12px] text-muted-foreground hover:text-foreground">
              取消批量
            </Button>
            <Button variant="outline" size="sm" className="rounded-full h-8 px-3 text-[12px]">
              全选群
            </Button>
            <Button variant="outline" size="sm" className="rounded-full h-8 px-3 text-[12px]">
              全选好友
            </Button>
            <Button variant="outline" size="sm" className="rounded-full h-8 px-3 text-[12px]">
              全选当前
            </Button>
            <Button variant="ghost" size="sm" className="rounded-full h-8 px-3 text-[12px]" disabled>
              清空
            </Button>
            <Button size="sm" className="rounded-full h-8 px-4 text-[12px]">
              导出选中 ({selectedItems.size})
            </Button>
          </div>
        </section>

        {/* Section 3: Export Dialog Header */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">3. 导出对话框头部 (无边框/背景)</h2>
          <div className="rounded-2xl bg-card border border-black/[0.04] dark:border-white/[0.04] overflow-hidden">
            <div className="px-6 pt-5 pb-0">
              <h3 className="text-base font-semibold">批量导出聊天记录</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-muted-foreground">标题直接融入内容，无边框分隔</p>
            </div>
          </div>

          <div className="rounded-2xl bg-card border border-black/[0.04] dark:border-white/[0.04] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="font-medium text-foreground">Bug 交流群</span>
                <Badge variant="secondary" className="text-xs rounded-md">HTML</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="rounded-full text-[13px]">
                  下载
                </Button>
                <button className="w-8 h-8 flex items-center justify-center text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted rounded-lg transition-colors">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            </div>
            <div className="px-6 py-8 bg-muted/30 text-center text-muted-foreground text-sm">
              [预览内容区域]
            </div>
          </div>
        </section>

        {/* Section 4: Chat Type Selector */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">4. 聊天类型选择器 (4按钮一行)</h2>
          <div className="max-w-md">
            <div className="flex gap-1 p-0.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
              {[
                { key: 'friend' as const, label: '好友' },
                { key: 'group' as const, label: '群组' },
                { key: 'manual-friend' as const, label: '输入QQ号' },
                { key: 'manual-group' as const, label: '输入群号' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setChatType(tab.key)}
                  className={[
                    "flex-1 px-3 py-1.5 text-[13px] font-medium rounded-md transition-all text-center",
                    chatType === tab.key
                      ? "bg-white dark:bg-white/10 text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                      : "text-muted-foreground hover:text-foreground"
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {(chatType === 'manual-friend' || chatType === 'manual-group') && (
              <div className="space-y-3 pt-4">
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">
                    {chatType === 'manual-friend' ? 'QQ号码' : '群号'}
                  </Label>
                  <Input
                    placeholder={chatType === 'manual-friend' ? '输入要导出的QQ号' : '输入要导出的群号'}
                    className="rounded-full h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">备注名称（可选）</Label>
                  <Input
                    placeholder="给这个聊天起个名字"
                    className="rounded-full h-9"
                  />
                </div>
                <Button className="w-full rounded-full text-[13px] bg-[#171717] text-white hover:bg-[#171717]/90 dark:bg-white dark:text-[#171717] dark:hover:bg-white/90" size="sm">
                  确认
                </Button>
                <p className="text-xs text-muted-foreground/60">
                  {chatType === 'manual-friend' ? '适用于好友列表中未显示的用户' : '适用于群列表中未显示的群'}
                </p>
              </div>
            )}

            {chatType === 'friend' && (
              <div className="mt-4 text-sm text-muted-foreground text-center py-8">
                [好友列表区域]
              </div>
            )}
            {chatType === 'group' && (
              <div className="mt-4 text-sm text-muted-foreground text-center py-8">
                [群组列表区域]
              </div>
            )}
          </div>
        </section>

        {/* Section 5: Buttons (design-system style) */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">5. 按钮样式 (遵循 design-system)</h2>
          <p className="text-sm text-muted-foreground">
            主按钮: 深色 bg-[#171717]，rounded-full，text-[13px]，无图标。参考 design-system。
          </p>
          <div className="flex items-center gap-3">
            <Button variant="outline" className="rounded-full text-[13px]">取消</Button>
            <Button className="rounded-full text-[13px] bg-[#171717] text-white hover:bg-[#171717]/90 dark:bg-white dark:text-[#171717] dark:hover:bg-white/90">
              创建任务
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" className="rounded-full text-[13px]">取消</Button>
            <Button className="rounded-full text-[13px] bg-[#171717] text-white hover:bg-[#171717]/90 dark:bg-white dark:text-[#171717] dark:hover:bg-white/90">
              开始批量导出
            </Button>
          </div>
        </section>

        {/* Section 6: Preview Modal Header */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">6. 预览弹窗头部 (无分割线)</h2>
          <div className="rounded-2xl bg-card border border-black/[0.04] dark:border-white/[0.04] overflow-hidden">
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="w-10 h-10 rounded-full">
                  <AvatarImage src="https://q1.qlogo.cn/g?b=qq&nk=12519212&s=40" />
                  <AvatarFallback className="bg-muted text-muted-foreground rounded-full">速</AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-base font-semibold text-foreground leading-tight">Bug 交流群</h3>
                  <p className="text-xs text-muted-foreground">群聊 · 1,234 条消息</p>
                </div>
              </div>
              <button className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06] rounded-full transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="px-6 py-8 text-center text-muted-foreground text-sm">
              [消息列表区域 - 无上方分割线]
            </div>
          </div>
        </section>

        {/* Section 7: Task Wizard Header */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">7. 创建任务弹窗头部 (无边框/图标)</h2>
          <div className="rounded-2xl bg-card border border-black/[0.04] dark:border-white/[0.04] overflow-hidden">
            <div className="px-6 pt-5 pb-0">
              <h3 className="text-base font-semibold">创建导出任务</h3>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-muted-foreground">标题融入内容区，无边框分隔，无图标</p>
            </div>
            <div className="flex items-center justify-between px-6 py-4">
              <div className="text-[13px] text-muted-foreground">
                请完成所有必填项
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="rounded-full text-[13px]">取消</Button>
                <Button disabled className="rounded-full text-[13px] bg-[#171717] text-white hover:bg-[#171717]/90 dark:bg-white dark:text-[#171717] dark:hover:bg-white/90">
                  创建任务
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
