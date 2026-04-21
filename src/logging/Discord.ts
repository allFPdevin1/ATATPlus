import axios, { AxiosRequestConfig } from 'axios'
import PQueue from 'p-queue'
import type { LogLevel } from './Logger'

const DISCORD_LIMIT = 2000

export interface DiscordConfig {
    enabled?: boolean
    url: string
}

const discordQueue = new PQueue({
    interval: 1000,
    intervalCap: 2,
    carryoverConcurrencyCount: true
})

function truncate(text: string) {
    return text.length <= DISCORD_LIMIT ? text : text.slice(0, DISCORD_LIMIT - 14) + ' …(truncated)'
}

export async function sendDiscord(discordUrl: string, content: string, level: LogLevel): Promise<void> {
    if (!discordUrl) return

    const request: AxiosRequestConfig = {
        method: 'POST',
        url: discordUrl,
        headers: { 'Content-Type': 'application/json' },
        data: { content: truncate(content), allowed_mentions: { parse: [] } },
        timeout: 10000
    }

    await discordQueue.add(async () => {
        try {
            await axios(request)
        } catch (err: any) {
            const status = err?.response?.status
            if (status === 429) return
        }
    })
}

export interface AccountSummary {
    email: string
    initialPoints: number
    finalPoints: number
    collectedPoints: number
    duration: number
    success: boolean
    error?: string
}

/**
 * Send a beautiful Discord embed summary after all accounts are processed.
 * This replaces spamming individual logs with a single clean summary message.
 */
export async function sendDiscordSummary(
    discordUrl: string,
    accounts: AccountSummary[],
    totalDurationMinutes: string,
    errorCount: number,
    warningCount: number
): Promise<void> {
    if (!discordUrl || accounts.length === 0) return

    const now = new Date()
    const dateStr = now.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

    const totalCollected = accounts.reduce((sum, a) => sum + a.collectedPoints, 0)
    const totalFinal = accounts.reduce((sum, a) => sum + a.finalPoints, 0)
    const successCount = accounts.filter(a => a.success).length
    const failCount = accounts.filter(a => !a.success).length

    // Build account lines
    const accountLines = accounts.map(a => {
        const emailShort = maskEmail(a.email)
        const pointsSign = a.collectedPoints >= 0 ? '+' : ''

        if (a.success) {
            return `✅ \`${emailShort}\` — **${pointsSign}${a.collectedPoints}** pts → Total: **${a.finalPoints.toLocaleString()}** _(${a.duration}s)_`
        } else {
            return `❌ \`${emailShort}\` — **Failed** ${a.error ? `(${a.error.substring(0, 50)})` : ''}`
        }
    })

    // Status emoji
    const statusEmoji = failCount === 0 ? '🟢' : failCount < accounts.length ? '🟡' : '🔴'

    const embed = {
        embeds: [
            {
                title: `${statusEmoji} AutoRewardPlus — Daily Report`,
                color: failCount === 0 ? 0x00d26a : failCount < accounts.length ? 0xffc107 : 0xff4444,
                description: accountLines.join('\n'),
                fields: [
                    {
                        name: '📊 Summary',
                        value: [
                            `**Total Earned:** +${totalCollected} pts`,
                            `**All Points:** ${totalFinal.toLocaleString()} pts`,
                            `**Accounts:** ${successCount}/${accounts.length} success`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '⏱️ Runtime',
                        value: [
                            `**Duration:** ${totalDurationMinutes} min`,
                            `**Errors:** ${errorCount}`,
                            `**Warnings:** ${warningCount}`
                        ].join('\n'),
                        inline: true
                    }
                ],
                footer: {
                    text: `AutoRewardPlus • ${dateStr} ${timeStr}`
                },
                timestamp: now.toISOString()
            }
        ],
        allowed_mentions: { parse: [] }
    }

    await discordQueue.add(async () => {
        try {
            await axios({
                method: 'POST',
                url: discordUrl,
                headers: { 'Content-Type': 'application/json' },
                data: embed,
                timeout: 15000
            })
        } catch (err: any) {
            // Silent fail - don't crash on webhook error
            console.error(`[Discord Summary] Failed to send: ${err?.message || err}`)
        }
    })
}

/**
 * Mask email for privacy: "knowme314@gmail.com" → "kno***14@gm...com"
 */
function maskEmail(email: string): string {
    const [local, domain] = email.split('@')
    if (!local || !domain) return email

    const maskedLocal = local.length <= 4
        ? local[0] + '***'
        : local.substring(0, 3) + '***' + local.substring(local.length - 2)

    const domainParts = domain.split('.')
    const maskedDomain = domainParts[0]!.substring(0, 2) + '...' + domainParts[domainParts.length - 1]

    return `${maskedLocal}@${maskedDomain}`
}

export async function flushDiscordQueue(timeoutMs = 5000): Promise<void> {
    await Promise.race([
        (async () => {
            await discordQueue.onIdle()
        })(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('discord flush timeout')), timeoutMs))
    ]).catch(() => {})
}
