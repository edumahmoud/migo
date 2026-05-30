# Analytics Server Architecture Design

## CONSTRAINT 1: Single Source of Truth (Strict)

```
┌─────────────────────────────────────────────────────┐
│                    CLIENT LAYER                      │
│  (ZERO business logic. ZERO calculations.)           │
│                                                      │
│  • Fetches pre-computed metrics from API             │
│  • Displays data only                               │
│  • Uses React Query for caching + refetch            │
│  • Realtime subscriptions INVALIDATE cache only      │
│    (never compute)                                   │
│                                                      │
│  ALLOWED imports from analytics-config:              │
│    - Type definitions (PerformanceLevel, RiskLevel)  │
│    - UI display configs (PERFORMANCE_LEVELS, colors) │
│                                                      │
│  FORBIDDEN imports from performance-calculator:      │
│    - computeAllMetrics, computeSubjectPerformance    │
│    - calculate* functions                            │
│    - Any function that produces a metric number      │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP GET
                       ▼
┌─────────────────────────────────────────────────────┐
│                    API ROUTE LAYER                   │
│  (Thin. Delegates to service. Validates auth.)       │
│                                                      │
│  /api/analytics/student  → service.getStudent()      │
│  /api/analytics/subject  → service.getSubject()      │
│  /api/analytics/cohort   → service.getCohort()       │
│  /api/analytics/history  → service.getHistory()      │
│  /api/analytics/refresh  → service.invalidate()      │
│                                                      │
│  Each route:                                         │
│    1. Validates user identity                        │
│    2. Calls ONE service method                       │
│    3. Returns JSON                                   │
│                                                      │
│  NO calculation logic lives here.                    │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│               ANALYTICS SERVICE LAYER                │
│  (THE ONLY place that computes metrics.)             │
│                                                      │
│  analytics-service.ts                                │
│                                                      │
│  ┌─────────────────────────────────────────┐         │
│  │         Cache-Aside Pattern              │         │
│  │                                          │         │
│  │  getStudent(studentId, teacherId?)       │         │
│  │    1. Check analytics_cache table        │         │
│  │    2. If HIT + not expired → return      │         │
│  │    3. If MISS → compute + store + return │         │
│  │                                          │         │
│  │  getCohort(teacherId, subjectId?)        │         │
│  │    1. Check cohort_analytics_cache       │         │
│  │    2. If HIT + not expired → return      │         │
│  │    3. If MISS → compute + store + return │         │
│  │                                          │         │
│  │  getHistory(studentId, subjectId?)       │         │
│  │    1. Read analytics_snapshots directly  │         │
│  │    2. No computation — snapshots are     │         │
│  │       pre-written by event triggers      │         │
│  │                                          │         │
│  │  invalidate(keys)                        │         │
│  │    1. Delete matching cache entries      │         │
│  │    2. Optionally trigger recompute       │         │
│  └─────────────────────────────────────────┘         │
│                                                      │
│  Calls performance-calculator.ts for computation     │
│  performance-calculator.ts is SERVER-ONLY            │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ Supabase │  │ Supabase │  │performance│
   │  Cache   │  │Snapshots │  │calculator │
   │  Tables  │  │  Table   │  │  (pure)   │
   └──────────┘  └──────────┘  └──────────┘
```

---

## CONSTRAINT 2: Cache Invalidation Rules

Every cache entry has a `cache_key` that encodes what data it depends on.
Invalidation targets specific keys based on what changed.

### Cache Key Schema

```
student:{studentId}                        — overall student metrics
student:{studentId}:subject:{subjectId}    — per-subject metrics
cohort:{teacherId}                         — teacher's full cohort
cohort:{teacherId}:subject:{subjectId}     — teacher's subject cohort
```

### Invalidation Trigger Map

| Database Event | Tables Affected | Cache Keys Invalidated | Who Triggers |
|---|---|---|---|
| **Attendance record INSERT/UPDATE/DELETE** | `attendance_records` | `student:{studentId}`, `student:{studentId}:subject:{subjectId}`, `cohort:{teacherId}`, `cohort:{teacherId}:subject:{subjectId}` | Supabase DB trigger → calls `/api/analytics/refresh` |
| **Score INSERT/UPDATE** (quiz completion) | `scores` | `student:{studentId}`, `student:{studentId}:subject:{subjectId}`, `cohort:{teacherId}`, `cohort:{teacherId}:subject:{subjectId}` | Supabase DB trigger → calls `/api/analytics/refresh` |
| **Submission INSERT** (new submission) | `submissions` | `student:{studentId}`, `student:{studentId}:subject:{subjectId}`, `cohort:{teacherId}`, `cohort:{teacherId}:subject:{subjectId}` | Supabase DB trigger → calls `/api/analytics/refresh` |
| **Submission UPDATE** (grade posted) | `submissions` | `student:{studentId}`, `student:{studentId}:subject:{subjectId}`, `cohort:{teacherId}`, `cohort:{teacherId}:subject:{subjectId}` | Supabase DB trigger → calls `/api/analytics/refresh` |
| **Assignment INSERT/UPDATE/DELETE** | `assignments` | `cohort:{teacherId}`, all `student:*` in that subject | Supabase DB trigger → calls `/api/analytics/refresh` |
| **Student enrollment change** | `subject_students`, `teacher_student_links` | `cohort:{teacherId}`, `student:{studentId}` | Application code on enrollment API → calls `/api/analytics/refresh` |

### Invalidation Flow

```
DB Change
  │
  ▼
Supabase DB Trigger (pg_function)
  │  OR
Application code (for enrollment)
  │
  ▼
POST /api/analytics/refresh
  body: { studentId?, teacherId?, subjectId?, reason }
  │
  ▼
analytics-service.invalidate()
  │
  ├─ DELETE FROM analytics_cache WHERE cache_key LIKE pattern
  ├─ DELETE FROM cohort_analytics_cache WHERE teacher_id = ?
  │
  └─ Next GET request will recompute (lazy) OR
     eagerly recompute if `recompute=true` param
```

### TTL Strategy (Safety Net)

Even if an invalidation trigger fails, cache expires automatically:

| Cache Type | TTL | Rationale |
|---|---|---|
| Student metrics | 30 minutes | Data changes slowly between sessions |
| Subject metrics | 30 minutes | Same cadence as student |
| Cohort metrics | 15 minutes | Aggregated data, slight staleness acceptable |
| History/snapshots | No TTL | Immutable historical records |

---

## CONSTRAINT 3: Event-Driven Snapshot System

Snapshots are NEVER created by API calls from the client.
They are created exclusively by database triggers or background workers.

### Snapshot Triggers

| Trigger | Snapshot Type | When |
|---|---|---|
| **Daily cron job** | `daily` | Every day at 00:00 UTC — captures current metrics for all active students |
| **Grade posted** | `on_change` | When a submission transitions to `graded` status — captures post-grade state |
| **Significant risk change** | `on_change` | When a student's risk level changes between cache computations — detected during daily job |

### Daily Job Flow

```
Cron Job (00:00 UTC)
  │
  ▼
POST /api/analytics/snapshot  (internal, no client access)
  │
  ▼
analytics-service.createDailySnapshots()
  │
  ├─ For each active student:
  │    1. Recompute metrics (or read from cache if fresh)
  │    2. Check if snapshot already exists for today
  │    3. If not, INSERT into analytics_snapshots
  │
  └─ Batch insert (not per-student roundtrip)
```

### Grade-Posted Trigger Flow

```
Supabase DB Trigger on submissions UPDATE
  WHEN (OLD.status != 'graded' AND NEW.status = 'graded')
  │
  ▼
pg_net.http_post(
  url := '/api/analytics/refresh',
  body := json_build_object(
    'studentId', NEW.student_id,
    'subjectId', <derived from assignment>,
    'reason', 'grade_posted',
    'createSnapshot', true   ← triggers snapshot creation
  )
)
```

### Snapshot Schema

```sql
analytics_snapshots (
  student_id  UUID NOT NULL,
  subject_id  UUID NULL,          -- NULL = overall, set = per-subject
  snapshot_type TEXT NOT NULL,     -- 'daily' | 'on_change' | 'weekly'
  metrics     JSONB NOT NULL,      -- full StudentPerformanceMetrics JSON
  created_at  TIMESTAMPTZ
)
```

### Retention Policy

| Snapshot Type | Retention | Rationale |
|---|---|---|
| `daily` | 365 days | Full year of daily data for trend charts |
| `on_change` | 90 days | Grade events — useful for short-term analysis |
| `weekly` (aggregated from daily) | Indefinite | Weekly averages for long-term trends |

Weekly snapshots are computed from daily snapshots via a weekly rollup job, not stored separately in real-time.

---

## CONSTRAINT 4: No Logic Duplication in APIs

### Service Layer Architecture

```
analytics-service.ts          ← THE ONLY place with business logic
  │
  ├─ computeStudentMetrics()  ← private, uses performance-calculator
  ├─ computeCohortMetrics()   ← private, uses computeStudentMetrics + aggregation
  ├─ computeSubjectMetrics()  ← private, uses performance-calculator
  │
  ├─ getStudent()             ← public API: cache-aside + compute
  ├─ getSubject()             ← public API: cache-aside + compute
  ├─ getCohort()              ← public API: cache-aside + compute
  ├─ getHistory()             ← public API: reads snapshots only
  │
  ├─ invalidate()             ← public API: deletes cache entries
  ├─ createSnapshot()         ← public API: writes snapshot (called by triggers only)
  └─ createDailySnapshots()   ← public API: batch daily snapshot creation
```

Each API route is 5-15 lines:

```typescript
// /api/analytics/student/route.ts
export async function GET(req) {
  const { studentId, teacherId } = parseParams(req);
  await validateAccess(studentId);           // auth check
  const result = await analyticsService.getStudent(studentId, teacherId);
  return NextResponse.json(result);
}
```

```typescript
// /api/analytics/cohort/route.ts
export async function GET(req) {
  const { teacherId, subjectId } = parseParams(req);
  await validateTeacherAccess(teacherId);    // auth check
  const result = await analyticsService.getCohort(teacherId, subjectId);
  return NextResponse.json(result);
}
```

No computation logic in routes. Everything delegates to `analyticsService`.

### computeStudentMetrics() is the single computation path

```
getStudent()  ──→ cache miss ──→ computeStudentMetrics() ──→ performance-calculator
getSubject()  ──→ cache miss ──→ computeSubjectMetrics() ──→ performance-calculator
getCohort()   ──→ cache miss ──→ computeStudentMetrics() × N ──→ aggregate
getHistory()  ──→ reads snapshots directly (no computation)
```

`getCohort` reuses `computeStudentMetrics` per student then aggregates.
It does NOT have its own separate calculation path.

---

## CONSTRAINT 5: Performance at Scale (5,000+ students, 100+ courses)

### Problem with Current Architecture

Current: Client fetches ALL raw data, then computes per-student in useMemo.
For 5,000 students × 7 tables = 35,000+ rows transferred + N computations in browser.
This is the fundamental bottleneck.

### Server-Optimized Architecture

```
Request: GET /api/analytics/cohort?teacherId=X
  │
  ▼
Check cohort_analytics_cache
  │
  ├─ HIT (not expired) ──→ Return cached JSON (1 DB read, O(1))
  │
  └─ MISS ──→ Compute:
       │
       ├─ Batch-fetch all raw data in 4 parallel queries:
       │    1. scores WHERE teacher_id = X
       │    2. attendance_sessions + attendance_records for teacher's subjects
       │    3. submissions + assignments for teacher's subjects
       │    4. student list from teacher_student_links
       │
       ├─ Build Maps for O(1) lookups:
       │    scoresByStudent: Map<studentId, Score[]>
       │    recordsByStudent: Map<studentId, Record[]>
       │    subsByStudent: Map<studentId, Submission[]>
       │
       ├─ For each student: computeStudentMetrics() using Maps (no filtering)
       │    O(totalScores + totalRecords + totalSubs) total
       │
       ├─ Aggregate into cohort distributions (single pass O(N))
       │
       └─ Store in cohort_analytics_cache with 15min TTL
           Return JSON
```

### Pre-Indexed Data Structures

The key optimization: instead of `.filter()` per student (O(N²) total),
we build Maps once and look up per student (O(N) total):

```typescript
// BEFORE (current): O(N × M) where M = average records per student
students.map(student => {
  const studentScores = allScores.filter(s => s.student_id === student.id); // O(M)
  // ... compute ...
})

// AFTER (server service): O(N + totalRecords)
const scoresByStudent = new Map<string, Score[]>();
allScores.forEach(s => {
  const arr = scoresByStudent.get(s.student_id) || [];
  arr.push(s);
  scoresByStudent.set(s.student_id, arr);
});
// Then O(1) per student lookup
students.forEach(student => {
  const studentScores = scoresByStudent.get(student.id) || []; // O(1)
})
```

### Performance Budget

| Operation | Target | How |
|---|---|---|
| Cached cohort read | < 50ms | Single row read from Supabase |
| Full cohort compute (5000 students) | < 3s | Parallel fetches + pre-indexed Maps + single-pass |
| Single student compute (cache miss) | < 100ms | Single student data fetch + compute |
| History read (90 days) | < 200ms | Indexed query on snapshots table |
| Cache invalidation | < 50ms | DELETE with indexed cache_key |

### Eager vs Lazy Recomputation

- **Lazy** (default): Invalidate cache → next GET request recomputes
- **Eager** (for critical paths): Invalidate cache → immediately recompute and store

The `/api/analytics/refresh` endpoint supports `?recompute=true` for eager mode.

---

## DATA FLOW DIAGRAM

### Read Path (Client → Server → Cache → Compute)

```
┌──────────┐     GET /api/analytics/student?id=X     ┌──────────┐
│  Client   │ ──────────────────────────────────────→ │ API Route │
│  (React)  │                                         │  (thin)   │
│           │ ←──── JSON { metrics, cached: true } ── │           │
└──────────┘                                         └─────┬────┘
                                                           │
                                                           ▼
                                                    ┌──────────────┐
                                                    │  Analytics   │
                                                    │   Service    │
                                                    └──────┬───────┘
                                                           │
                                              ┌────────────┼────────────┐
                                              ▼            ▼            ▼
                                        ┌──────────┐ ┌──────────┐ ┌──────────┐
                                        │  Cache   │ │ Snapshot │ │Calculator│
                                        │  Table   │ │  Table   │ │  (pure)  │
                                        └──────────┘ └──────────┘ └──────────┘
```

### Write Path (DB Change → Invalidation → Optional Snapshot)

```
┌──────────┐   INSERT/UPDATE   ┌──────────┐   pg_net.http_post   ┌──────────┐
│ Supabase │ ────────────────→ │ DB       │ ───────────────────→ │ /api/    │
│  Client  │                   │ Trigger  │                      │ analytics│
└──────────┘                   └──────────┘                      │ /refresh │
                                                                  └────┬─────┘
                                                                       │
                                                                       ▼
                                                                ┌──────────────┐
                                                                │  Analytics   │
                                                                │   Service    │
                                                                │  .invalidate()│
                                                                └──────────────┘
                                                                       │
                                                            ┌──────────┼──────────┐
                                                            ▼                     ▼
                                                    DELETE from cache      INSERT snapshot
                                                    (if createSnapshot=true)
```

### History Read Path (No Computation)

```
┌──────────┐   GET /api/analytics/history?studentId=X&days=90   ┌──────────┐
│  Client   │ ────────────────────────────────────────────────→ │ API Route │
│  (Chart)  │                                                   │  (thin)   │
│           │ ←──── JSON { snapshots: [...], trend: "..." } ──  │           │
└──────────┘                                                   └─────┬─────┘
                                                                     │
                                                                     ▼
                                                              ┌──────────────┐
                                                              │  Analytics   │
                                                              │   Service    │
                                                              │  .getHistory()│
                                                              └──────┬───────┘
                                                                     │
                                                                     ▼
                                                              ┌──────────────┐
                                                              │  Snapshot    │
                                                              │  Table       │
                                                              │  (read-only) │
                                                              └──────────────┘
```

---

## API RESPONSIBILITY SEPARATION

### Endpoint Map

| Endpoint | Method | Responsibility | Calls Service Method | Computation? |
|---|---|---|---|---|
| `/api/analytics/student` | GET | Get precomputed student metrics | `getStudent()` | Cache-aside (lazy compute on miss) |
| `/api/analytics/subject` | GET | Get precomputed subject metrics | `getSubject()` | Cache-aside (lazy compute on miss) |
| `/api/analytics/cohort` | GET | Get precomputed cohort distributions | `getCohort()` | Cache-aside (lazy compute on miss) |
| `/api/analytics/history` | GET | Read historical snapshots | `getHistory()` | NO computation |
| `/api/analytics/refresh` | POST | Invalidate cache entries | `invalidate()` | Delete only (optional eager recompute) |
| `/api/analytics/snapshot` | POST | Create daily/on_change snapshots | `createSnapshot()` | Compute + write snapshot |
| `/api/migrate/analytics-tables` | POST | Create DB tables | DDL only | One-time setup |

### What Each Endpoint Does NOT Do

- `/student` does NOT compute cohort data
- `/cohort` does NOT have its own formula — it reuses `computeStudentMetrics()` per student
- `/history` does NOT compute anything — it reads snapshots
- `/refresh` does NOT return metrics — it only invalidates cache
- `/snapshot` does NOT serve data to clients — it's triggered by DB events/cron only

---

## CLIENT-SIDE ARCHITECTURE

### React Query Hooks

```
hooks/useAnalytics.ts
  ├─ useStudentAnalytics(studentId, teacherId?)
  │    queryKey: ['analytics', 'student', studentId, teacherId]
  │    staleTime: 5 minutes
  │    refetchOnWindowFocus: false
  │
  ├─ useCohortAnalytics(teacherId, subjectId?)
  │    queryKey: ['analytics', 'cohort', teacherId, subjectId]
  │    staleTime: 5 minutes
  │
  ├─ useSubjectAnalytics(studentId, subjectId)
  │    queryKey: ['analytics', 'subject', studentId, subjectId]
  │    staleTime: 5 minutes
  │
  └─ useAnalyticsHistory(studentId, subjectId?, days?)
       queryKey: ['analytics', 'history', studentId, subjectId, days]
       staleTime: 30 minutes (historical data changes infrequently)
```

### Realtime Invalidation (Client-Side)

Instead of re-fetching raw data + recomputing, the client:
1. Subscribes to Supabase Realtime on `analytics_cache` table
2. On cache invalidation event, React Query `invalidateQueries()` fires
3. Next render refetches from server API → gets fresh precomputed data

```
DB Change → Server invalidates cache → analytics_cache row deleted
  → Supabase Realtime notifies client
  → React Query invalidates matching keys
  → Next render: GET /api/analytics/student → fresh computed data
```

### What the Client STILL Fetches Directly

Raw data that is NOT analytics (no formulas involved):
- Student list / profiles
- Quiz list / quiz details
- Subject list
- Notifications
- Files

These remain as direct Supabase queries. Only analytics goes through the server.

---

## FILE STRUCTURE

```
src/
├── lib/
│   ├── analytics-config.ts          ← EXISTING (unchanged)
│   ├── analytics-types.ts           ← EXISTING (unchanged)
│   ├── performance-calculator.ts    ← EXISTING (server-only import enforced)
│   └── analytics-service.ts         ← NEW: server-side service layer
│
├── app/api/analytics/
│   ├── student/route.ts             ← NEW: GET student metrics
│   ├── subject/route.ts             ← NEW: GET subject metrics
│   ├── cohort/route.ts              ← NEW: GET cohort distributions
│   ├── history/route.ts             ← NEW: GET historical snapshots
│   ├── refresh/route.ts             ← NEW: POST cache invalidation
│   └── snapshot/route.ts            ← NEW: POST snapshot creation
│
├── app/api/migrate/
│   └── analytics-tables/route.ts    ← NEW: DDL for cache + snapshot tables
│
├── hooks/
│   └── useAnalytics.ts              ← NEW: React Query hooks
│
├── components/teacher/
│   ├── teacher-dashboard.tsx        ← REFACTORED: uses hooks
│   └── teacher-student-tracking.tsx ← REFACTORED: uses hooks
│
├── components/student/
│   ├── student-dashboard.tsx        ← REFACTORED: uses hooks
│   └── student-tracking-section.tsx ← REFACTORED: uses hooks
│
└── components/course/tabs/
    └── student-profile-modal.tsx    ← REFACTORED: uses hooks
```

---

## MIGRATION STRATEGY

### Phase 1: Foundation (This Session)
1. Create DB tables via migration endpoint
2. Build `analytics-service.ts` with cache-aside + computation
3. Build all 6 API routes
4. Build React Query hooks

### Phase 2: Client Migration (This Session)
5. Refactor teacher components to use hooks
6. Refactor student components to use hooks
7. Refactor student-profile-modal to use hooks
8. Remove client-side computation imports

### Phase 3: Event-Driven (Future)
9. Create Supabase DB triggers for cache invalidation
10. Create Supabase DB triggers for on_change snapshots
11. Set up daily cron job for daily snapshots
12. Add Supabase Realtime subscription on analytics_cache for client invalidation

Phase 3 requires Supabase Dashboard access (SQL editor for triggers + pg_cron).
For now, Phase 1+2 gives us the full server-optimized architecture with TTL-based
cache invalidation as the safety net. Manual invalidation via /refresh is available
for immediate needs.
