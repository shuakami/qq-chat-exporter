import { ModifyProfileParams, User, UserDetailSource } from '@/core/types';
import { RequestUtil } from '@/common/request';
import { InstanceContext, NapCatCore, ProfileBizType } from '..';
import { solveAsyncProblem } from '@/common/helper';
import { Fallback, FallbackUtil } from '@/common/fall-back';

export class NTQQUserApi {
    context: InstanceContext;
    core: NapCatCore;

    constructor(context: InstanceContext, core: NapCatCore) {
        this.context = context;
        this.core = core;
    }

    async getCoreAndBaseInfo(uids: string[]) {
        return await this.core.eventWrapper.callNoListenerEvent(
            'NodeIKernelProfileService/getCoreAndBaseInfo',
            'nodeStore',
            uids,
        );
    }

    // 默认获取自己的 type = 2 获取别人 type = 1
    async getProfileLike(uid: string, start: number, count: number, type: number = 2) {
        return this.context.session.getProfileLikeService().getBuddyProfileLike({
            friendUids: [uid],
            basic: 1,
            vote: 1,
            favorite: 0,
            userProfile: 1,
            type: type,
            start: start,
            limit: count,
        });
    }
    async setLongNick(longNick: string) {
        return this.context.session.getProfileService().setLongNick(longNick);
    }

    async setSelfOnlineStatus(status: number, extStatus: number, batteryStatus: number) {
        return this.context.session.getMsgService().setStatus({
            status: status,
            extStatus: extStatus,
            batteryStatus: batteryStatus,
        });
    }

    async setDiySelfOnlineStatus(faceId: string, wording: string, faceType: string) {
        return this.context.session.getMsgService().setStatus({
            status: 10,
            extStatus: 2000,
            customStatus: { faceId: faceId, wording: wording, faceType: faceType },
            batteryStatus: 0
        });
    }

    async getBuddyRecommendContactArkJson(uin: string, sencenID = '') {
        return this.context.session.getBuddyService().getBuddyRecommendContactArkJson(uin, sencenID);
    }

    async like(uid: string, count = 1): Promise<{ result: number, errMsg: string, succCounts: number }> {
        return this.context.session.getProfileLikeService().setBuddyProfileLike({
            friendUid: uid,
            sourceId: 71,
            doLikeCount: count,
            doLikeTollCount: 0,
        });
    }

    async setQQAvatar(filePath: string) {
        const ret = await this.context.session.getProfileService().setHeader(filePath);
        return { result: ret?.result, errMsg: ret?.errMsg };
    }

    async setGroupAvatar(gc: string, filePath: string) {
        return this.context.session.getGroupService().setHeader(gc, filePath);
    }

    async fetchUserDetailInfo(uid: string, mode: UserDetailSource = UserDetailSource.KDB) {
        const [, profile] = await this.core.eventWrapper.callNormalEventV2(
            'NodeIKernelProfileService/fetchUserDetailInfo',
            'NodeIKernelProfileListener/onUserDetailInfoChanged',
            [
                'BuddyProfileStore',
                [uid],
                mode,
                [ProfileBizType.KALL],
            ],
            () => true,
            (profile) => profile.uid === uid,
        );
        return profile;
    }

    async getUserDetailInfo(uid: string, no_cache: boolean = false): Promise<User> {
        let profile = await solveAsyncProblem(async (uid) => this.fetchUserDetailInfo(uid, no_cache ? UserDetailSource.KSERVER : UserDetailSource.KDB), uid);
        if (profile && profile.uin !== '0' && profile.commonExt) {
            return {
                ...profile.simpleInfo.status,
                ...profile.simpleInfo.vasInfo,
                ...profile.commonExt,
                ...profile.simpleInfo.baseInfo,
                ...profile.simpleInfo.coreInfo,
                qqLevel: profile.commonExt?.qqLevel,
                age: profile.simpleInfo.baseInfo.age,
                pendantId: '',
                nick: profile.simpleInfo.coreInfo.nick || '',
            };
        }
        this.context.logger.logDebug('[NapCat] [Mark] getUserDetailInfo Mode1 Failed.');
        profile = await this.fetchUserDetailInfo(uid, UserDetailSource.KSERVER);
        if (profile && profile.uin === '0') {
            profile.uin = await this.core.apis.UserApi.getUidByUinV2(uid) ?? '0';
        }
        return {
            ...profile.simpleInfo.status,
            ...profile.simpleInfo.vasInfo,
            ...profile.commonExt,
            ...profile.simpleInfo.baseInfo,
            ...profile.simpleInfo.coreInfo,
            qqLevel: profile.commonExt?.qqLevel,
            age: profile.simpleInfo.baseInfo.age,
            pendantId: '',
            nick: profile.simpleInfo.coreInfo.nick || '',
        };
    }

    async modifySelfProfile(param: ModifyProfileParams) {
        return this.context.session.getProfileService().modifyDesktopMiniProfile(param);
    }

    async getCookies(domain: string) {
        const ClientKeyData = await this.forceFetchClientKey();
        const requestUrl = 'https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin=' + this.core.selfInfo.uin +
            '&clientkey=' + ClientKeyData.clientKey + '&u1=https%3A%2F%2F' + domain + '%2F' + this.core.selfInfo.uin + '%2Finfocenter&keyindex=19%27';
        const data = await RequestUtil.HttpsGetCookies(requestUrl);
        if (!data['p_skey'] || data['p_skey'].length == 0) {
            try {
                const pskey = (await this.getPSkey([domain])).domainPskeyMap.get(domain);
                if (pskey) data['p_skey'] = pskey;
            } catch {
                return data;
            }
        }
        return data;
    }

    async getPSkey(domainList: string[]) {
        return await this.context.session.getTipOffService().getPskey(domainList, true);
    }

    async getRobotUinRange(): Promise<Array<unknown>> {
        const robotUinRanges = await this.context.session.getRobotService().getRobotUinRange({
            justFetchMsgConfig: '1',
            type: 1,
            version: 0,
            aioKeywordVersion: 0,
        });
        return robotUinRanges?.response?.robotUinRanges;
    }

    //需要异常处理

    async getQzoneCookies() {
        const ClientKeyData = await this.forceFetchClientKey();
        const requestUrl = 'https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin=' + this.core.selfInfo.uin + '&clientkey=' + ClientKeyData.clientKey + '&u1=https%3A%2F%2Fuser.qzone.qq.com%2F' + this.core.selfInfo.uin + '%2Finfocenter&keyindex=19%27';
        return await RequestUtil.HttpsGetCookies(requestUrl);
    }

    //需要异常处理

    async getSKey(): Promise<string | undefined> {
        const ClientKeyData = await this.forceFetchClientKey();
        if (ClientKeyData.result !== 0) {
            throw new Error('getClientKey Error');
        }
        const clientKey = ClientKeyData.clientKey;
        // const keyIndex = ClientKeyData.keyIndex;
        const requestUrl = 'https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin=' + this.core.selfInfo.uin + '&clientkey=' + clientKey + '&u1=https%3A%2F%2Fh5.qzone.qq.com%2Fqqnt%2Fqzoneinpcqq%2Ffriend%3Frefresh%3D0%26clientuin%3D0%26darkMode%3D0&keyindex=19%27';
        const cookies: { [key: string]: string; } = await RequestUtil.HttpsGetCookies(requestUrl);
        const skey = cookies['skey'];
        if (!skey) {
            throw new Error('SKey is Empty');
        }

        return skey;
    }

    async getUidByUinV2(uin: string) {
        if (!uin) {
            return '';
        }

        const fallback =
            new Fallback<string | undefined>((uid) => FallbackUtil.boolchecker(uid, uid !== undefined && uid.indexOf('*') === -1 && uid !== ''))
                .add(() => this.context.session.getUixConvertService().getUid([uin]).then((data) => data.uidInfo.get(uin)))
                .add(() => this.context.session.getProfileService().getUidByUin('FriendsServiceImpl', [uin]).get(uin))
                .add(() => this.context.session.getGroupService().getUidByUins([uin]).then((data) => data.uids.get(uin)))
                .add(() => this.getUserDetailInfoByUin(uin).then((data) => data.detail.uid));

        const uid = await fallback.run().catch(() => '');
        return uid ?? '';
    }

    async getUinByUidV2(uid: string) {
        if (!uid) {
            return '0';
        }

        const fallback = new Fallback<string | undefined>((uin) => FallbackUtil.boolchecker(uin, uin !== undefined && uin !== '0' && uin !== ''))
            .add(() => this.context.session.getUixConvertService().getUin([uid]).then((data) => data.uinInfo.get(uid)))
            .add(() => this.context.session.getProfileService().getUinByUid('FriendsServiceImpl', [uid]).get(uid))
            .add(() => this.context.session.getGroupService().getUinByUids([uid]).then((data) => data.uins.get(uid)))
            .add(() => this.getUserDetailInfo(uid).then((data) => data.uin));

        const uin = await fallback.run().catch(() => '0');
        return uin ?? '0';
    }

    async getRecentContactListSnapShot(count: number) {
        return await this.context.session.getRecentContactService().getRecentContactListSnapShot(count);
    }

    async getRecentContactListSyncLimit(count: number) {
        return await this.context.session.getRecentContactService().getRecentContactListSyncLimit(count);
    }

    async getRecentContactListSync() {
        return await this.context.session.getRecentContactService().getRecentContactListSync();
    }

    async getRecentContactList() {
        return await this.context.session.getRecentContactService().getRecentContactList();
    }

    async getUserDetailInfoByUin(Uin: string) {
        return await this.core.eventWrapper.callNoListenerEvent(
            'NodeIKernelProfileService/getUserDetailInfoByUin',
            Uin
        );
    }

    async forceFetchClientKey() {
        return await this.context.session.getTicketService().forceFetchClientKey('');
    }
}
