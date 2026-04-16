# Microsoft-Rewards-Script Architecture

> **Version:** 3.1.4
> **Tech Stack:** TypeScript, Node.js >= 24, Playwright (patchright), Cheerio
> **License:** GPL-3.0-or-later

---

## Overview

Microsoft-Rewards-Script la mot automation tool tu dong thuc hien cac nhiem vu tren Microsoft Rewards de thu thap diem. Script ho tro:

- Tu dong login voi nhieu phuong thuc xac thuc (email/password, 2FA TOTP, passwordless, recovery email)
- Thuc hien Daily Set, More Promotions, Punch Cards, Special Promotions
- Tu dong search tren Bing (mobile + desktop) voi queries tu nhieu nguon
- Ho tro cluster mode xu ly nhieu account song song
- Fingerprint injection anti-detection
- Webhook notifications (Discord, ntfy)

---

## Project Structure

```
Microsoft-Rewards-Script/
├── src/
│   ├── index.ts                    # Main entry point, MicrosoftRewardsBot class
│   ├── browser/
│   │   ├── Browser.ts              # Browser factory voi fingerprint injection
│   │   ├── BrowserFunc.ts          # Dashboard API, points, cookies
│   │   ├── BrowserUtils.ts         # Utilities: click, scroll, dismiss messages
│   │   ├── UserAgent.ts            # User-agent management
│   │   └── auth/
│   │       ├── Login.ts            # Login state machine
│   │       └── methods/
│   │           ├── EmailLogin.ts
│   │           ├── PasswordlessLogin.ts
│   │           ├── Totp2FALogin.ts
│   │           ├── GetACodeLogin.ts
│   │           ├── RecoveryEmailLogin.ts
│   │           └── MobileAccessLogin.ts
│   ├── functions/
│   │   ├── Workers.ts              # Task orchestration
│   │   ├── Activities.ts           # Activity dispatcher
│   │   ├── SearchManager.ts        # Search coordination (mobile/desktop)
│   │   ├── QueryEngine.ts          # Query sources management
│   │   └── activities/
│   │       ├── api/
│   │       │   ├── Quiz.ts
│   │       │   ├── UrlReward.ts
│   │       │   ├── FindClippy.ts
│   │       │   └── DoubleSearchPoints.ts
│   │       ├── app/
│   │       │   ├── DailyCheckIn.ts
│   │       │   ├── ReadToEarn.ts
│   │       │   └── AppReward.ts
│   │       └── browser/
│   │           ├── Search.ts       # Bing search execution
│   │           └── SearchOnBing.ts # Explore on Bing activity
│   ├── interface/
│   │   ├── Config.ts               # Configuration types
│   │   ├── Account.ts              # Account types
│   │   ├── DashboardData.ts        # Dashboard API response types
│   │   ├── AppDashBoardData.ts     # Mobile app dashboard types
│   │   └── ...
│   ├── logging/
│   │   ├── Logger.ts               # Logging system
│   │   ├── Discord.ts              # Discord webhook
│   │   └── Ntfy.ts                 # Ntfy notifications
│   └── util/
│       ├── Load.ts                 # Config/accounts/session loading
│       ├── Utils.ts                # Helper functions
│       ├── Axios.ts                # HTTP client wrapper
│       └── Validator.ts            # Input validation
├── scripts/
│   ├── main/
│   │   ├── browserSession.js       # Open saved session
│   │   └── clearSessions.js        # Clear sessions
│   ├── docker/
│   │   ├── entrypoint.sh
│   │   └── run_daily.sh
│   └── nix/run.sh
├── package.json
├── tsconfig.json
└── Dockerfile
```

---

## Core Flow

### Main Execution Flow (src/index.ts)

```
┌─────────────────────────────────────────────────────────────────┐
│                        START                                    │
│                         │                                       │
│                         ▼                                       │
│              ┌─────────────────────┐                           │
│              │  Initialize Bot     │                           │
│              │  Load accounts.json │                           │
│              │  Load config.json   │                           │
│              └─────────────────────┘                           │
│                         │                                       │
│                         ▼                                       │
│              ┌─────────────────────┐                           │
│              │  Cluster Mode?      │                           │
│              │  (config.clusters)  │                           │
│              └─────────────────────┘                           │
│                    │         │                                  │
│               Yes  │         │ No                               │
│                    ▼         ▼                                  │
│         ┌──────────────┐  ┌──────────────┐                     │
│         │ Fork Workers │  │   Run Tasks  │                     │
│         │ (cluster)    │  │  (single)    │                     │
│         └──────────────┘  └──────────────┘                     │
│                    │         │                                  │
│                    └────┬────┘                                  │
│                         ▼                                       │
│              ┌─────────────────────┐                           │
│              │   For Each Account  │                           │
│              └─────────────────────┘                           │
│                         │                                       │
│                         ▼                                       │
│    ┌────────────────────────────────────────────┐              │
│    │                  Main()                     │              │
│    │  1. Create Mobile Browser                  │              │
│    │  2. Login                                  │              │
│    │  3. Get Access Token (App API)             │              │
│    │  4. Get Dashboard Data                     │              │
│    │  5. Get Earnable Points                    │              │
│    │  6. Execute Workers (see below)            │              │
│    │  7. Do Searches (mobile + desktop)         │              │
│    │  8. Return Points Collected                │              │
│    └────────────────────────────────────────────┘              │
│                         │                                       │
│                         ▼                                       │
│              ┌─────────────────────┐                           │
│              │   Flush Webhooks    │                           │
│              │   Exit              │                           │
│              └─────────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

### Workers Execution Order (src/index.ts:442-448)

```typescript
// Worker execution sequence
if (config.workers.doAppPromotions)    await workers.doAppPromotions(appData)
if (config.workers.doDailySet)         await workers.doDailySet(data, page)
if (config.workers.doSpecialPromotions) await workers.doSpecialPromotions(data)
if (config.workers.doMorePromotions)   await workers.doMorePromotions(data, page)
if (config.workers.doDailyCheckIn)     await activities.doDailyCheckIn()
if (config.workers.doReadToEarn)       await activities.doReadToEarn()
if (config.workers.doPunchCards)       await workers.doPunchCards(data, page)
// Then: Mobile & Desktop Searches
```

---

## Key Components

### 1. MicrosoftRewardsBot Class (src/index.ts)

Main orchestrator class:

```typescript
class MicrosoftRewardsBot {
    public logger: Logger
    public config: Config
    public userData: {
        userName: string
        geoLocale: string
        langCode: string
        initialPoints: number
        currentPoints: number
        gainedPoints: number
    }
    public rewardsVersion: 'legacy' | 'modern'  // UI version detection
    public accessToken: string                   // For mobile app API
    public requestToken: string                  // For legacy dashboard API

    // Browser pages
    public mainMobilePage: Page
    public mainDesktopPage: Page

    // Core methods
    async initialize(): Promise<void>
    async run(): Promise<void>
    async Main(account: Account): Promise<{ initialPoints, collectedPoints }>
}
```

### 2. Browser Factory (src/browser/Browser.ts)

Creates browser context with anti-detection:

```typescript
class Browser {
    // Anti-detection args
    static readonly BROWSER_ARGS = [
        '--no-sandbox',
        '--mute-audio',
        '--disable-blink-features=Attestation',
        '--disable-features=WebAuthentication,PasswordManager...',
        // ...
    ]

    async createBrowser(account: Account): Promise<{
        context: BrowserContext,
        fingerprint: BrowserFingerprintWithHeaders
    }> {
        // 1. Launch Chromium with proxy (if configured)
        // 2. Load saved session data (cookies, fingerprint)
        // 3. Generate fingerprint if not saved
        // 4. Inject fingerprint using fingerprint-injector
        // 5. Disable WebAuthn/Passkeys
        // 6. Set default timeout
        // 7. Add saved cookies
        // 8. Save fingerprint if configured
    }
}
```

### 3. Login State Machine (src/browser/auth/Login.ts)

Implements state machine pattern for login flow:

```typescript
type LoginState =
    | 'EMAIL_INPUT'
    | 'PASSWORD_INPUT'
    | 'SIGN_IN_ANOTHER_WAY'
    | 'SIGN_IN_ANOTHER_WAY_EMAIL'
    | 'PASSKEY_ERROR'
    | 'PASSKEY_VIDEO'
    | 'KMSI_PROMPT'
    | 'LOGGED_IN'
    | 'RECOVERY_EMAIL_INPUT'
    | 'ACCOUNT_LOCKED'
    | 'ERROR_ALERT'
    | '2FA_TOTP'
    | 'LOGIN_PASSWORDLESS'
    | 'GET_A_CODE'
    | 'GET_A_CODE_2'
    | 'OTP_CODE_ENTRY'
    | 'UNKNOWN'
    | 'CHROMEWEBDATA_ERROR'

// Main loop (max 25 iterations)
while (iteration < maxIterations) {
    const state = await detectCurrentState(page, account)
    const shouldContinue = await handleState(state, page, account)
    // ...
}
```

### 4. Search Manager (src/functions/SearchManager.ts)

Coordinates mobile and desktop searches:

```typescript
class SearchManager {
    async doSearches(): Promise<{ mobilePoints, desktopPoints }> {
        // Check if parallel or sequential mode
        if (useParallel) {
            return await this.doParallelSearches(...)
        } else {
            return await this.doSequentialSearches(...)
        }
    }

    // Parallel: Mobile + Desktop at same time
    private async doParallelSearches(): Promise<SearchResults>

    // Sequential: Mobile first, then Desktop
    private async doSequentialSearches(): Promise<SearchResults>
}
```

### 5. Query Engine (src/functions/QueryEngine.ts)

Manages search query sources:

```typescript
class QueryCore {
    async queryManager(options: {
        shuffle?: boolean
        sourceOrder?: QueryEngine[]  // ['google', 'wikipedia', 'reddit', 'local']
        related?: boolean
        langCode?: string
        geoLocale?: string
    }): Promise<string[]>

    // Query sources
    async getGoogleTrends(geoLocale: string): Promise<string[]>
    async getWikipediaTrending(langCode: string): Promise<string[]>
    async getRedditTopics(subreddit: string): Promise<string[]>
    getLocalQueryList(): string[]

    // Bing expansion
    async getBingSuggestions(query: string): Promise<string[]>
    async getBingRelatedTerms(query: string): Promise<string[]>
}
```

---

## Data Types

### Account Configuration (src/interface/Account.ts)

```typescript
interface Account {
    email: string
    password: string
    totpSecret?: string           // For 2FA
    recoveryEmail?: string
    geoLocale: string             // 'auto' or specific locale
    langCode: string              // Language code
    proxy: {
        proxyAxios: boolean
        url: string
        port: number
        username: string
        password: string
    }
    saveFingerprint: {
        mobile: boolean
        desktop: boolean
    }
}
```

### Config (src/interface/Config.ts)

```typescript
interface Config {
    baseURL: string                    // 'https://rewards.bing.com'
    sessionPath: string                // 'sessions'
    headless: boolean
    clusters: number                   // Parallel workers
    errorDiagnostics: boolean
    globalTimeout: number | string
    searchOnBingLocalQueries: boolean

    workers: {
        doDailySet: boolean
        doSpecialPromotions: boolean
        doMorePromotions: boolean
        doPunchCards: boolean
        doAppPromotions: boolean
        doDesktopSearch: boolean
        doMobileSearch: boolean
        doDailyCheckIn: boolean
        doReadToEarn: boolean
    }

    searchSettings: {
        scrollRandomResults: boolean
        clickRandomResults: boolean
        parallelSearching: boolean
        queryEngines: QueryEngine[]
        searchResultVisitTime: number | string
        searchDelay: { min, max }
        readDelay: { min, max }
    }

    webhook: {
        discord?: { enabled, url }
        ntfy?: { enabled, url, topic, token, title, tags, priority }
        webhookLogFilter: LogFilter
    }

    proxy: {
        queryEngine: boolean
    }

    consoleLogFilter: LogFilter
    debugLogs: boolean
}
```

### Dashboard Data (src/interface/DashboardData.ts)

Key structures from `/api/getuserinfo?type=1`:

```typescript
interface DashboardData {
    userStatus: {
        availablePoints: number
        lifetimePoints: number
        counters: {
            pcSearch: [{ pointProgress, pointProgressMax }]
            mobileSearch: [{ pointProgress, pointProgressMax }]
            activityAndQuiz: [...]
            dailyPoint: [...]
        }
    }
    dailySetPromotions: { [date: string]: PromotionalItem[] }
    morePromotions: MorePromotion[]
    punchCards: PunchCard[]
    promotionalItems: PurplePromotionalItem[]
    // ...
}

interface BasePromotion {
    name: string
    offerId: string
    complete: boolean
    pointProgress: number
    pointProgressMax: number
    promotionType: 'quiz' | 'urlreward' | 'findclippy' | ...
    destinationUrl: string
    title: string
    // ...
}
```

---

## API Endpoints Used

### Dashboard & Points

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `https://rewards.bing.com/api/getuserinfo?type=1` | GET | Dashboard data |
| `https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAIOS&options=613` | GET | App dashboard |
| `https://prod.rewardsplatform.microsoft.com/dapi/me?channel=xboxapp&options=6` | GET | Xbox dashboard |

### Query Sources

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `https://trends.google.com/_/TrendsUi/data/batchexecute` | POST | Google Trends |
| `https://www.bingapis.com/api/v7/suggestions` | POST | Bing Suggestions |
| `https://api.bing.com/osjson.aspx` | GET | Bing Related Terms |
| `https://www.bing.com/api/v7/news/trendingtopics` | GET | Bing Trending |
| `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/{lang}.wikipedia` | GET | Wikipedia Top |
| `https://www.reddit.com/r/{subreddit}.json` | GET | Reddit Posts |

### Activity Completion

| Endpoint | Purpose |
|----------|---------|
| `https://rewards.bing.com/api/action` | Complete activities (quiz, urlreward) |
| `https://rewards.bing.com/api/quiz` | Submit quiz answers |

---

## UI Version Detection

The script detects legacy vs modern UI:

```typescript
// Login.ts:669
const isModernDashboard = $('section#dailyset').length > 0

if (isModernDashboard) {
    bot.rewardsVersion = 'modern'
    // RequestToken disabled for modern UI
}
```

**Current Warning (README):**
> V3.x does not support the new Bing Rewards interface!

---

## Session Management

Sessions are stored in the `sessions/` directory:

```
sessions/
├── {email_hash}_mobile/
│   ├── cookies.json
│   └── fingerprint.json
└── {email_hash}_desktop/
    ├── cookies.json
    └── fingerprint.json
```

---

## Cluster Mode

When `config.clusters > 1`, the script uses Node.js cluster module:

```typescript
// Primary process
if (cluster.isPrimary) {
    // Split accounts into chunks
    const accountChunks = chunkArray(accounts, clusters)

    // Fork workers
    for (const chunk of accountChunks) {
        const worker = cluster.fork()
        worker.send({ chunk, runStartTime })
    }

    // Handle IPC messages (logs, stats)
    worker.on('message', (msg) => {
        if (msg.__ipcLog) { /* forward to webhooks */ }
        if (msg.__stats) { /* collect stats */ }
    })
}

// Worker process
else {
    process.on('message', async ({ chunk }) => {
        const stats = await this.runTasks(chunk, runStartTime)
        process.send({ __stats: stats })
        process.exit(0)
    })
}
```

---

## Key Files Reference

| File | Lines | Key Functions |
|------|-------|---------------|
| `src/index.ts` | ~540 | `MicrosoftRewardsBot`, `Main()`, cluster management |
| `src/browser/auth/Login.ts` | ~730 | `login()`, `detectCurrentState()`, `handleState()` |
| `src/functions/Workers.ts` | ~310 | `doDailySet()`, `doMorePromotions()`, `doPunchCards()` |
| `src/functions/SearchManager.ts` | ~620 | `doSearches()`, parallel/sequential modes |
| `src/functions/QueryEngine.ts` | ~485 | `queryManager()`, all query sources |
| `src/browser/Browser.ts` | ~150 | `createBrowser()`, fingerprint generation |
| `src/browser/BrowserFunc.ts` | ~345 | `getDashboardData()`, `getSearchPoints()`, `getCurrentPoints()` |

---

## Known Limitations

1. **New UI Not Supported**: V3.x does not fully support the new Bing Rewards interface
2. **Modern Dashboard**: Some features may not work when `rewardsVersion === 'modern'`
3. **Request Token**: Disabled for modern dashboard (needed for some activities)

---

## Dependencies

### Production
- `patchright` - Playwright fork for anti-detection
- `fingerprint-generator` / `fingerprint-injector` - Anti-fingerprinting
- `ghost-cursor-playwright-port` - Human-like cursor movement
- `axios` + `axios-retry` - HTTP client
- `cheerio` - HTML parsing
- `otpauth` - TOTP 2FA
- `p-queue` - Promise queue
- `zod` - Schema validation

### Development
- `typescript` ^5.9.3
- `ts-node`
- `prettier`, `eslint`

---

## Commands

```bash
# Install & build
npm run pre-build    # npm install + install chromium
npm run build        # tsc compile

# Run
npm run start        # node ./dist/index.js
npm run dev          # ts-node ./src/index.ts -dev

# Session management
npm run clear-sessions
npm run open-session -- -email your@email.com

# Docker
docker compose up -d
```

---

*Last updated: 2026-04-16*
