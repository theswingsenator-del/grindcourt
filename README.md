# GrindCourt

An aggressive accountability app for two partners running the rest of 2026. Log your tasks daily or the Police fines you — real money, on a climbing ladder, judged by AI, enforced by your partner.

Stack: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4 + Supabase (Auth + Postgres + Realtime + Storage) + web-push (VAPID) + a pluggable Gemini/Claude AI wrapper. Installable as a home-screen PWA on iOS and Android — no App Store involved.

## How it works

- **Two fixed accounts only.** No public signup. The two partners are created by hand in Supabase Auth and linked to `app_users` rows (`partner_a` / `partner_b`).
- **Goals -> tasks.** Set a big goal, hit "Break this down," and the AI decomposes it into milestones -> weekly targets -> daily tasks, written straight into the `tasks` table with real due dates.
- **Daily check-in.** Morning commit + night report. Miss both on a given day and the next cron scan logs a `missed_log` violation.
- **Shared live board.** Both partners see both dockets side by side, updating in real time via Supabase Realtime — no refresh needed.
- **Disputes.** A partner can dispute a task the other marked done. An AI review decides uphold/overrule; an upheld dispute issues a `false_complete` fine against the task owner.
- **The fine ladder.** Every violation type climbs its own ladder per repeat offense for that user: ₦10,000 -> ₦25,000 -> ₦50,000 -> ₦100,000 -> ₦150,000 (ceiling). `late_night_activity` and `ignored_nags` climb two rungs per repeat instead of one.
- **The Judge (AI).** Fined? Bid a lower amount with a reason and the Judge rules accept/reject/counter. First offense of a violation type only, you can appeal instead — the Judge rules approved/denied. On ANY fine regardless of offense count, you can instead Brief the Judge — a free-form narrative explaining real work the record doesn't show. The Judge reads it holistically and rules waive / waive-and-update-task (retroactively marks the related task done) / insist (fine stands).
- **The Police (AI).** Every open fine gets an escalating roast-tone nag on every cron run. There is no mute or snooze anywhere in the UI — the only thing that stops it is your partner approving your payment proof.
- **Payment proof.** Upload a screenshot to a private Supabase Storage bucket; your partner reviews and approves it; the fine closes (`paid_approved`) and the nags stop for that fine.
- **Rest days.** Earn 1 rest day per 5 tasks completed. Spend more than you've earned and it's an `unbudgeted_rest` violation.
- **War Chest (treasury).** Paid fines fund real line items. The Board (AI, neutral capital-allocation voice) proposes one initiative at a time from a wishlist of projects; either partner can plead for a different priority and the Board decides whether to switch or hold; once the treasury balance covers the proposal's cost, either partner accepts it and it's marked funded. Runs every cron scan regardless of the enforcement grace period — funding proposals aren't punishment.
- **Collaborative work orders.** A partner can request to join the other's task; the owner approving it means an even split of credit. Either side can leave progress notes on a task detail page; either side can flag "need help" (owner-only toggle, distinct from an unprompted join request). "Done today" on the dashboard counts a task for anyone who's the owner OR an approved collaborator on it.
- **The Predictor (AI).** Pattern-mines each person's OWN check-in history for a day-of-week they tend to miss — never compares the two partners to each other. Nudges before the deadline on a detected pattern day. Ignoring a nudge (no check-in, then a `missed_log` violation follows on the same day) forfeits that violation's appeal eligibility specifically.
- **The Auditor (AI-adjacent, log-only).** Silently watches for trivial task-title padding used to inflate completion counts, but stays completely silent until a user has a personal baseline (5+ completed tasks) and only ever compares a user to their own history. Never issues a fine or a visible accusation — logs a flag for future review only, because the Judge's neutrality can never be undermined by a false positive.
- **The Narrator (AI).** A weekly "Founders' Update" that reads like a real recap you'd send an investor — references specific events by name, not a stats dump. Fires automatically on the weekly cron scan and surfaces as a card at the top of the Inbox.
- **Board Conduct (settings).** Per-person tone toggle for the Police's nag copy (Blunt / Roast / Formal) and an on/off switch for Predictor nudges. Also surfaces the Auditor's learning status ("Learning — N of 6 logged" / "Active") as read-only information.
- **Outcome Check-ins.** Marking a task done that carries an implicit real-world target (revenue, a measurable result — detected by a cheap deterministic heuristic, not AI) prompts a quick honest follow-up in the Inbox: did it actually land, or did it come up short even though the box got checked? A grounded AI assessor reads the free-text answer and rules on_track / short / unclear; on "short" it proposes 1-2 concrete corrective follow-up tasks grounded in what the person actually said, inserted the same way Planner suggestions are (pending approval).

## Project layout

```
src/
  app/
    page.tsx                 # shared live dashboard (both dockets)
    goals/page.tsx            # goal creation + "Break this down" + quick tasks
    checkin/page.tsx          # morning commit / night report
    fines/page.tsx            # bid / appeal / pay+proof / approve
    notifications/page.tsx    # in-app inbox + push opt-in + sign out + settings link + Founders' Update card
    treasury/page.tsx          # War Chest — balance, active proposal, plea form, project list
    task/[id]/page.tsx         # task detail — collaborators, notes thread, join/approve, need-help flag
    updates/page.tsx           # Founders' Updates list (the Narrator)
    settings/page.tsx          # Board Conduct — nag tone, Predictor toggle, Auditor status (read-only)
    login/page.tsx            # Supabase Auth email/password (no signup)
    api/
      goals/breakdown/        # POST — AI goal decomposition -> task rows
      tasks/                  # POST create, PATCH complete (also runs Auditor baseline/check + Outcome Check-in prompt)
      tasks/dispute/          # POST — AI-reviewed dispute flow
      tasks/join/               # POST — request to join a partner's task
      tasks/join/respond/       # POST — owner approves/denies a join request
      tasks/notes/               # POST — progress note (owner or approved collaborator)
      tasks/need-help/           # POST — owner toggles the needs_help flag
      tasks/checkin/              # POST — answers an Outcome Check-in prompt, AI-assessed
      daily-log/              # POST — upsert today's check-in
      fines/bid/               # POST — bid, judged immediately
      fines/appeal/            # POST — appeal (first offense only, blocked if appeal_forfeited), judged immediately
      fines/brief/               # POST — Brief the Judge (any offense count), judged immediately
      fines/proof/             # POST — multipart upload to Storage
      fines/approve/           # POST — partner approves proof, closes fine
      treasury/                  # GET — balance, projects, active proposal, plea history
      treasury/plea/              # POST — plead for a different priority; the Board evaluates
      treasury/accept/            # POST — accept the active proposal once balance covers cost
      settings/                  # GET/POST — Board Conduct settings (nag tone, Predictor on/off)
      push/subscribe/          # POST/DELETE — web-push subscription
      push/test/                # POST — send yourself a test push
      cron/scan/                 # GET — violations + fines + nags + treasury proposals + Predictor nudges + weekly Narrator update
  lib/
    ai.ts                    # askAI(systemPrompt, userPrompt) — Gemini/Claude switch
    fines.ts                 # the ladder (ladderStep, severityForType, formatNaira)
    restDays.ts               # earn-rate math
    violations.ts              # pure detector functions (overdue, missed log, etc.)
    issueFine.ts               # violation -> violation row + fine row + notify (also wires Predictor forfeit)
    judge.ts                   # judgeFine(), judgeAppeal(), judgeBrief()
    checkin.ts                   # looksOutcomeSensitive(), promptCheckin(), assessCheckinResponse() — Outcome Check-ins
    police.ts                  # policeNag() — tone-aware (blunt/roast/formal, see Board Conduct)
    treasury.ts                 # getTreasuryBalance(), proposeNextInitiative(), evaluatePlea() — the Board
    predictor.ts                 # detectPattern(), maybeSendNudge() — per-user day-of-week miss pattern
    auditor.ts                   # updateBaseline(), checkForPadding() — silent, log-only anti-gaming
    narrator.ts                  # generateWeeklyUpdate() — the weekly Founders' Update, prose not JSON
    goalBreakdown.ts            # breakdownGoal() — strict-JSON AI call + validation
    notify.ts                  # notify() — writes notifications row + sends push
    push.ts                    # sendPushToUser() — web-push + dead-subscription pruning
    supabase.ts / supabaseServer.ts  # browser / SSR / admin Supabase clients
    useSession.ts, useRealtimeTable.ts, useNotifications.ts  # client hooks
supabase/
  migrations/0001_init.sql            # full schema, RLS, realtime, storage bucket
  migrations/0002_seed_users_template.sql  # paste the two Auth UUIDs in, then run
  migrations/0003_war_chest_and_more.sql   # War Chest, collaboration, Predictor, Auditor, Narrator, Board Conduct
  migrations/0004_planner.sql              # Planner: tasks.source / tasks.approval_status
  migrations/0005_checkins_and_briefs.sql  # Outcome Check-ins (task_checkins), Brief the Judge (fine_briefs), fines.status +'waived'
public/
  manifest.json, sw.js, icons/        # PWA — installable with zero App Store involvement
```

## Setup

### 1. Create the Supabase project

1. Create a new project at [supabase.com](https://supabase.com) (free tier is enough to start).
2. In the SQL Editor, run `supabase/migrations/0001_init.sql` in full.
3. In **Authentication -> Users**, click **Add user** twice — one per partner. Use real email addresses, set a password, and check **Auto Confirm User** so no email verification step is needed.
4. Copy each new user's UUID (shown in the Users table).
5. Open `supabase/migrations/0002_seed_users_template.sql`, paste the two UUIDs in, adjust the display names, and run it in the SQL Editor. This links each Auth account to its `app_users` row (`partner_a` / `partner_b`) — the app has no other way to know who's who.
6. Run `supabase/migrations/0003_war_chest_and_more.sql` in the SQL Editor. This adds the War Chest, collaborative work orders, Predictor, Auditor, Narrator, and Board Conduct tables, and seeds the initial three War Chest projects (Ads Spend / Claude Pro / VPS subscription). Run it after 0001 and 0002.
7. Run `supabase/migrations/0004_planner.sql`, then `supabase/migrations/0005_checkins_and_briefs.sql`. The latter adds `task_checkins` (Outcome Check-ins) and `fine_briefs` (Brief the Judge), and widens the `fines.status` check constraint to allow `'waived'` — verify this ran clean if you're applying it by hand, since it drops and recreates a constraint.
8. In **Project Settings -> API**, copy the Project URL, `anon` public key, and `service_role` key for the env vars below.

### 2. Generate VAPID keys (for push notifications)

```
npx web-push generate-vapid-keys
```

Copy the public/private key pair into `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@yourdomain.com
AI_PROVIDER=gemini            # or "anthropic"
GEMINI_API_KEY=               # free tier — https://aistudio.google.com/apikey
ANTHROPIC_API_KEY=            # only needed if AI_PROVIDER=anthropic
CRON_SECRET=                  # any random string — protects /api/cron/scan
LATE_NIGHT_CUTOFF_HOUR=23
```

Switching from Gemini to Claude later is a one-line env change (`AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`) — zero code changes, per `src/lib/ai.ts`.

### 4. Install and run

```
npm install
npm run dev
```

Visit `http://localhost:3000`, sign in with one of the two partner accounts.

### 5. Wire up the violation-detection cron

`GET /api/cron/scan` (with header `Authorization: Bearer <CRON_SECRET>`) is the Police's heartbeat — it scans for new violations, issues fines on the ladder, and sends nags for every open fine. Nothing runs automatically without this being called on a schedule. Two options:

- **Vercel Cron** (once deployed to Vercel): add a `vercel.json` with a `crons` entry pointing at `/api/cron/scan`, e.g. every hour. Vercel's free tier includes cron, but the minimum interval is once per day on Hobby — for tighter enforcement (recommended given the "aggressive" brief) you'd want at least the Pro plan's per-minute crons, or:
- **External cron** (works on any plan): any free scheduler (cron-job.org, GitHub Actions on a schedule, EasyCron) hitting `https://yourdomain.com/api/cron/scan` with the `Authorization: Bearer <CRON_SECRET>` header on whatever interval you want — hourly is a reasonable starting cadence for both violation detection and nag frequency.

### 6. Build for production

```
npm run build
npm run start
```

## What's deliberately NOT done

- **No Vercel deployment or live credentials were touched.** This is code-only, per instructions.
- **No public signup route exists anywhere** — by design, per spec.
- **No mute/snooze control exists in the UI** — by design, per spec. The only way to stop the Police on a given fine is a partner-approved payment proof.

## Manual steps remaining before this can go live

1. Create the Supabase project, run `0001_init.sql`, create the two Auth users, seed `app_users` via `0002_seed_users_template.sql`, then run `0003_war_chest_and_more.sql`, `0004_planner.sql`, and `0005_checkins_and_briefs.sql` in order (steps 1 above).
2. Generate and set VAPID keys.
3. Choose and set an AI provider key (Gemini free tier to start is fine).
4. Set `CRON_SECRET` and wire up a real cron caller (Vercel Cron or an external scheduler) hitting `/api/cron/scan` on a schedule — without this, no violations are ever detected and no fines are ever issued.
5. Deploy (e.g. to Vercel), set all env vars from `.env.example` there, and point your domain's DNS at it.
6. On first login on each partner's phone, open the site in Safari (iOS) or Chrome (Android) and use the in-app "Install" prompt (or the browser's native Add to Home Screen) to install it — this is what makes it feel like a real app with push notifications, with zero App Store involvement.
