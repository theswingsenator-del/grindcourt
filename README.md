# GrindCourt

Accountability PWA for partners committing to goals with real money on the line.

**Original personal version** built for two partners as a proof-of-concept. Features real-money commitments, escalating fines, proof submission, and appeals.

**Tech:** Next.js, Supabase Realtime, PostgreSQL, Tailwind CSS, PWA

## Features

- Real money accountability: commitments lock in funds
- Automatic fine escalation on missed goals
- Proof submission and appeal system
- Live Supabase Realtime updates
- Offline-capable service worker
- Installable on mobile (no app store needed)
- Role-based access (partner A/B view)

## Setup

```bash
npm install

# Configure environment
cp .env.example .env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

# Run
npm run dev  # http://localhost:3000

# Deploy
vercel
```

## Database

Uses Supabase PostgreSQL. Run migrations:
```bash
npx supabase migration up
npx node scripts/seed.js  # if needed
```
