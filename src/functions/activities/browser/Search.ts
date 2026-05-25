import type { Page } from 'patchright'

import { randomBytes } from 'crypto'

import type { Counters, DashboardData } from '../../../interface/DashboardData'

import { QueryCore } from '../../QueryEngine'

import { Workers } from '../../Workers'
import { errMsg } from '../../../util/Utils'

export class Search extends Workers {
    private bingHome = 'https://bing.com'
    private searchPageURL = ''
    private searchCount = 0

    public async doSearch(data: DashboardData, page: Page, isMobile: boolean): Promise<number> {
        const startBalance = Number(this.bot.userData.currentPoints ?? 0)

        this.bot.logger.info(isMobile, 'SEARCH-BING', `Starting Bing searches | currentPoints=${startBalance}`)

        let totalGainedPoints = 0

        try {
            let searchCounters: Counters = await this.bot.browser.func.getSearchPoints()
            const missingPoints = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
            let missingPointsTotal = missingPoints.totalPoints

            this.bot.logger.debug(
                isMobile,
                'SEARCH-BING',
                `Initial search counters | mobile=${missingPoints.mobilePoints} | desktop=${missingPoints.desktopPoints} | edge=${missingPoints.edgePoints}`
            )

            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `Search points remaining | Edge=${missingPoints.edgePoints} | Desktop=${missingPoints.desktopPoints} | Mobile=${missingPoints.mobilePoints}`
            )

            const queryCore = new QueryCore(this.bot)
            const locale = (this.bot.userData.geoLocale ?? 'US').toUpperCase()
            const langCode = (this.bot.userData.langCode ?? 'en').toLowerCase()

            this.bot.logger.debug(
                isMobile,
                'SEARCH-BING',
                `Resolving search queries via QueryCore | locale=${locale} | lang=${langCode} | related=true`
            )

            let queries = await queryCore.queryManager({
                shuffle: true,
                related: true,
                langCode,
                geoLocale: locale,
                sourceOrder: ['google', 'wikipedia', 'reddit', 'local']
            })

            queries = [...new Set(queries.map(q => q.trim()).filter(Boolean))]

            this.bot.logger.info(isMobile, 'SEARCH-BING', `Search query pool ready | count=${queries.length}`)

            // Go to bing
            const targetUrl = this.searchPageURL ? this.searchPageURL : this.bingHome
            this.bot.logger.debug(isMobile, 'SEARCH-BING', `Navigating to search page | url=${targetUrl}`)

            await page.goto(targetUrl)
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
            await this.bot.browser.utils.tryDismissAllMessages(page)

            const runSearchLoop = async (
                queryPool: string[],
                tag: string,
                stagnantMax: number,
                opts?: { refillQueries?: boolean }
            ): Promise<{ stagnant: boolean }> => {
                let stagnantLoop = 0

                for (let i = 0; i < queryPool.length; i++) {
                    const query = queryPool[i] as string

                    searchCounters = await this.bingSearch(page, query, isMobile)
                    const newMissing = this.bot.browser.func.missingSearchPoints(searchCounters, isMobile)
                    const newMissingTotal = newMissing.totalPoints
                    const gainedPoints = Math.max(0, missingPointsTotal - newMissingTotal)

                    if (gainedPoints === 0) {
                        stagnantLoop++
                        this.bot.logger.info(
                            isMobile,
                            tag,
                            `No points gained ${stagnantLoop}/${stagnantMax} | query="${query}" | remaining=${newMissingTotal}`
                        )
                    } else {
                        stagnantLoop = 0
                        this.bot.userData.currentPoints = Number(this.bot.userData.currentPoints ?? 0) + gainedPoints
                        this.bot.userData.gainedPoints = (this.bot.userData.gainedPoints ?? 0) + gainedPoints
                        totalGainedPoints += gainedPoints
                        this.bot.logger.info(
                            isMobile,
                            tag,
                            `gainedPoints=${gainedPoints} points | query="${query}" | remaining=${newMissingTotal}`,
                            'green'
                        )
                    }

                    missingPointsTotal = newMissingTotal

                    if (missingPointsTotal === 0) {
                        this.bot.logger.info(isMobile, tag, 'All required search points earned')
                        return { stagnant: false }
                    }

                    if (stagnantLoop > stagnantMax) {
                        this.bot.logger.warn(isMobile, tag, `No points for ${stagnantMax} iterations, aborting`)
                        return { stagnant: true }
                    }

                    if (opts?.refillQueries) {
                        const remaining = queryPool.length - (i + 1)
                        if (missingPointsTotal > 0 && remaining < 20) {
                            this.bot.logger.warn(
                                isMobile,
                                tag,
                                `Low query buffer, regenerating | remainingQueries=${remaining} | missing=${missingPointsTotal}`
                            )
                            const extra = await queryCore.queryManager({
                                shuffle: true,
                                related: true,
                                langCode,
                                geoLocale: locale,
                                sourceOrder: this.bot.config.searchSettings.queryEngines
                            })
                            const merged = [...queryPool, ...extra].map(q => q.trim()).filter(Boolean)
                            queryPool = [...new Set(merged)]
                            queryPool = this.bot.utils.shuffleArray(queryPool)
                            this.bot.logger.debug(isMobile, tag, `Query pool regenerated | count=${queryPool.length}`)
                        }
                    }
                }

                return { stagnant: false }
            }

            const mainResult = await runSearchLoop(queries, 'SEARCH-BING', 10, { refillQueries: true })

            if (missingPointsTotal > 0 && !mainResult.stagnant) {
                this.bot.logger.info(
                    isMobile,
                    'SEARCH-BING',
                    `Continuing with extra queries | remaining=${missingPointsTotal}`
                )

                const MAX_EXTRA_ROUNDS = 3
                for (let round = 0; round < MAX_EXTRA_ROUNDS && missingPointsTotal > 0; round++) {
                    const extra = await queryCore.queryManager({
                        shuffle: true,
                        related: true,
                        langCode,
                        geoLocale: locale,
                        sourceOrder: this.bot.config.searchSettings.queryEngines
                    })

                    const merged = [...queries, ...extra].map(q => q.trim()).filter(Boolean)
                    queries = this.bot.utils.shuffleArray([...new Set(merged)])

                    this.bot.logger.info(
                        isMobile,
                        'SEARCH-BING-EXTRA',
                        `Round ${round + 1} | queries=${queries.length}`
                    )

                    const extraResult = await runSearchLoop(queries, 'SEARCH-BING-EXTRA', 5)
                    if (extraResult.stagnant || missingPointsTotal === 0) break
                }
            }

            const finalBalance = Number(this.bot.userData.currentPoints ?? startBalance)

            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `Completed Bing searches | startBalance=${startBalance} | newBalance=${finalBalance}`
            )

            return totalGainedPoints
        } catch (error) {
            this.bot.logger.error(isMobile, 'SEARCH-BING', `Error in doSearch | message=${errMsg(error)}`)
            return totalGainedPoints
        }
    }

    private async bingSearch(searchPage: Page, query: string, isMobile: boolean) {
        const maxAttempts = 5
        const refreshThreshold = 10 // Page gets sluggish after x searches?

        this.searchCount++

        if (this.searchCount % refreshThreshold === 0) {
            this.bot.logger.info(
                isMobile,
                'SEARCH-BING',
                `Returning to home page to clear accumulated page context | count=${this.searchCount} | threshold=${refreshThreshold}`
            )

            this.bot.logger.debug(isMobile, 'SEARCH-BING', `Returning home to refresh state | url=${this.bingHome}`)

            const cvid = randomBytes(16).toString('hex')
            const url = `${this.bingHome}/search?q=${encodeURIComponent(query)}&PC=U531&FORM=ANNTA1&cvid=${cvid}`

            await searchPage.goto(url)
            await searchPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
            await this.bot.browser.utils.tryDismissAllMessages(searchPage)
        }

        this.bot.logger.debug(
            isMobile,
            'SEARCH-BING',
            `Starting bingSearch | query="${query}" | maxAttempts=${maxAttempts} | searchCount=${this.searchCount} | refreshEvery=${refreshThreshold} | scrollRandomResults=${this.bot.config.searchSettings.scrollRandomResults} | clickRandomResults=${this.bot.config.searchSettings.clickRandomResults}`
        )

        for (let i = 0; i < maxAttempts; i++) {
            try {
                const searchBar = '#sb_form_q'
                const searchBox = searchPage.locator(searchBar)

                await searchPage.evaluate(() => {
                    window.scrollTo({ left: 0, top: 0, behavior: 'auto' })
                })

                await searchPage.keyboard.press('Home')
                await searchBox.waitFor({ state: 'visible', timeout: 15000 })

                await this.bot.utils.wait(1000)
                await this.bot.browser.utils.ghostClick(searchPage, searchBar, { clickCount: 3 })
                await searchBox.fill('')

                await searchPage.keyboard.type(query, { delay: 50 })
                await searchPage.keyboard.press('Enter')

                this.bot.logger.debug(
                    isMobile,
                    'SEARCH-BING',
                    `Submitted query to Bing | attempt=${i + 1}/${maxAttempts} | query="${query}"`
                )

                await this.bot.utils.wait(3000)

                if (this.bot.config.searchSettings.scrollRandomResults) {
                    await this.bot.utils.wait(2000)
                    await this.randomScroll(searchPage, isMobile)
                }

                if (this.bot.config.searchSettings.clickRandomResults) {
                    await this.bot.utils.wait(2000)
                    await this.clickRandomLink(searchPage, isMobile)
                }

                await this.bot.utils.wait(
                    this.bot.utils.randomDelay(
                        this.bot.config.searchSettings.searchDelay.min,
                        this.bot.config.searchSettings.searchDelay.max
                    )
                )

                const counters = await this.bot.browser.func.getSearchPoints()

                this.bot.logger.debug(
                    isMobile,
                    'SEARCH-BING',
                    `Search counters after query | attempt=${i + 1}/${maxAttempts} | query="${query}"`
                )

                return counters
            } catch (error) {
                if (i >= 5) {
                    this.bot.logger.error(
                        isMobile,
                        'SEARCH-BING',
                        `Failed after 5 retries | query="${query}" | message=${errMsg(error)}`
                    )
                    break
                }

                this.bot.logger.error(
                    isMobile,
                    'SEARCH-BING',
                    `Search attempt failed | attempt=${i + 1}/${maxAttempts} | query="${query}" | message=${errMsg(error)}`
                )

                this.bot.logger.warn(
                    isMobile,
                    'SEARCH-BING',
                    `Retrying search | attempt=${i + 1}/${maxAttempts} | query="${query}"`
                )

                await this.bot.utils.wait(2000)
            }
        }

        this.bot.logger.debug(
            isMobile,
            'SEARCH-BING',
            `Returning current search counters after failed retries | query="${query}"`
        )

        return await this.bot.browser.func.getSearchPoints()
    }

    private async randomScroll(page: Page, isMobile: boolean) {
        try {
            const viewportHeight = await page.evaluate(() => window.innerHeight)
            const totalHeight = await page.evaluate(() => document.body.scrollHeight)
            const randomScrollPosition = Math.floor(Math.random() * (totalHeight - viewportHeight))

            this.bot.logger.debug(
                isMobile,
                'SEARCH-RANDOM-SCROLL',
                `Random scroll | viewportHeight=${viewportHeight} | totalHeight=${totalHeight} | scrollPos=${randomScrollPosition}`
            )

            await page.evaluate((scrollPos: number) => {
                window.scrollTo({ left: 0, top: scrollPos, behavior: 'auto' })
            }, randomScrollPosition)
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'SEARCH-RANDOM-SCROLL',
                `An error occurred during random scroll | message=${errMsg(error)}`
            )
        }
    }

    private async clickRandomLink(page: Page, isMobile: boolean) {
        try {
            this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', 'Attempting to click a random search result link')

            const searchPageUrl = page.url()

            await this.bot.browser.utils.ghostClick(page, '#b_results .b_algo h2')
            await this.bot.utils.wait(this.bot.config.searchSettings.searchResultVisitTime)

            if (isMobile) {
                await page.goto(searchPageUrl)
                this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', 'Navigated back to search page')
            } else {
                const newTab = await this.bot.browser.utils.getLatestTab(page)
                const newTabUrl = newTab.url()

                this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', `Visited result tab | url=${newTabUrl}`)

                await this.bot.browser.utils.closeTabs(newTab)
                this.bot.logger.debug(isMobile, 'SEARCH-RANDOM-CLICK', 'Closed result tab')
            }
        } catch (error) {
            this.bot.logger.error(
                isMobile,
                'SEARCH-RANDOM-CLICK',
                `An error occurred during random click | message=${errMsg(error)}`
            )
        }
    }
}
