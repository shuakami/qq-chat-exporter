import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      contacts: [
        { peerUid: "123456789", peerUin: "123456789", name: "Bug 交流群", chatType: 2, lastMsgTime: "2026-07-06T01:25:00Z", classification: "group" },
        { peerUid: "12519212", peerUin: "12519212", name: "速冻饺子", chatType: 1, lastMsgTime: "2026-07-06T01:25:00Z", classification: "friend" },
        { peerUid: "98765432", peerUin: "98765432", name: "小岳唷", chatType: 1, lastMsgTime: "2026-07-05T20:41:00Z", classification: "friend" },
      ],
    },
  })
}
