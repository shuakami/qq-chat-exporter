import { NextResponse } from "next/server"

const MOCK_GROUPS = [
  { groupCode: "123456789", groupName: "Bug 交流群", memberCount: 328, maxMemberCount: 500, ownerUin: "12519212", lastMsgTime: "2026-07-06T01:25:00Z" },
  { groupCode: "987654321", groupName: "开发讨论组", memberCount: 156, maxMemberCount: 500, ownerUin: "98765432", lastMsgTime: "2026-07-05T22:10:00Z" },
  { groupCode: "111222333", groupName: "QCE 内测群", memberCount: 42, maxMemberCount: 200, ownerUin: "12519212", lastMsgTime: "2026-07-06T00:45:00Z" },
  { groupCode: "444555666", groupName: "技术分享", memberCount: 512, maxMemberCount: 1000, ownerUin: "55667788", lastMsgTime: "2026-07-05T18:30:00Z" },
  { groupCode: "777888999", groupName: "日常闲聊", memberCount: 89, maxMemberCount: 200, ownerUin: "44332211", lastMsgTime: "2026-07-04T15:00:00Z" },
]

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      groups: MOCK_GROUPS,
      totalCount: MOCK_GROUPS.length,
      hasNext: false,
    },
  })
}
