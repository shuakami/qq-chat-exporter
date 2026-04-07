declare module 'NapCatQQ/src/core/types.js' {
    export enum ChatType {
        Friend = 1,
        Group = 2,
        Temp = 100,
        Guild = 4
    }

    export enum ElementType {
        TEXT = 1,
        PIC = 2,
        FILE = 3,
        VIDEO = 4,
        PTT = 4,
        FACE = 6,
        REPLY = 7,
        GreyTip = 8,
        ARK = 10,
        MULTIFORWARD = 16,
        SHARELOCATION = 20,
        CALENDAR = 21,
        MFACE = 37,
        MARKDOWN = 51
    }

    export enum NTMsgType {
        Text = 1,
        Picture = 2,
        File = 3,
        Video = 4,
        Voice = 5,
        Reply = 7
    }

    export class RawMessage {
        [key: string]: any;

        constructor(data?: Record<string, any>);
    }

    export class MessageElement {
        [key: string]: any;
        constructor(data?: Record<string, any>);
    }

    const _default: any;

    export default _default;
}

declare module 'NapCatQQ/src/core/index.js' {
    export * from 'NapCatQQ/src/core/types.js';

    export class NapCatCore {
        apis: any;
        context: any;
        selfInfo?: any;

        constructor();
    }

    export class Peer {
        chatType: any;
        peerUid: any;
        guildId: any;

        constructor(chatType: any, peerUid: any, guildId?: any);
    }

    export default NapCatCore;
}
