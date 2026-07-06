import { NextResponse } from "next/server"

const MOCK_MESSAGES = [
  {
    msgId: "msg001", msgTime: 1751789100, sendType: 0, senderUid: "12519212", senderUin: "12519212",
    sendNickName: "速冻饺子", sendMemberName: "速冻饺子",
    elements: [{ textElement: { content: "大家好，今天更新了新版本 v5.5" } }]
  },
  {
    msgId: "msg002", msgTime: 1751789160, sendType: 0, senderUid: "98765432", senderUin: "98765432",
    sendNickName: "小岳唷", sendMemberName: "小岳唷",
    elements: [
      { replyElement: { sourceMsgText: "大家好，今天更新了新版本 v5.5", sourceMsgTextElems: [{ textElemContent: "大家好，今天更新了新版本 v5.5" }] } },
      { textElement: { content: "标价290" } }
    ]
  },
  {
    msgId: "msg003", msgTime: 1751789220, sendType: 0, senderUid: "12519212", senderUin: "12519212",
    sendNickName: "速冻饺子", sendMemberName: "速冻饺子",
    elements: [{ marketFaceElement: { faceName: "[肘击]", emojiId: "209622" } }]
  },
  {
    msgId: "msg004", msgTime: 1751789280, sendType: 0, senderUid: "11223344", senderUin: "11223344",
    sendNickName: "测试用户", sendMemberName: "测试用户",
    elements: [{ picElement: { originImageUrl: "https://gchat.qpic.cn/gchatpic_new/0/0-0-0/0?term=2&is_origin=0", sourcePath: "/mock/img.jpg", thumbPath: "/mock/thumb.jpg", picWidth: 300, picHeight: 200 } }]
  },
  {
    msgId: "msg005", msgTime: 1751789340, sendType: 0, senderUid: "55667788", senderUin: "55667788",
    sendNickName: "文件分享", sendMemberName: "文件分享",
    elements: [{ fileElement: { fileName: "项目计划.docx", fileSize: "2048000" } }]
  },
  {
    msgId: "msg006", msgTime: 1751789400, sendType: 0, senderUid: "33221100", senderUin: "33221100",
    sendNickName: "表情包大王", sendMemberName: "表情包大王",
    elements: [{ marketFaceElement: { faceName: "[龇牙]", emojiId: "114806" } }]
  },
  {
    msgId: "msg007", msgTime: 1751789460, sendType: 0, senderUid: "99887766", senderUin: "99887766",
    sendNickName: "语音哥", sendMemberName: "语音哥",
    elements: [{ pttElement: { duration: 15, formatType: 1 } }]
  },
  {
    msgId: "msg008", msgTime: 1751789520, sendType: 0, senderUid: "44332211", senderUin: "44332211",
    sendNickName: "视频达人", sendMemberName: "视频达人",
    elements: [{ videoElement: { videoMd5: "abc123", thumbWidth: 320, thumbHeight: 240 } }]
  },
  {
    msgId: "msg009", msgTime: 1751789580, sendType: 0, senderUid: "12519212", senderUin: "12519212",
    sendNickName: "速冻饺子", sendMemberName: "速冻饺子",
    elements: [{ textElement: { content: "这个版本修了好多 bug" } }]
  },
  {
    msgId: "msg010", msgTime: 1751789640, sendType: 0, senderUid: "98765432", senderUin: "98765432",
    sendNickName: "小岳唷", sendMemberName: "小岳唷",
    elements: [{ faceElement: { faceIndex: 14, faceType: 1 } }]
  },
  {
    msgId: "msg011", msgTime: 1751789700, sendType: 0, senderUid: "12519212", senderUin: "12519212",
    sendNickName: "速冻饺子", sendMemberName: "速冻饺子",
    elements: [{ arkElement: { bytesData: "{}" } }]
  },
  {
    msgId: "msg012", msgTime: 1751789760, sendType: 0, senderUid: "33221100", senderUin: "33221100",
    sendNickName: "表情包大王", sendMemberName: "表情包大王",
    elements: [{ multiForwardMsgElement: { xmlContent: "" } }]
  },
  {
    msgId: "msg013", msgTime: 1751789820, sendType: 0, senderUid: "11223344", senderUin: "11223344",
    sendNickName: "测试用户", sendMemberName: "测试用户",
    elements: [
      { textElement: { content: "谁有最新的安装包？看这里 https://github.com/shuakami/qq-chat-exporter/releases 有所有版本" } }
    ]
  },
  {
    msgId: "msg014", msgTime: 1751789880, sendType: 0, senderUid: "12519212", senderUin: "12519212",
    sendNickName: "速冻饺子", sendMemberName: "速冻饺子",
    elements: [
      { replyElement: { sourceMsgText: "谁有最新的安装包？", sourceMsgTextElems: [{ textElemContent: "谁有最新的安装包？" }] } },
      { textElement: { content: "群文件里有" } }
    ]
  },
  {
    msgId: "msg015", msgTime: 1751789940, sendType: 0, senderUid: "55667788", senderUin: "55667788",
    sendNickName: "文件分享", sendMemberName: "文件分享",
    elements: [{ marketFaceElement: { faceName: "[OK]" } }]
  },
]

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")

  const start = (page - 1) * limit
  const end = start + limit
  const paginatedMessages = MOCK_MESSAGES.slice(start, end)

  return NextResponse.json({
    success: true,
    data: {
      messages: paginatedMessages,
      totalCount: MOCK_MESSAGES.length,
      page,
      hasNext: end < MOCK_MESSAGES.length,
    },
  })
}
