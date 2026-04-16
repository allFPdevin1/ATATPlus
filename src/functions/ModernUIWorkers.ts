import type { Page } from 'patchright'
import type { MicrosoftRewardsBot } from '../index'

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
export class ModernUIWorkers {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    /**
     * Close ALL tabs except the main page tab.
     * Prevents tab accumulation from misclicks or unexpected navigations.
     */
    private async closeAllExtraTabs(page: Page): Promise<void> {
        try {
            const context = page.context()
            const pages = context.pages()

            if (pages.length <= 1) return

            for (const p of pages) {
                if (p !== page) {
                    await p.close().catch(() => { })
                }
            }

            if (pages.length > 1) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'MODERN-UI',
                    `Closed ${pages.length - 1} extra tab(s)`
                )
            }
        } catch (error) {
            this.bot.logger.debug(
                this.bot.isMobile,
                'MODERN-UI',
                `Error closing extra tabs: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    /**
     * Expand a collapsible section on the dashboard page
     * Uses button[slot="trigger"] or button[aria-expanded]
     */
    async expandDashboardSection(page: Page, sectionHeading: string): Promise<boolean> {
        try {
            const expanded = await page.evaluate((heading: string) => {
                const headings = document.querySelectorAll('h2, h3')
                for (const h of headings) {
                    if (h.textContent?.trim()?.startsWith(heading)) {
                        const section = h.closest('section') || h.parentElement?.parentElement
                        if (!section) continue

                        // Try multiple button selectors
                        const btn = section.querySelector('button[aria-expanded]') ||
                            section.querySelector('button[slot="trigger"]') ||
                            section.querySelector(`button[aria-label="${heading}"]`)

                        if (btn) {
                            const state = btn.getAttribute('aria-expanded')
                            if (state === 'false') {
                                (btn as HTMLElement).click()
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
                `Error expanding "${sectionHeading}": ${error instanceof Error ? error.message : String(error)}`
            )
            return false
        }
    }

    /**
     * Complete Daily Set tasks on /dashboard
     * 1. Navigate to dashboard
     * 2. Expand "Your progress" (for streak info display)
     * 3. Expand "Daily set" section
     * 4. CLICK each card (not just visit URL) to trigger completion tracking
     * 5. Close ALL extra tabs after each click
     * 6. Verify completion by reloading the page
     */
    async doDailySet(page: Page): Promise<void> {
        this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'Starting Daily Set (Modern UI)')

        try {
            // Navigate to dashboard
            await page.goto('https://rewards.bing.com/dashboard', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            })
            await this.bot.utils.wait(3000)
            await this.bot.browser.utils.tryDismissAllMessages(page)

            // Expand "Your progress" (green box = correct to expand)
            await this.expandDashboardSection(page, 'Your progress')

            // Expand "Daily set" section
            const expanded = await this.expandDashboardSection(page, 'Daily set')
            if (!expanded) {
                this.bot.logger.warn(this.bot.isMobile, 'MODERN-DAILY-SET', 'Could not expand Daily Set section')
                return
            }

            // DO NOT expand "Your activity" or "Achievements" - no earnable points

            await this.bot.utils.wait(2000)

            // Find Daily Set cards with their titles and points
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

            // Click each uncompleted card
            for (const card of uncompletedCards) {
                try {
                    // Close any stale extra tabs before clicking
                    await this.closeAllExtraTabs(page)

                    // Scroll to card
                    await page.evaluate((cardIndex: number) => {
                        const headings = document.querySelectorAll('h2, h3')
                        for (const h of headings) {
                            if (h.textContent?.trim()?.startsWith('Daily set')) {
                                const section = h.closest('section') || h.parentElement?.parentElement
                                if (section) {
                                    const cardLinks = section.querySelectorAll('a[target="_blank"]')
                                    const target = cardLinks[cardIndex] as HTMLAnchorElement
                                    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                }
                            }
                        }
                    }, card.index)

                    await this.bot.utils.wait(1000)

                    // CLICK the card element to trigger tracking
                    await page.evaluate((cardIndex: number) => {
                        const headings = document.querySelectorAll('h2, h3')
                        for (const h of headings) {
                            if (h.textContent?.trim()?.startsWith('Daily set')) {
                                const section = h.closest('section') || h.parentElement?.parentElement
                                if (section) {
                                    const cardLinks = section.querySelectorAll('a[target="_blank"]')
                                    const target = cardLinks[cardIndex] as HTMLAnchorElement
                                    if (target) target.click()
                                }
                            }
                        }
                    }, card.index)

                    this.bot.logger.info(
                        this.bot.isMobile,
                        'MODERN-DAILY-SET',
                        `✔ Clicked: "${card.title}" (${card.points})`,
                        'green'
                    )

                    // Wait for new tab(s) to open
                    await this.bot.utils.wait(3000)

                    // Wait for the latest tab to load, then close ALL extra tabs
                    const newTab = await this.bot.browser.utils.getLatestTab(page)
                    if (newTab !== page) {
                        await newTab.waitForLoadState('domcontentloaded').catch(() => { })
                        await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 6000))
                    }

                    // Close ALL extra tabs (not just the latest one)
                    await this.closeAllExtraTabs(page)

                    // Cooldown
                    await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
                } catch (error) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'MODERN-DAILY-SET',
                        `Error on "${card.title}": ${error instanceof Error ? error.message : String(error)}`
                    )
                    // Safety: close all extra tabs even on error
                    await this.closeAllExtraTabs(page)
                }
            }

            // === VERIFICATION: Reload and check if all tasks are done ===
            await this.verifyDailySet(page)

            this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'Daily Set completed')
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'MODERN-DAILY-SET',
                `Error: ${error instanceof Error ? error.message : String(error)}`
            )
            await this.closeAllExtraTabs(page)
        }
    }

    /**
     * Find Daily Set cards from the current page
     */
    private async findDailySetCards(page: Page) {
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

                        const isCompleted = fullText.includes('Completed') ||
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
     * Verify Daily Set completion by reloading the page and checking remaining tasks
     */
    private async verifyDailySet(page: Page): Promise<void> {
        try {
            this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'Verifying Daily Set completion...')

            // Close all extra tabs, reload dashboard
            await this.closeAllExtraTabs(page)
            await page.goto('https://rewards.bing.com/dashboard', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            })
            await this.bot.utils.wait(3000)

            // Re-expand Daily set
            await this.expandDashboardSection(page, 'Daily set')
            await this.bot.utils.wait(2000)

            const cards = await this.findDailySetCards(page)
            const remaining = cards.filter(c => !c.completed && c.points)

            if (remaining.length === 0) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'MODERN-DAILY-SET',
                    '✔ Verification passed: All Daily Set tasks completed',
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'MODERN-DAILY-SET',
                    `Verification: ${remaining.length} task(s) still remaining: ${remaining.map(c => c.title).join(', ')}`
                )

                // Retry remaining tasks
                for (const card of remaining) {
                    try {
                        await this.closeAllExtraTabs(page)

                        await page.evaluate((cardIndex: number) => {
                            const headings = document.querySelectorAll('h2, h3')
                            for (const h of headings) {
                                if (h.textContent?.trim()?.startsWith('Daily set')) {
                                    const section = h.closest('section') || h.parentElement?.parentElement
                                    if (section) {
                                        const cardLinks = section.querySelectorAll('a[target="_blank"]')
                                        const target = cardLinks[cardIndex] as HTMLAnchorElement
                                        if (target) {
                                            target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                            target.click()
                                        }
                                    }
                                }
                            }
                        }, card.index)

                        this.bot.logger.info(
                            this.bot.isMobile,
                            'MODERN-DAILY-SET',
                            `✔ Retry clicked: "${card.title}" (${card.points})`,
                            'green'
                        )

                        await this.bot.utils.wait(3000)
                        const newTab = await this.bot.browser.utils.getLatestTab(page)
                        if (newTab !== page) {
                            await newTab.waitForLoadState('domcontentloaded').catch(() => { })
                            await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 6000))
                        }
                        await this.closeAllExtraTabs(page)
                        await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
                    } catch (error) {
                        this.bot.logger.error(
                            this.bot.isMobile,
                            'MODERN-DAILY-SET',
                            `Retry error on "${card.title}": ${error instanceof Error ? error.message : String(error)}`
                        )
                        await this.closeAllExtraTabs(page)
                    }
                }
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'MODERN-DAILY-SET',
                `Verification error: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    /**
     * Complete "Keep earning" tasks on /earn
     * 
     * Rules:
     * - Only click cards with visible point badges (+5, +10, +15, etc.)
     * - Also detect description-style points ("earn N points", "pick up N points")
     * - Skip completed cards and locked cards ("Silver level required")
     * - MUST click card element to trigger tracking (not just visit URL)
     * - Close ALL extra tabs after each click (not just the latest)
     * - Verify completion by reloading the page after all cards are done
     */
    async doKeepEarning(page: Page): Promise<void> {
        this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'Starting Keep Earning (Modern UI)')

        try {
            // Navigate to earn page
            await page.goto('https://rewards.bing.com/earn', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            })
            await this.bot.utils.wait(3000)
            await this.bot.browser.utils.tryDismissAllMessages(page)

            // Scroll to load lazy content
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            await this.bot.utils.wait(2000)
            await page.evaluate(() => window.scrollTo(0, 0))
            await this.bot.utils.wait(1000)

            // Find earnable cards
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

            // Click each earnable card
            for (const card of earnableCards) {
                try {
                    // Close any stale extra tabs before clicking
                    await this.closeAllExtraTabs(page)

                    // Scroll to card
                    await page.evaluate((cardIndex: number) => {
                        const headings = document.querySelectorAll('h2, h3')
                        let keepEarningSection: Element | null = null
                        for (const h of headings) {
                            if (h.textContent?.trim()?.startsWith('Keep earning')) {
                                keepEarningSection = h.closest('section') || h.parentElement?.parentElement || null
                                break
                            }
                        }
                        if (!keepEarningSection) return
                        const cards = keepEarningSection.querySelectorAll('a[target="_blank"]')
                        const target = cards[cardIndex] as HTMLElement
                        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }, card.index)

                    await this.bot.utils.wait(1000)

                    // CLICK the card (trigger tracking)
                    await page.evaluate((cardIndex: number) => {
                        const headings = document.querySelectorAll('h2, h3')
                        let keepEarningSection: Element | null = null
                        for (const h of headings) {
                            if (h.textContent?.trim()?.startsWith('Keep earning')) {
                                keepEarningSection = h.closest('section') || h.parentElement?.parentElement || null
                                break
                            }
                        }
                        if (!keepEarningSection) return
                        const cards = keepEarningSection.querySelectorAll('a[target="_blank"]')
                        const target = cards[cardIndex] as HTMLAnchorElement
                        if (target) target.click()
                    }, card.index)

                    this.bot.logger.info(
                        this.bot.isMobile,
                        'MODERN-KEEP-EARNING',
                        `✔ Clicked: "${card.title}" (${card.points})`,
                        'green'
                    )

                    // Wait for new tab(s) to open
                    await this.bot.utils.wait(3000)

                    // Wait for the latest tab to load
                    const newTab = await this.bot.browser.utils.getLatestTab(page)
                    if (newTab !== page) {
                        await newTab.waitForLoadState('domcontentloaded').catch(() => { })
                        await this.bot.utils.wait(this.bot.utils.randomDelay(4000, 8000))
                    }

                    // Close ALL extra tabs (not just the latest one)
                    await this.closeAllExtraTabs(page)

                    // Cooldown
                    await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 7000))
                } catch (error) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'MODERN-KEEP-EARNING',
                        `Error on "${card.title}": ${error instanceof Error ? error.message : String(error)}`
                    )
                    // Safety: close all extra tabs even on error
                    await this.closeAllExtraTabs(page)
                }
            }

            // === VERIFICATION: Reload and check remaining earnable cards ===
            await this.verifyKeepEarning(page)

            this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'Keep Earning completed')
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'MODERN-KEEP-EARNING',
                `Error: ${error instanceof Error ? error.message : String(error)}`
            )
            await this.closeAllExtraTabs(page)
        }
    }

    /**
     * Find earnable cards in the "Keep earning" section
     * Detects 3 types of points:
     * 1. Badge-style: +5, +10, +15 (separate DOM element)
     * 2. Description-style: "earn N points", "pick up N points"
     * 3. Fallback: "N points" pattern anywhere in card text
     */
    private async findKeepEarningCards(page: Page) {
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

                // Skip completed cards
                if (fullText.includes('Completed')) return
                if (anchor.querySelector('[class*="statusSuccessRewards"], [class*="StatusSuccess"]')) return

                // Skip locked cards
                if (fullText.includes('level required') || fullText.includes('locked')) return

                // === POINTS DETECTION: 3 methods ===

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
                    const descMatch = descText.match(/(?:earn|pick\s*up|get|collect)\s+(\d+)\s+(?:bonus\s+)?(?:Rewards\s+)?points?/i)
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

                // Skip cards with no detectable points
                if (!pointsText) return

                // Title
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

    /**
     * Verify Keep Earning completion by reloading the page and checking remaining tasks
     */
    private async verifyKeepEarning(page: Page): Promise<void> {
        try {
            this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'Verifying Keep Earning completion...')

            // Close all extra tabs, reload earn page
            await this.closeAllExtraTabs(page)
            await page.goto('https://rewards.bing.com/earn', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            })
            await this.bot.utils.wait(3000)

            // Scroll to load lazy content
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
            await this.bot.utils.wait(2000)
            await page.evaluate(() => window.scrollTo(0, 0))
            await this.bot.utils.wait(1000)

            const remaining = await this.findKeepEarningCards(page)

            if (remaining.length === 0) {
                this.bot.logger.info(
                    this.bot.isMobile,
                    'MODERN-KEEP-EARNING',
                    '✔ Verification passed: All Keep Earning tasks completed',
                    'green'
                )
            } else {
                this.bot.logger.warn(
                    this.bot.isMobile,
                    'MODERN-KEEP-EARNING',
                    `Verification: ${remaining.length} task(s) still remaining: ${remaining.map(c => `${c.title}(${c.points})`).join(', ')}`
                )

                // Retry remaining tasks
                for (const card of remaining) {
                    try {
                        await this.closeAllExtraTabs(page)

                        await page.evaluate((cardIndex: number) => {
                            const headings = document.querySelectorAll('h2, h3')
                            let sec: Element | null = null
                            for (const h of headings) {
                                if (h.textContent?.trim()?.startsWith('Keep earning')) {
                                    sec = h.closest('section') || h.parentElement?.parentElement || null
                                    break
                                }
                            }
                            if (!sec) return
                            const cards = sec.querySelectorAll('a[target="_blank"]')
                            const target = cards[cardIndex] as HTMLAnchorElement
                            if (target) {
                                target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                target.click()
                            }
                        }, card.index)

                        this.bot.logger.info(
                            this.bot.isMobile,
                            'MODERN-KEEP-EARNING',
                            `✔ Retry clicked: "${card.title}" (${card.points})`,
                            'green'
                        )

                        await this.bot.utils.wait(3000)
                        const newTab = await this.bot.browser.utils.getLatestTab(page)
                        if (newTab !== page) {
                            await newTab.waitForLoadState('domcontentloaded').catch(() => { })
                            await this.bot.utils.wait(this.bot.utils.randomDelay(4000, 8000))
                        }
                        await this.closeAllExtraTabs(page)
                        await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 7000))
                    } catch (error) {
                        this.bot.logger.error(
                            this.bot.isMobile,
                            'MODERN-KEEP-EARNING',
                            `Retry error on "${card.title}": ${error instanceof Error ? error.message : String(error)}`
                        )
                        await this.closeAllExtraTabs(page)
                    }
                }
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'MODERN-KEEP-EARNING',
                `Verification error: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }
}
