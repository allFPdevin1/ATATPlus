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
            const cards = await page.evaluate(() => {
                const result: { index: number; title: string; points: string; completed: boolean }[] = []
                const headings = document.querySelectorAll('h2, h3')

                for (const h of headings) {
                    if (h.textContent?.trim()?.startsWith('Daily set')) {
                        const section = h.closest('section') || h.parentElement?.parentElement
                        if (!section) continue

                        const cardLinks = section.querySelectorAll('a[target="_blank"]')
                        cardLinks.forEach((card, i) => {
                            const anchor = card as HTMLAnchorElement

                            // Title: p.text-globalBody2Strong or fallback to textContent
                            const titleEl = anchor.querySelector('p[class*="Body2Strong"], p[class*="body2Strong"]')
                            const title = titleEl?.textContent?.trim() || anchor.textContent?.trim()?.substring(0, 60) || ''

                            // Points: look for +N pattern in any child element
                            let points = ''
                            anchor.querySelectorAll('span, div, p').forEach(el => {
                                const text = el.textContent?.trim() || ''
                                if (/^\+\d+$/.test(text)) points = text
                            })

                            // Completed check: look for checkmark or "complete" indicators
                            const isCompleted = !!anchor.querySelector('[class*="check"], [class*="Check"], [class*="complete"]')

                            result.push({ index: i, title, points, completed: isCompleted })
                        })
                        break
                    }
                }
                return result
            })

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
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'MODERN-DAILY-SET',
                        `Clicking: "${card.title}" (${card.points})`
                    )

                    // IMPORTANT: Must CLICK the card element to trigger tracking
                    const clicked = await page.evaluate((cardIndex: number) => {
                        const headings = document.querySelectorAll('h2, h3')
                        for (const h of headings) {
                            if (h.textContent?.trim()?.startsWith('Daily set')) {
                                const section = h.closest('section') || h.parentElement?.parentElement
                                if (section) {
                                    const cardLinks = section.querySelectorAll('a[target="_blank"]')
                                    const target = cardLinks[cardIndex] as HTMLAnchorElement
                                    if (target) {
                                        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                        return true
                                    }
                                }
                            }
                        }
                        return false
                    }, card.index)

                    if (!clicked) continue

                    await this.bot.utils.wait(1000)

                    // Perform the actual click
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

                    // Wait for new tab
                    await this.bot.utils.wait(3000)

                    // Handle opened tab
                    const newTab = await this.bot.browser.utils.getLatestTab(page)
                    if (newTab !== page) {
                        await newTab.waitForLoadState('domcontentloaded').catch(() => { })
                        await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 6000))
                        await newTab.close().catch(() => { })
                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'MODERN-DAILY-SET',
                            `Completed: "${card.title}"`
                        )
                    }

                    // Cooldown
                    await this.bot.utils.wait(this.bot.utils.randomDelay(2000, 5000))
                } catch (error) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'MODERN-DAILY-SET',
                        `Error on "${card.title}": ${error instanceof Error ? error.message : String(error)}`
                    )
                }
            }

            this.bot.logger.info(this.bot.isMobile, 'MODERN-DAILY-SET', 'Daily Set completed')
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'MODERN-DAILY-SET',
                `Error: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    /**
     * Complete "Keep earning" tasks on /earn
     * 
     * Rules from user's screenshots:
     * - Only click cards with visible point badges (+5, +10, +15, etc.)
     * - Skip cards without points (no earnable points)
     * - Skip cards with "Silver level required" (locked)
     * - MUST click card element to trigger tracking (not just visit URL)
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
            const earnableCards = await page.evaluate(() => {
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

                    // Skip locked cards (Silver level required, etc.)
                    if (fullText.includes('level required') || fullText.includes('locked')) return

                    // Find points badge: +N pattern
                    let pointsText = ''
                    anchor.querySelectorAll('span, div, p').forEach(el => {
                        const text = el.textContent?.trim() || ''
                        if (/^\+\d+$/.test(text)) pointsText = text
                    })

                    // Only earnable cards
                    if (!pointsText) return

                    // Title: p.text-globalBody2Strong or first meaningful text
                    const titleEl = anchor.querySelector('p[class*="Body2Strong"], p[class*="body2Strong"]')
                    const title = titleEl?.textContent?.trim()?.substring(0, 60) || ''

                    // Fallback title: get from the card's text, excluding points
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
                    this.bot.logger.info(
                        this.bot.isMobile,
                        'MODERN-KEEP-EARNING',
                        `Clicking: "${card.title}" (${card.points})`
                    )

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

                    // Handle new tab
                    await this.bot.utils.wait(3000)
                    const newTab = await this.bot.browser.utils.getLatestTab(page)
                    if (newTab !== page) {
                        await newTab.waitForLoadState('domcontentloaded').catch(() => { })
                        await this.bot.utils.wait(this.bot.utils.randomDelay(4000, 8000))
                        await newTab.close().catch(() => { })
                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'MODERN-KEEP-EARNING',
                            `Completed: "${card.title}"`
                        )
                    }

                    // Cooldown
                    await this.bot.utils.wait(this.bot.utils.randomDelay(3000, 7000))
                } catch (error) {
                    this.bot.logger.error(
                        this.bot.isMobile,
                        'MODERN-KEEP-EARNING',
                        `Error on "${card.title}": ${error instanceof Error ? error.message : String(error)}`
                    )
                }
            }

            this.bot.logger.info(this.bot.isMobile, 'MODERN-KEEP-EARNING', 'Keep Earning completed')
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'MODERN-KEEP-EARNING',
                `Error: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }
}
