import type { MicrosoftRewardsBot } from '../index'
import type { Page } from 'patchright'

// App
import { DailyCheckIn } from './activities/app/DailyCheckIn'
import { ReadToEarn } from './activities/app/ReadToEarn'
import { AppReward } from './activities/app/AppReward'

// API
import { UrlReward } from './activities/api/UrlReward'
import { Quiz } from './activities/api/Quiz'
import { FindClippy } from './activities/api/FindClippy'
import { DoubleSearchPoints } from './activities/api/DoubleSearchPoints'

// Browser
import { SearchOnBing } from './activities/browser/SearchOnBing'
import { Search } from './activities/browser/Search'

import type {
    BasePromotion,
    DashboardData,
    FindClippyPromotion,
    PurplePromotionalItem
} from '../interface/DashboardData'
import type { Promotion } from '../interface/AppDashBoardData'

export default class Activities {
    private bot: MicrosoftRewardsBot

    private _search?: Search
    private _searchOnBing?: SearchOnBing
    private _urlReward?: UrlReward
    private _quiz?: Quiz
    private _findClippy?: FindClippy
    private _doubleSearchPoints?: DoubleSearchPoints
    private _appReward?: AppReward
    private _readToEarn?: ReadToEarn
    private _dailyCheckIn?: DailyCheckIn

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    // Browser Activities
    doSearch = async (data: DashboardData, page: Page, isMobile: boolean): Promise<number> => {
        this._search ??= new Search(this.bot)
        return await this._search.doSearch(data, page, isMobile)
    }

    doSearchOnBing = async (promotion: BasePromotion, page: Page): Promise<void> => {
        this._searchOnBing ??= new SearchOnBing(this.bot)
        await this._searchOnBing.doSearchOnBing(promotion, page)
    }

    /*
    doABC = async (page: Page): Promise<void> => {
        const abc = new ABC(this.bot)
        await abc.doABC(page)
    }
    */

    /*
    doPoll = async (page: Page): Promise<void> => {
        const poll = new Poll(this.bot)
        await poll.doPoll(page)
    }
    */

    /*
    doThisOrThat = async (page: Page): Promise<void> => {
        const thisOrThat = new ThisOrThat(this.bot)
        await thisOrThat.doThisOrThat(page)
    }
    */

    // API Activities
    doUrlReward = async (promotion: BasePromotion): Promise<void> => {
        this._urlReward ??= new UrlReward(this.bot)
        await this._urlReward.doUrlReward(promotion)
    }

    doQuiz = async (promotion: BasePromotion): Promise<void> => {
        this._quiz ??= new Quiz(this.bot)
        await this._quiz.doQuiz(promotion)
    }

    doFindClippy = async (promotion: FindClippyPromotion): Promise<void> => {
        this._findClippy ??= new FindClippy(this.bot)
        await this._findClippy.doFindClippy(promotion)
    }

    doDoubleSearchPoints = async (promotion: PurplePromotionalItem): Promise<void> => {
        this._doubleSearchPoints ??= new DoubleSearchPoints(this.bot)
        await this._doubleSearchPoints.doDoubleSearchPoints(promotion)
    }

    // App Activities
    doAppReward = async (promotion: Promotion): Promise<void> => {
        this._appReward ??= new AppReward(this.bot)
        await this._appReward.doAppReward(promotion)
    }

    doReadToEarn = async (): Promise<void> => {
        this._readToEarn ??= new ReadToEarn(this.bot)
        await this._readToEarn.doReadToEarn()
    }

    doDailyCheckIn = async (): Promise<void> => {
        this._dailyCheckIn ??= new DailyCheckIn(this.bot)
        await this._dailyCheckIn.doDailyCheckIn()
    }
}
