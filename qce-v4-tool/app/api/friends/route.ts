import { NextResponse } from "next/server"

const MOCK_FRIENDS = [
  { uid: "12519212", uin: 12519212, nick: "速冻饺子", remark: "", avatarUrl: "", isOnline: true, status: 10, categoryId: 1 },
  { uid: "98765432", uin: 98765432, nick: "小岳唷", remark: "小岳", avatarUrl: "", isOnline: false, status: 0, categoryId: 1 },
  { uid: "11223344", uin: 11223344, nick: "测试用户", remark: "", avatarUrl: "", isOnline: true, status: 10, categoryId: 2 },
  { uid: "55667788", uin: 55667788, nick: "文件分享", remark: "文件哥", avatarUrl: "", isOnline: false, status: 0, categoryId: 2 },
  { uid: "99887766", uin: 99887766, nick: "语音哥", remark: "", avatarUrl: "", isOnline: true, status: 10, categoryId: 1 },
  { uid: "44332211", uin: 44332211, nick: "视频达人", remark: "小视频", avatarUrl: "", isOnline: false, status: 0, categoryId: 3 },
  { uid: "33221100", uin: 33221100, nick: "表情包大王", remark: "", avatarUrl: "", isOnline: true, status: 10, categoryId: 1 },
]

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      friends: MOCK_FRIENDS,
      totalCount: MOCK_FRIENDS.length,
      hasNext: false,
    },
  })
}
