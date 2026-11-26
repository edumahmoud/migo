# AttenDo 

Next.js 16 / React 19 learning platform with Supabase Auth, PostgreSQL, Storage and Realtime, Paymob payments, AI summaries and quizzes, and server-verified attendance.

## Local setup

Use Node.js 22 and Bun 1.4.5 (the test runner). The canonical dependency lock is `package-lock.json`.

```sh
npm ci
cp .env.example .env.local
# Fill the values from your own development services, never production by default.
npm run dev
```

Open http://localhost:3000. Required core variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY`. Feature variables are listed in `.env.example`. Do not prefix any private credential with `NEXT_PUBLIC_`. Do not commit environment files, logs, database exports or credentials. Never paste secrets into issue reports.

AI, payment, Telegram and push features need their own configuration. Paymob credentials are managed by the app's gateway configuration; preserve `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` across deployments. Replacing that key makes saved gateway credentials unreadable. Use sandbox payment settings for development, not real charges.

## Checks

```sh
bun test
npm run typecheck
npm run lint
npm run build
```

GitHub CI runs tests, TypeScript and lint on pull requests and pushes to main. Vercel builds each PR separately. Known legacy React Compiler findings are retained as file-scoped warnings, not silently fixed by changing runtime behavior. A green workflow does not make checks mandatory: repository branch protection is a separate owner-controlled setting. Tests do not substitute for phone-camera/GPS field testing or payment sandbox testing.

## Deploy and rollback

1. Branch from current `main`, commit related changes and open a PR.
2. Wait for GitHub CI and the Vercel preview build. Verify the changed paths in preview, using disposable non-production data where possible.
3. Merge only after checks pass. `main` deploys production through the linked Vercel project.
4. Confirm the production deployment is Ready and `GET /api/health` returns HTTP 200 with `status: ok` and `service: attendo`. Check the changed user flow and error monitoring.

Keep production and preview environment variables separate. Public variables are compiled into browser assets, so changing them needs a new deployment. This repo does not provision a commercial hosting plan or database backups.

For an application regression, use Vercel's deployment rollback to the last verified compatible deployment, or revert the offending Git commit in a new PR. A deployment rollback does **not** roll back database changes. Verify `/api/health`, login and the affected flow after rollback. Do not drop columns, remove policies or restore old payment tables as an ad hoc rollback. Coordinate a separately reviewed forward-fix or tested restore plan.

## Database changes and recovery

`supabase/migrations/` contains historical SQL, including alternate fixes and overlapping versions. It is **not** a verified clean-install migration chain. Do not concatenate every SQL file, run `FULL_SETUP.sql` against production, or assume `supabase db reset` reproduces the live schema. Reconcile a fresh development database with the actual schema before treating it as equivalent. Schema drift reconciliation remains separate work.

Before each production migration: inspect current columns, constraints, policies, grants and triggers; take a restorable off-site backup; review the SQL and its compatibility with both old and new app versions. Record what was applied and when, without recording secrets. No migration is applied automatically by CI.

Attendance deployment order for the existing v137-v139 changes:

1. Apply additive `v137_attendance_verified_checkin.sql` before deploying the server check-in app.
2. Deploy and verify the compatible server check-in/QR routes.
3. Apply `v138_attendance_lockdown.sql`, then `v139_attendance_subject_authorization.sql` in order, verifying grants and role access. Never undo the lockdown merely to make an old client work.

Payment RPCs have multiple historical definitions. Confirm the live definition and run `supabase/security/verify-payment-function-grants.sql` as a read-only audit before touching payment permissions. Test a complete sandbox transaction, rejected signature, amount mismatch and idempotent webhook handling.

Database dumps do not include Storage object bytes. Back up Storage separately, protect exports and encryption keys, and rehearse a restore into an isolated environment. A backup job that has not been restored successfully is not a recovery guarantee.

## Error monitoring and uptime

The Sentry integration is opt-in through Vercel environment variables. Set the project DSN as `NEXT_PUBLIC_SENTRY_DSN` (and optionally `SENTRY_DSN` for the server), then redeploy. Keep the value in Vercel, not this repository. An optional source-map upload uses server-only `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT`. Without those, error reporting can work but stacks may be less readable.

Only error events are enabled. Request data, user identities, arbitrary error messages, extra context and breadcrumbs are removed before send; tracing, replay and logging are not enabled. Review filtering before enabling more integrations. Configure a Sentry issue alert to the owner's verified email and verify delivery with a synthetic event that contains no real user data. Most handled API errors are not exceptions and need deliberate capture if they should alert.

`Production uptime` runs on GitHub's schedule about every 30 minutes and can be run manually. It retries transient failures and fails the workflow if `/api/health` is unavailable or malformed. Enable GitHub Actions failure notifications in the owner's account. GitHub schedules can be delayed or disabled for inactive public repositories, so this is a basic free check, not an uptime SLA. The endpoint is liveness only: it does not prove the database, payments, email or AI works. No automatic restart or paid service is configured.

## Main paths

- `src/app/`: pages and API routes
- `src/lib/`: domain logic and unit tests
- `src/components/`: UI
- `supabase/`: SQL history and security checks
- `mini-services/`: optional self-hosted services

Chat already uses Supabase Realtime with a polling fallback. The optional Socket.IO service is not required for Vercel chat. For self-hosting, inspect `next.config.ts` and the optional local proxy before deployment; the production start command expects a standalone build that must be configured by the operator.
