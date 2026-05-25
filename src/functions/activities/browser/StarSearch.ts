import type { Page } from 'patchright'
import { randomBytes } from 'crypto'

import type { MicrosoftRewardsBot } from '../../../index'
import { QueryCore } from '../../QueryEngine'
import { errMsg } from '../../../util/Utils'

/**
 * STAR Search — Supplementary Topic-Aware Random Search
 *
 * Runs AFTER point-earning searches are complete.
 * Generates N completely different topics, then expands each topic
 * into additional related searches for a more natural browsing pattern.
 */
export class StarSearch {
    private bot: MicrosoftRewardsBot
    private bingHome = 'https://bing.com'
    private searchCount = 0

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async doStarSearch(page: Page, isMobile: boolean): Promise<void> {
        const starCount = this.bot.config.workers.starSearchCount ?? 5

        this.bot.logger.info(isMobile, 'STAR-SEARCH', `Starting STAR Search | topics=${starCount}`)

        try {
            const queryCore = new QueryCore(this.bot)
            const locale = (this.bot.userData.geoLocale ?? 'US').toUpperCase()
            const langCode = (this.bot.userData.langCode ?? 'en').toLowerCase()

            // Step 1: Generate diverse base topics from multiple sources
            const allQueries = await queryCore.queryManager({
                shuffle: true,
                related: false,
                langCode,
                geoLocale: locale,
                sourceOrder: this.bot.config.searchSettings.queryEngines
            })

            const uniqueTopics = [...new Set(allQueries.map(q => q.trim()).filter(Boolean))]
            const baseTopics = this.bot.utils.shuffleArray(uniqueTopics).slice(0, starCount)

            if (baseTopics.length === 0) {
                this.bot.logger.warn(isMobile, 'STAR-SEARCH', 'No topics available, skipping')
                return
            }

            this.bot.logger.info(
                isMobile,
                'STAR-SEARCH',
                `Generated ${baseTopics.length} base topics: ${baseTopics.map(t => `"${t}"`).join(', ')}`
            )

            // Step 2: Expand each topic into related sub-queries
            const expandedSearches: { topic: string; queries: string[] }[] = []

            for (const topic of baseTopics) {
                const related = await this.expandTopic(queryCore, topic, langCode)
                expandedSearches.push({ topic, queries: related })

                this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Expanded "${topic}" -> ${related.length} sub-queries`)
            }

            const totalSearches = expandedSearches.reduce((sum, e) => sum + 1 + e.queries.length, 0)
            this.bot.logger.info(isMobile, 'STAR-SEARCH', `Total STAR searches: ${totalSearches}`)

            // Navigate to Bing
            await page.goto(this.bingHome)
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
            await this.bot.browser.utils.tryDismissAllMessages(page)

            // Step 3: Execute searches topic by topic
            let completedSearches = 0

            for (const { topic, queries } of expandedSearches) {
                this.bot.logger.info(isMobile, 'STAR-SEARCH', `Topic: "${topic}" | sub-queries=${queries.length}`)

                // Search the base topic first
                await this.executeSearch(page, topic, isMobile)
                completedSearches++

                // Then search expanded sub-queries
                for (const query of queries) {
                    await this.executeSearch(page, query, isMobile)
                    completedSearches++
                }

                this.bot.logger.info(
                    isMobile,
                    'STAR-SEARCH',
                    `Topic "${topic}" done | progress=${completedSearches}/${totalSearches}`
                )

                // Random pause between topics
                const topicPause = this.bot.utils.randomDelay(2000, 5000)
                await this.bot.utils.wait(topicPause)
            }

            this.bot.logger.info(
                isMobile,
                'STAR-SEARCH',
                `STAR Search completed | topics=${baseTopics.length} | totalSearches=${completedSearches}`,
                'green'
            )
        } catch (error) {
            this.bot.logger.error(isMobile, 'STAR-SEARCH', `Error: ${errMsg(error)}`)
        }
    }

    /**
     * Expand a single topic into related sub-queries using Bing suggestions + related terms.
     * Produces queries of varying lengths for a natural search pattern.
     */
    private async expandTopic(queryCore: QueryCore, topic: string, langCode: string): Promise<string[]> {
        try {
            const [suggestions, related] = await Promise.all([
                queryCore.getBingSuggestions(topic, langCode).catch(() => []),
                queryCore.getBingRelatedTerms(topic).catch(() => [])
            ])

            const candidates = [...suggestions.slice(0, 4), ...related.slice(0, 3)]

            const seen = new Set<string>()
            seen.add(topic.toLowerCase().trim())

            const expanded: string[] = []
            for (const q of candidates) {
                const norm = q.trim().toLowerCase()
                if (!norm || seen.has(norm)) continue
                seen.add(norm)
                expanded.push(q.trim())
            }

            // Randomize count: between 3 and 7 sub-queries per topic
            const limit = this.bot.utils.randomNumber(3, 7)
            return this.bot.utils.shuffleArray(expanded).slice(0, limit)
        } catch {
            return []
        }
    }

    /**
     * Execute a single Bing search with random scroll/click behavior.
     */
    private async executeSearch(page: Page, query: string, isMobile: boolean): Promise<void> {
        const refreshThreshold = 10
        this.searchCount++

        try {
            // Refresh page periodically to avoid sluggishness
            if (this.searchCount % refreshThreshold === 0) {
                const cvid = randomBytes(16).toString('hex')
                const url = `${this.bingHome}/search?q=${encodeURIComponent(query)}&PC=U531&FORM=ANNTA1&cvid=${cvid}`
                await page.goto(url)
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
                await this.bot.browser.utils.tryDismissAllMessages(page)
            }

            const searchBar = '#sb_form_q'
            const searchBox = page.locator(searchBar)

            await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: 'auto' }))
            await page.keyboard.press('Home')
            await searchBox.waitFor({ state: 'visible', timeout: 15000 })

            await this.bot.utils.wait(1000)
            await this.bot.browser.utils.ghostClick(page, searchBar, { clickCount: 3 })
            await searchBox.fill('')

            await page.keyboard.type(query, { delay: 50 })
            await page.keyboard.press('Enter')

            this.bot.logger.info(isMobile, 'STAR-SEARCH', `Searched: "${query}"`)

            await this.bot.utils.wait(3000)

            // Random scroll (50% chance even if disabled in config)
            if (this.bot.config.searchSettings.scrollRandomResults || Math.random() < 0.5) {
                await this.bot.utils.wait(2000)
                await this.randomScroll(page, isMobile)
            }

            // Random click on result (30% chance even if disabled in config)
            if (this.bot.config.searchSettings.clickRandomResults || Math.random() < 0.3) {
                await this.bot.utils.wait(2000)
                await this.clickRandomLink(page, isMobile)
            }

            // Random delay between searches (same as point searches)
            await this.bot.utils.wait(
                this.bot.utils.randomDelay(
                    this.bot.config.searchSettings.searchDelay.min,
                    this.bot.config.searchSettings.searchDelay.max
                )
            )
        } catch (error) {
            this.bot.logger.warn(isMobile, 'STAR-SEARCH', `Search failed for "${query}": ${errMsg(error)}`)
        }
    }

    private async randomScroll(page: Page, isMobile: boolean): Promise<void> {
        try {
            const viewportHeight = await page.evaluate(() => window.innerHeight)
            const totalHeight = await page.evaluate(() => document.body.scrollHeight)
            const scrollPos = Math.floor(Math.random() * (totalHeight - viewportHeight))

            await page.evaluate((pos: number) => window.scrollTo({ left: 0, top: pos, behavior: 'auto' }), scrollPos)
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Scroll error: ${errMsg(error)}`)
        }
    }

    private async clickRandomLink(page: Page, isMobile: boolean): Promise<void> {
        try {
            const searchPageUrl = page.url()

            await this.bot.browser.utils.ghostClick(page, '#b_results .b_algo h2')
            await this.bot.utils.wait(this.bot.config.searchSettings.searchResultVisitTime)

            if (isMobile) {
                await page.goto(searchPageUrl)
            } else {
                const newTab = await this.bot.browser.utils.getLatestTab(page)
                await this.bot.browser.utils.closeTabs(newTab)
            }
        } catch (error) {
            this.bot.logger.debug(isMobile, 'STAR-SEARCH', `Click error: ${errMsg(error)}`)
        }
    }
}
