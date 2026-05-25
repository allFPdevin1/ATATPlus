import type { Page } from 'patchright'
import type { MicrosoftRewardsBot } from '../index'
import { errMsg } from '../util/Utils'

/**
 * ModernUIWorkers handles the new Microsoft Rewards UI (April 2026+)
 *
 * Dashboard (/dashboard) sections:
 *   - "Your progress": expand (green) → shows streak/bonus info
 *   - "Daily set": expand → click each card to earn points
 *   - "Your activity": do NOT expand (no earnable points)
 *   - "Achievements": do NOT expand (no earnable points)
 *
 * Earn (/earn) sections:
 *   - "Keep earning": click each card WITH points badge (+5, +10, etc.)
 *   - Skip cards with "Silver level required" or no points badge
 *   - MUST click the card element (not visit URL) to trigger tracking
 *
 * DOM structure (April 2026):
 *   - Card title: <p class="text-globalBody2Strong">
 *   - Points badge: <p class="text-statusInformativeTintFg"> containing "+5", "+10"
 *   - Locked indicator: text "Silver level required" or lock icon
 *   - Expand button: button[slot="trigger"] or button[aria-expanded]
 */

interface CardInfo {
    index: number
    title: string
    points: string
    completed?: boolean
    href?: string
}

export class ModernUIWorkers {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    private async closeAllExtraTabs(page: Page): Promise<void> {
        try {
            const context = page.context()
            const pages = context.pages()

            if (pages.length <= 1) return

            for (const p of pages) {
                if (p !== page) {
                    await p.close().catch(() => {})
                }
            }

            if (pages.length > 1) {
                this.bot.logger.debug(this.bot.isMobile, 'MODERN-UI', `Closed ${pages.length - 1} extra tab(s)`)
            }
        } catch (error) {
            this.bot.logger.debug(this.bot.isMobile, 'MODERN-UI', `Error closing extra tabs: ${errMsg(error)}`)
        }
    }

    async expandDashboardSection(page: Page, sectionHeading: string): Promise<boolean> {
        try {
            const expanded = await page.evaluate((heading: string) => {
                const headings = document.querySelectorAll('h2, h3')
                for (const h of headings) {
                    if (h.textContent?.trim()?.startsWith(heading)) {
                        const section = h.closest('section') || h.parentElement?.parentElement
                        if (!section) continue

                        const btn =
                            section.querySelector('button[aria-expanded]') ||
                            section.querySelector('button[slot="trigger"]') ||
                            section.querySelector(`button[aria-label="${heading}"]`)

                        if (btn) {
                            const state = btn.getAttribute('aria-expanded')
                            if (state === 'false') {
                                ;(btn as HTMLElement).click()
                                return 'expanded'
                            }
                            return 'already-expanded'
                        }
                    }
                }
                return 'not-found'
            }, sectionHeading)

            if (expanded === 'expanded') {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-UI', `Expanded section: "${sectionHeading}"`)
                await this.bot.utils.wait(1500)
                return true
            } else if (expanded === 'already-expanded') {
                this.bot.logger.debug(this.bot.isMobile, 'MODERN-UI', `Section already expanded: "${sectionHeading}"`)
                return true
            }

            this.bot.logger.warn(this.bot.isMobile, 'MODERN-UI', `Section not found: "${sectionHeading}"`)
            return false
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'MODERN-UI',
                `Error expanding "${sectionHeading}": ${errMsg(error)}`
            )
            return false
        }
    }

    /**
     * Scroll to and click a card inside a section, handle new tab, close extras.
     * Shared by doDailySet, doKeepEarning, and their verification retries.
     */
    private async clickCardInSection(page: Page, sectionHeading: string, card: CardInfo, tag: string): Promise<void> {
        await this.closeAllExtraTabs(page)

        // Scroll to card
        await page.evaluate(
            ({ heading, cardIndex }: { heading: string; cardIndex: number }) => {
                const headings = document.querySelectorAll('h2, h3')
                for (const h of headings) {
                    if (h.textContent?.trim()?.startsWith(heading)) {
                        const section = h.closest('section') || h.parentElement?.parentElement
                        if (section) {
                            const target = section.querySelectorAll('a[target="_blank"]')[cardIndex] as HTMLElement
                            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                        }
                        break
                    }
                }
            },
            { heading: sectionHeading, cardIndex: card.index }
        )

        await this.bot.utils.wait(1000)

        // Click card
        await page.evaluate(
            ({ heading, cardIndex }: { heading: string; cardIndex: number }) => {
                const headings = document.querySelectorAll('h2, h3')
                for (const h of headings) {
                    if (h.textContent?.trim()?.startsWith(heading)) {
                        const section = h.closest('section') || h.parentElement?.parentElement
                        if (section) {
                            const target = section.querySelectorAll('a[target="_blank"]')[
                                cardIndex
                            ] as HTMLAnchorElement
                            if (target) target.click()
                        }
                        break
                    }
                }
            },
            { heading: sectionHeading, cardIndex: card.index }
        )

        this.bot.logger.info(this.bot.isMobile, tag, `✔ Clicked: "${card.title}" (${card.points})`, 'green')

        await this.bot.utils.wait(3000)

        const newTab = await this.bot.browser.utils.getLatestTab(page)
        if (newTab !== page) {
            await newTab.waitForLoadState('domcontentloaded').catch(() => {})
            await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 6000))
        }

        await this.closeAllExtraTabs(page)
        await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
    }

    /**
     * Process a list of cards: click each, handle errors, close tabs on failure.
     */
    private async processCards(page: Page, cards: CardInfo[], sectionHeading: string, tag: string): Promise<void> {
        for (const card of cards) {
            try {
                await this.clickCardInSection(page, sectionHeading, card, tag)
            } catch (error) {
                this.bot.logger.error(this.bot.isMobile, tag, `Error on "${card.title}": ${errMsg(error)}`)
                await this.closeAllExtraTabs(page)
            }
        }
    }

    /**
     * Navigate to a page, wait for content, dismiss messages.
     */
    private async navigateAndPrepare(page: Page, url: string): Promise<void> {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await this.bot.utils.wait(3000)
        await this.bot.browser.utils.tryDismissAllMessages(page)
    }

    /**
     * Complete Daily Set tasks on /dashboard
     */
    async doDailySet(page: Page): Promise<void> {
        this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'Starting Daily Set (Modern UI)')

        try {
            await this.navigateAndPrepare(page, 'https://rewards.bing.com/dashboard')

            await this.expandDashboardSection(page, 'Your progress')

            const expanded = await this.expandDashboardSection(page, 'Daily set')
            if (!expanded) {
                this.bot.logger.warn(this.bot.isMobile, 'MODERN-DAILY-SET', 'Could not expand Daily Set section')
                return
            }

            await this.bot.utils.wait(2000)

            const cards = await this.findDailySetCards(page)
            const uncompletedCards = cards.filter(c => !c.completed && c.points)

            this.bot.logger.info(
                this.bot.isMobile,
                'MODERN-DAILY-SET',
                `Found ${cards.length} cards, ${uncompletedCards.length} uncompleted with points`
            )

            if (!uncompletedCards.length) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'All Daily Set items already completed')
                return
            }

            await this.processCards(page, uncompletedCards, 'Daily set', 'MODERN-DAILY-SET')

            await this.verifyAndRetry(page, 'Daily set', 'MODERN-DAILY-SET', 'https://rewards.bing.com/dashboard', () =>
                this.findDailySetCards(page).then(c => c.filter(x => !x.completed && x.points))
            )

            this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'Daily Set completed')
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-DAILY-SET', `Error: ${errMsg(error)}`)
            await this.closeAllExtraTabs(page)
        }
    }

    private async findDailySetCards(page: Page): Promise<CardInfo[]> {
        return await page.evaluate(() => {
            const result: { index: number; title: string; points: string; completed: boolean }[] = []
            const headings = document.querySelectorAll('h2, h3')

            for (const h of headings) {
                if (h.textContent?.trim()?.startsWith('Daily set')) {
                    const section = h.closest('section') || h.parentElement?.parentElement
                    if (!section) continue

                    const cardLinks = section.querySelectorAll('a[target="_blank"]')
                    cardLinks.forEach((card, i) => {
                        const anchor = card as HTMLAnchorElement
                        const fullText = anchor.textContent?.trim() || ''

                        const titleEl = anchor.querySelector('p[class*="Body2Strong"], p[class*="body2Strong"]')
                        const title = titleEl?.textContent?.trim() || fullText.substring(0, 60)

                        let points = ''
                        anchor.querySelectorAll('span, div, p').forEach(el => {
                            const text = el.textContent?.trim() || ''
                            if (/^\+\d+$/.test(text)) points = text
                        })

                        const isCompleted =
                            fullText.includes('Completed') ||
                            !!anchor.querySelector('[class*="statusSuccessRewards"], [class*="StatusSuccess"]')

                        result.push({ index: i, title, points, completed: isCompleted })
                    })
                    break
                }
            }
            return result
        })
    }

    /**
     * Generic verify-and-retry: reload page, re-expand section, find remaining cards, retry.
     */
    private async verifyAndRetry(
        page: Page,
        sectionHeading: string,
        tag: string,
        url: string,
        findRemaining: () => Promise<CardInfo[]>
    ): Promise<void> {
        try {
            this.bot.logger.info(this.bot.isMobile, tag, `Verifying ${sectionHeading} completion...`)

            await this.closeAllExtraTabs(page)
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
            await this.bot.utils.wait(3000)

            if (sectionHeading === 'Daily set') {
                await this.expandDashboardSection(page, sectionHeading)
                await this.bot.utils.wait(2000)
            } else {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
                await this.bot.utils.wait(2000)
                await page.evaluate(() => window.scrollTo(0, 0))
                await this.bot.utils.wait(1000)
            }

            const remaining = await findRemaining()

            if (remaining.length === 0) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    tag,
                    `✔ Verification passed: All ${sectionHeading} tasks completed`,
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    tag,
                    `Verification: ${remaining.length} task(s) still remaining: ${remaining.map(c => `${c.title}(${c.points})`).join(', ')}`
                )

                for (const card of remaining) {
                    try {
                        await this.clickCardInSection(page, sectionHeading, card, tag)
                        this.bot.logger.info(
                            this.bot.isMobile,
                            tag,
                            `✔ Retry clicked: "${card.title}" (${card.points})`,
                            'green'
                        )
                    } catch (error) {
                        this.bot.logger.error(
                            this.bot.isMobile,
                            tag,
                            `Retry error on "${card.title}": ${errMsg(error)}`
                        )
                        await this.closeAllExtraTabs(page)
                    }
                }
            }
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, tag, `Verification error: ${errMsg(error)}`)
        }
    }

    /**
     * Complete "Keep earning" tasks on /earn
     */
    async doKeepEarning(page: Page): Promise<void> {
        this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'Starting Keep Earning (Modern UI)')

        try {
            await this.navigateAndPrepare(page, 'https://rewards.bing.com/earn')

            // Scroll to load lazy content
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            await this.bot.utils.wait(2000)
            await page.evaluate(() => window.scrollTo(0, 0))
            await this.bot.utils.wait(1000)

            const earnableCards = await this.findKeepEarningCards(page)

            this.bot.logger.info(
                this.bot.isMobile,
                'MODERN-KEEP-EARNING',
                `Found ${earnableCards.length} earnable card(s)`
            )

            if (!earnableCards.length) {
                this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'No earnable cards found')
                return
            }

            await this.processCards(page, earnableCards, 'Keep earning', 'MODERN-KEEP-EARNING')

            await this.verifyAndRetry(
                page,
                'Keep earning',
                'MODERN-KEEP-EARNING',
                'https://rewards.bing.com/earn',
                () => this.findKeepEarningCards(page)
            )

            this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'Keep Earning completed')
        } catch (error) {
            this.bot.logger.error(this.bot.isMobile, 'MODERN-KEEP-EARNING', `Error: ${errMsg(error)}`)
            await this.closeAllExtraTabs(page)
        }
    }

    private async findKeepEarningCards(page: Page): Promise<CardInfo[]> {
        return await page.evaluate(() => {
            const result: { index: number; title: string; points: string; href: string }[] = []

            const headings = document.querySelectorAll('h2, h3')
            let keepEarningSection: Element | null = null

            for (const h of headings) {
                if (h.textContent?.trim()?.startsWith('Keep earning')) {
                    keepEarningSection = h.closest('section') || h.parentElement?.parentElement || null
                    break
                }
            }

            if (!keepEarningSection) return result

            const allCards = keepEarningSection.querySelectorAll('a[target="_blank"]')

            allCards.forEach((card, i) => {
                const anchor = card as HTMLAnchorElement
                const fullText = anchor.textContent?.trim() || ''

                if (fullText.includes('Completed')) return
                if (anchor.querySelector('[class*="statusSuccessRewards"], [class*="StatusSuccess"]')) return
                if (fullText.includes('level required') || fullText.includes('locked')) return

                // Method 1: Badge-style points (+5, +10, +15, +20)
                let pointsText = ''
                anchor.querySelectorAll('span, div, p').forEach(el => {
                    const text = el.textContent?.trim() || ''
                    if (/^\+\d+$/.test(text)) pointsText = text
                })

                // Method 2: Description-style points ("earn 30 points", "pick up 20 points")
                if (!pointsText) {
                    const descEl = anchor.querySelector('p[class*="Secondary"], p[class*="secondary"]')
                    const descText = descEl?.textContent?.trim() || fullText
                    const descMatch = descText.match(
                        /(?:earn|pick\s*up|get|collect)\s+(\d+)\s+(?:bonus\s+)?(?:Rewards\s+)?points?/i
                    )
                    if (descMatch) {
                        pointsText = `+${descMatch[1]}`
                    }
                }

                // Method 3: Fallback - any "N points" pattern
                if (!pointsText) {
                    const match = fullText.match(/(\d+)\s+points?\b/i)
                    if (match && match[1] && parseInt(match[1]) > 0 && parseInt(match[1]) <= 500) {
                        if (!fullText.includes('lifetime points')) {
                            pointsText = `+${match[1]}`
                        }
                    }
                }

                if (!pointsText) return

                const titleEl = anchor.querySelector('p[class*="Body2Strong"], p[class*="body2Strong"]')
                const title = titleEl?.textContent?.trim()?.substring(0, 60) || ''
                const fallbackTitle = title || fullText.replace(pointsText, '').trim().substring(0, 60)

                result.push({
                    index: i,
                    title: fallbackTitle,
                    points: pointsText,
                    href: anchor.href
                })
            })

            return result
        })
    }
}
