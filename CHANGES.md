# v9 — electric-purple activity colours, demo accounts, calendar tooltip

**Activity colours.** The streak calendar, the weekly dots on Home, the workout-timer ring and the legend now use one
"Dark Electric Purple" family (deep → royal → electric → neon → glowing ultraviolet). Every step is a gradient with a
soft neon glow; the 10+ min step glows brightest. Defined once in `styles/heat.css` + `utils/heat.js`.

**Calendar tooltip.** The hover tooltip is now one floating element rendered outside the scroll box, so it can no
longer be clipped on the first rows. It flips below the cell when there is no room above and stays inside the screen.

**Demo accounts** (clickable on `/login`; the demo admin is also on `/admin/login`):

| Account | Email | Password |
|---|---|---|
| Demo admin | admin@gmail.com | Admin@123 |
| Demo user 1 | user1@gmail.com | User@123 |
| Demo user 2 | user2@gmail.com | User@234 |

Isolation (see `backend/app/demo.py`): demo sessions read/write `demo_*` collections only (`demo_users`, `demo_posts` …).
Real members never see demo data and demo sessions never see real members, the leaderboard, posts, chats or admin lists.
The demo admin has the full admin console but every change lands in the sandbox (suspend, delete, settings, announcements,
points, leaderboard reset…). The demo world is rebuilt when the demo admin signs out (and when a demo admin signs in), so
suspended/deleted/edited demo members are restored. Safety nets: no real email is ever sent from the sandbox, demo accounts
can't be self-deleted, `admin@gmail.com`/`user1@gmail.com`/`user2@gmail.com` can't be registered as real accounts, and a
demo suspension left behind for 30+ minutes is auto-restored at the next demo login.

**v9.7: fair-play workout points.**
- The server now owns the workout clock: `POST /api/workouts/start` records the start time, `/checkin`, `/active`,
  `/cancel` and `/complete` use a per-user session (`workout_sessions`). Times/durations sent by the browser are ignored,
  so made-up or overlapping workouts are no longer possible.
- A workout is capped at 3 hours; under 1 minute is not logged (no streak / heat-map credit).
- Points: full rate for the first hour, half after it, streak bonus still up to 2x, and at most 600 points per local day.
- "Still working out?" check-in every 30 minutes (2 minutes to answer). If nobody answers, the timer stops itself and only
  the time up to the prompt is credited.
- The timer explains what happened (auto-stop, 3-hour cap, daily limit). Limits live at the top of `backend/app/routes.py`.
- `tests_engage.py` was updated for the new flow and extended (needs `pip install mongomock` to run).

**v9.6:** removed the automatic 30-minute sign-out (both the browser-side check and the server-side idle limit), so
people stay signed in. "Remember me" on the login form now works: ticked (the default) keeps you signed in across browser
restarts; unticked signs you out once the browser has been closed and re-opened (`utils/rememberMe.js`, a session cookie).

**v9.3:** fixed the demo admin landing on the member Home after signing in (the sign-in now opens the demo admin console),
and the small logo above "Welcome back" no longer shows on desktop in light mode.

**v9.2:** the demo admin now signs in on the normal `/login` page and lands straight in the sandboxed admin console
(`/admin/login` is for real admins only again). Signing out of the console returns the demo admin to `/login`.

**v9.1:** the demo bar on the login page is now a compact 3-row list (label left, `email · password` right), and demo
accounts are greeted without a name ("Good morning", "Still awake?") on Home and in the AI coach.

---

# v8 hotfix: login and register pages crashed on load (two mobile logos still pointed at a removed variable). Fixed; every page now renders in a headless test.

# Follow-up polish (v7)

- **Home layout:** the streak freeze is now one slim row inside the weekly card, and a friend challenge is one compact full-width row (progress bar or Accept/Decline). Nothing is squeezed into a side column any more, and the streak calendar fits on a 100% zoom desktop screen.
- **Colourful dots:** heatmap cells and the week dots on Home share richer gradient shades of the same five colours (indigo, violet, purple, pink, glowing orange). Each week dot takes the colour of that day's minutes. Shared in `styles/heat.css`.
- **AI coach text:** replies render as structured Markdown (headings, bullets, numbered steps, bold, quotes; tables become one card per row) in the chat, expanded view and Saved plans. The coach is also told to format plans as one heading per day with bullets. **Bug fixed:** while streaming, the reply could overwrite your own message in development builds; updates are now keyed by message id.
- **Light mode:** the Aivo logo now has a light-theme version (white lettering recoloured) on the sidebar and sign-in pages.
- **Workouts:** photos removed. 25 gym and 23 home workouts as short chips (`src/data/workouts.js`).
- **Workout saved:** one short amber line: Saved, +points, streak.

---

# Update: heatmap colour steps, streaming coach, light theme, streak freeze, badges, real workouts, challenges, saved plans

| # | Feature | Details |
|---|---------|---------|
| 1 | Heatmap colour timing | Day colour now follows total time trained that day: **under 1 min indigo, 1-2 min violet, 2-5 min purple, 5-10 min pink, 10+ min glowing orange**, so a recruiter sees every colour within a few minutes of testing. One shared definition in `utils/heat.js` drives the heatmap, its legend (hover a swatch) and the timer ring. |
| 2 | Streaming AI replies | New `POST /api/ai/chat/stream` (Server-Sent Events from Groq). The coach message fills in live with a caret, a Stop button replaces Send while it writes, and if streaming is unavailable the old `/ai/chat` call is used automatically. gzip is skipped for streamed responses. |
| 3 | Light / dark theme (member app) | Sun/moon toggle in the sidebar, Home header (phones), Profile > Appearance and on Login/Register. Saved per browser, applied before first paint (no flash). `styles/light.css`. The admin console keeps its own switch and is unaffected. |
| 4 | Streak freeze | One freeze per calendar week (Mon-Sun, your timezone) turns a rest day into a day that keeps the streak alive without adding to it. Card on Home: **Freeze today** (or **Save yesterday** if you missed it), Undo. Frozen days show as a snowflake in the week strip and a striped cell in the heatmap. Training on a frozen day gives the freeze back. Every streak number (Home, heatmap, leaderboard, profile, progress, badges) uses the same rule. `GET/POST/DELETE /api/streak/freeze`. |
| 5 | Badges & achievements | 16 badges (First Step, First 10 Workouts, 7-Day Streak, Early Bird, Night Owl, Glow Up, Hour Power, All-Rounder, Smart Recovery, Challenger, ...). Shown on the Profile (with progress on locked ones), in the leaderboard **player sheet**, and as "new badge unlocked" in the workout result. Computed from real data, nothing to migrate. `GET /api/badges`, `GET /api/badges/user/<id>`. |
| 6 | Real workout names + photos | Timer now offers 8 **Gym** (Barbell Bench Press, Back Squat, Deadlift, Lat Pulldown, Dumbbell Shoulder Press, Pull-Ups, Leg Press, Treadmill Run) and 8 **Home** workouts (Push-Ups, Bodyweight Squats, Walking Lunges, Plank, Mountain Climbers, Jump Rope, Chair Tricep Dips, Crunches) with photos. Photos are in `frontend/public/workouts/` (public-domain set from free-exercise-db); replace any JPG with your own of the same name. List lives in `src/data/workouts.js`. Old sessions keep their old names. |
| 7 | Friend challenges | "Most minutes this week" (Mon-Sun) between you and a friend. Challenge button on every friend, accept/decline, live you-vs-friend bar that refreshes every 15 s, shown on Friends and on Home, winner stored when the week ends (unlocks Challenger). `GET/POST /api/challenges`, `PUT .../accept\|decline`, `DELETE .../<id>`. |
| 8 | Save plans | "Save plan" button under the coach's workout/meal plans (also detects the type). Saved plans live on the Profile (expand, copy, delete). `GET/POST /api/plans`, `DELETE /api/plans/<id>`. |

Also: Profile's error screen used `BackButton` without importing it (fixed); account deletion (member + admin) also removes freezes, challenges and saved plans.
New collections (created automatically, indexes added on start): `streak_freezes`, `challenges`, `saved_plans`. No new dependencies.
Tests: `python backend/tests_engage.py` (needs `pip install mongomock`); `tests_admin.py` still passes.

---

# Update: streak colours, AI coach bot icon + expand, clickable leaderboard players

| # | Change | Details |
|---|--------|---------|
| 1 | Streak calendar colours | Any workout now colours the day (old first step needed 15 min and was nearly the same as a rest day). Steps: <10m, 10-20m, 20-40m, 40-60m, 1h+ with clearly different colours; today is outlined (`StreakCalendar.jsx/.css`) |
| 2 | AI coach | New robot icon (floating button, header, message avatar, Home tile); Expand/Shrink button on desktop for a wide reading view (`AiCoach.jsx/.css`, `Icon.jsx`) |
| 3 | Leaderboard | Rows (Friends + Global) open a player sheet: Add friend / Request sent / Accept request / Message. Backend rows now include `id`, `relation`, `request_id` (`routes.py`) |

# Update: member + admin polish pass

| # | Change | Details |
|---|--------|---------|
| 1 | Login: double eye icon | Edge/IE draw their own show-password eye inside password fields on top of ours. Hidden globally (`::-ms-reveal`, `::-ms-clear`, Safari/Chrome autofill button) in `styles/tokens.css`, so Login, Create account and Admin login all show a single eye |
| 2 | Sidebar: Chat removed (desktop) | The messages icon beside the bell in the Home top bar is the desktop entry. Chat stays as a tab in the phone bottom bar, because the top icon is hidden on phones (`BottomNav.jsx`, `BottomNav.css`) |
| 3 | Messages window redesigned | New header (gradient title block, unread count, friend avatar + presence), search box in the conversation list, unread badges, day dividers (Today / Yesterday / date), grouped bubbles with tails only on the last bubble of a group, timestamp once per group, pill composer with gradient send button, one pane at a time on phones. Same data and socket logic (`ChatPanel.jsx` / `.css`) |
| 4 | AI coach: duplicate close | Header X removed on desktop; the floating button (turns into X) is the one close control. Phones keep the header X because the floating button is hidden in the full-screen view (`AiCoach.css`) |
| 5 | Admin console + admin login on the new design | Same tokens as the member app: graphite surfaces, violet gradient buttons and active states, Bricolage Grotesque headings + Figtree text, the Aivo logo in the sidebar, rounded cards. Dark is now the default (the sun/moon toggle still switches to a matching light theme). Admin login uses the same two-pane layout as the member sign-in and is always dark. Chart colours moved to the violet palette (`admin/admin.css`, `AdminLayout.jsx`, `AdminApp.jsx`, `pages/LoginPage.jsx`, chart pages) |

No API, database or dependency changes.

---

# Update: full UI/UX redesign (all member pages)

Look and layout only. No API, data or logic changes.

| Area | What changed |
|------|--------------|
| Design system | New tokens (`styles/tokens.css`) and shared primitives (`styles/theme.css`). Brand colour is now the gold of the Aivo logo; mint = good/online/done, ember = streak, violet = AI coach only. Fonts: Bricolage Grotesque (headings/numbers) + Figtree (text) via `@fontsource-variable` (new dependencies) |
| Navigation | One app shell: fixed sidebar on desktop, bottom tab bar on phones (`components/BottomNav.jsx`) with unread/request badges, your name + points and Log out. Back/Home buttons only appear where still useful |
| Home | Weekly-goal ring, week strip and a big Start workout button as the focus; totals, shortcuts (new "Ask AI coach" tile), restyled streak heatmap |
| Login / Create account | Two-pane layout with logo and benefits, clearer alerts, section cards, tap-to-select goal chips |
| Friends | Requests card, friends list with presence, search; on phones a Your friends / Find people switch |
| Chat | Full-page messenger and floating window redesigned: bubbles, auto-growing input, one pane at a time on phones with a back arrow |
| AI coach | New panel (readable lists, suggestion chips, full-screen on phones); also opens from the Home shortcut |
| Community, Leaderboard, Profile, Progress | Icons instead of emoji, cleaner cards, charts in the new palette; Delete account moved to its own section on Profile |
| Modals + toasts | Workout timer, calorie calculator, confirm dialogs, toasts, announcements restyled |

Admin console is unchanged apart from keeping its own heading font.
New dependencies: `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/figtree` (run `npm install` in `frontend/`).

---

# Update: leaderboard tabs, Aivo favicon, login cold-start handling

| # | Change | Details |
|---|--------|---------|
| 1 | Leaderboard: **Friends** and **Global** tabs | `GET /api/workouts/leaderboard?scope=friends\|global` (default `global`). Global = top 15 + the caller's real global rank (`me`, shown as a pinned row under the list when outside the top 15, plus a "Your global rank" card). Friends = you + your friends ranked among themselves, with an empty state linking to `/friends`. Equal points share a rank. Response still has `leaderboard`; new fields: `me`, `scope`, `is_me` per row |
| 2 | Favicon | React logo replaced by the Aivo runner emblem: `favicon.ico` (16/32/48/64), `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`; `index.html` links them (with `?v=2` to bust browser caches) |
| 3 | Login cold start | Login request alone now has a 60 s timeout (all other requests keep 20 s). After 4 s without a reply the form shows "Server is waking up, this can take up to a minute"; a no-response failure shows that message instead of "Network error" (a genuinely offline browser still gets an offline message) |

Files touched: `backend/app/routes.py`, `frontend/src/components/LeaderboardPage.jsx` + `.css`, `frontend/src/pages/Login.js`, `frontend/index.html`, `frontend/public/*` (new icon files, `favicon.ico` replaced). No new dependencies, no DB migration.

---

# Update: site-wide speed & smoothness pass

| Area | Change |
|------|--------|
| Page loading | Critical dark background + spinner inlined in `index.html` (no white flash); API origin preconnected; logo converted PNG -> WebP (104 KB -> 22 KB); Home no longer downloads the workout timer, calorie calculator, AI coach or chat widget up front (loaded on idle / on hover); other pages' code is prefetched while the browser is idle (skipped on data-saver / 2G); build targets ES2020 and strips `console.log` |
| Page rendering | Removed `backdrop-filter` from scrolling cards/headers/nav (it re-blurs every frame while scrolling; the surfaces are already near-opaque on the dark theme). Kept on modal overlays and the login cards. `transition: all` replaced with explicit properties (13 places). Decorative orbs promoted to their own GPU layer. Long lists (`.comm-post`, `.friend-card`) use `content-visibility: auto` |
| Scrolling | Smooth anchor scrolling, `overscroll-behavior`, touch-action tuning; scroll chaining contained inside panels |
| Objects loading | Progress counters/score ring use `requestAnimationFrame` instead of 16-20 ms `setInterval` re-renders; lazy-loaded modals show a spinner instead of blocking; logo has explicit size + async decode |
| Transitions | Soft 220 ms fade between pages (opacity only; disabled with `prefers-reduced-motion`) |
| Backend | JSON/text responses > 1 KB are gzip-compressed (no new dependency); JSON keys no longer sorted per response |
| Hosting | `frontend/vercel.json` adds long-lived immutable caching for `/assets/*` (SPA rewrite unchanged) |

New files: `frontend/src/styles/performance.css`, `frontend/src/utils/prefetch.js`, `frontend/src/pages/images/aivo_logo.webp` (replaces `aivo_logo.png`).
Edited: `index.html`, `vite.config.js`, `main.jsx`, `App.jsx`, `pages/Home.js`, `pages/Login.js`, `pages/Progress.js`, `admin/pages/LoginPage.jsx`, several `.css` files, `backend/app/__init__.py`. No new dependencies, no API changes.

---

# Update: timer fit, consistent streak, fast community feed

| # | Issue | Root cause | Fix |
|---|-------|-----------|-----|
| 1 | Had to scroll the Workout Timer to see points + streak | Fixed-size clock (180px) + roomy result card pushed the result below the 90vh panel | Clock/fonts scale with viewport height (`clamp(..vh..)`), tighter spacing, result card is now a compact head row + two side-by-side stat tiles. Fits without scrolling on normal laptop screens (panel scroll only remains as a last resort on very short windows) |
| 2 | Streak differed between heatmap (correct) and Home / leaderboard / popup | The heatmap counted real workout days, everything else read a stored `streak` counter that was bumped/reset by hand and drifted (legacy users without `last_workout_date`, timezone changes, back-dated sessions) | One source of truth: `compute_streak()` in `backend/app/utils.py` derives the streak from the `workouts` collection (user's timezone, today-not-yet-trained doesn't break it). Used by `/workouts/complete`, `/workouts/stats`, `/users/me`, login, progress-summary, `/workouts/daily-summary` (heatmap shows the server value) and the leaderboard (batched, per-user timezone). The stored field is now just a cache that self-repairs |
| 3 | Community posts slow to appear | Every photo post sent its full base64 image (up to ~1 MB each) inside the feed JSON | Feed JSON no longer contains photos; each post has a small signed `imageUrl` served by `GET /api/posts/<id>/image` as a real image with `Cache-Control: immutable` + ETag. Text/cards render immediately, photos load in parallel and are cached by the browser. Plus: last feed is cached in localStorage (instant first paint, silent refresh), Home prefetches the feed and the Community code chunk, first 2 photos load eagerly, space is reserved so the layout doesn't jump |

Files touched: `backend/app/utils.py`, `backend/app/routes.py`, `backend/app/social/routes.py`,
`frontend/src/components/WorkoutTimer.jsx`, `frontend/src/components/StreakCalendar.jsx`,
`frontend/src/pages/Community.js`, `frontend/src/pages/Community.css`, `frontend/src/pages/Home.js`,
new `frontend/src/utils/feedCache.js`. No new dependencies, no DB migration (old users self-correct on first read).

---

# What was fixed (audit → implementation)

## Your 5 reported issues
| # | Issue | Root cause | Fix |
|---|-------|-----------|-----|
| 1 | Slow to load | Home called the heavy `/analytics/progress-summary` (loaded every workout + 30 queries) just for 3 numbers; no DB indexes; base64 avatars in every list; one 848 KB JS bundle; Socket.IO fell back to long-polling | New cheap `/workouts/stats`; indexes auto-created; avatars removed from list payloads; lazy-loaded routes + vendor chunks (first load ≈ 104 KB gzip vs 244 KB); `simple-websocket` added; analytics rewritten (2 small queries instead of loading everything) |
| 2 | Message shown twice | Two chat implementations (REST+reload vs socket), mismatched payload keys, server echoed to sender, no de-duplication | One shared socket in `ChatContext`; optimistic send with `clientId`; server **ack** replaces the pending bubble; sender's own tab is skipped in the broadcast; upsert-by-id/clientId so duplicates are impossible |
| 3 | Wrong time | Server sent naive UTC (`…T09:48:55`, no `Z`) → browser parsed it as local | Every timestamp now ends in `Z`; frontend `parseServerDate()` also repairs legacy values |
| 4 | Friends/posts/messages slow | 50 posts with full images + avatars per load, full reload on every like/comment, N+1 search queries, no pagination, 4 separate `/friends/list` fetches | Feed paginated (10) with "Load more"; optimistic like/comment (no reload); search = 3 queries total; messages paginated (id cursor); friends list fetched once and shared; client-side image compression; skeleton loaders |
| 5 | Streak calendar colours late | Grid rendered empty until the request finished; all ~370 cells re-rendered on every hover; UTC date maths shifted days (UTC+6!) | Last data cached in localStorage → coloured on first paint, revalidated in background; memoised cells + CSS-only tooltip; local-date helpers; server groups days in the user's timezone |

## Other bugs fixed
- Unread badge always 0 (wrong id types, `read` never written) → works, live over the socket, per-friend counts + last message in friends list
- "Accept" from search results sent the user id instead of the request id
- Can't re-add a friend after unfriending (stale `accepted` request) → requests cleaned on unfriend
- Streak never reset after a missed day → `effective_streak()` (timezone-aware); stored `last_workout_date`
- Workout duration/points trusted the client → capped by wall-clock time; timer now timestamp-based (no background-tab drift)
- `html.escape` on write showed `&#x27;` in posts/messages → removed (React escapes); legacy rows un-escaped on read
- Account deletion missed posts/messages/friends (wrong field names & id types) → fixed
- User search used raw regex input (ReDoS/injection) → escaped, min 2 chars; non-friends' emails are masked
- Online status broke when any one tab/StrictMode remount disconnected → per-user set of sockets
- Progress page showed fabricated weight history/heart-rate → removed; weight history is now recorded when you update your weight; sleep/hydration labelled "(est.)"
- `/api/workouts/complete` accepted ISO strings with `Z` only on Python ≥3.11 → parser works everywhere
- Startup no longer waits on 9 sequential index timeouts if the DB is down

## Security / hygiene
- **`backend/.env` removed from this zip (it contained real secrets). Rotate your Atlas password + secret keys, and recreate `.env` from `.env.example`.**
- Server refuses to start in `FLASK_ENV=production` with default secrets
- Rate limits on login, register, AI chat; request size cap 4 MB; image type/size validation (posts & avatars)
- AI endpoint: history capped (20 msgs × 2000 chars), cheaper profile query
- Removed dead code: `App.js`/`index.js` (duplicates), `models.py`, `services.py`, duplicate calorie blueprint, unused `ChatSidebar`, CRA leftovers, `react-calendar-heatmap`
- Added Dockerfiles; docs now correctly say Groq

## Known limitations / next steps
- Images are still stored as base64 in MongoDB (now small, ≤~1 MB). Next step: object storage (S3/Cloudinary).
- Rate limiter is in-memory (fine for 1 process; use Redis if you scale out).
- For production serving, run behind gunicorn with a single worker + `simple-websocket`, or move to eventlet/gevent.
- Sleep/hydration are not tracked yet (placeholders).
- Unit tests are not included; `/tmp`-style smoke tests were run against an in-memory Mongo for the REST + socket flows.

## Update — in-site dialogs & admin login redesign
- **No more browser pop-ups.** Every native `alert()` / `window.confirm()` in the member app was replaced by an in-site dark/violet dialog or toast (new `frontend/src/components/Feedback.jsx` + `Feedback.css`, mounted in `main.jsx`; use `const { confirm, toast } = useFeedback()`).
  - Friends: remove friend → confirm dialog + toast
  - Community: delete post → confirm dialog + toast
  - Profile: photo-upload / update / delete-account errors and "profile updated" → toasts
  - Register: success and error messages → toasts (short delay before redirecting home)
  - The admin portal already used in-site dialogs and toasts; nothing native remained there.
- **Admin login redesigned** (`admin/pages/LoginPage.jsx`, login block in `admin/admin.css`): centred glass card on the same navy/violet backdrop as the member login, with the Aivo logo, an "Admin Console" badge, show/hide password eye inside the field, feature chips and a back link. Auth logic is unchanged.

## Update — chat presence/typing, workout-timer guard, UI/UX batch
**Chat**
- Online dot (pulsing green) on avatars in the Chat page list + header, floating chat window, and Friends page; offline shows "Last seen 10m ago".
- Animated typing bubble inside the conversation, inline "typing…" in friend lists and headers; the floating chat window now also *sends* typing events. Typing clears when a message arrives, the friend goes offline, or you switch/leave the chat.
- "Reconnecting…" banner on the Chat page when the live connection drops. (Backend untouched.)

**Workout timer**
- Closing the timer (× or backdrop) while it is running asks: **Save workout & close** / **Reset (discard)** / **Keep going**.
- A running session is remembered (per user, up to 12 h) so a refresh or accidental navigation resumes it instead of losing it.

**UI/UX**
- Shared violet accent tokens (`styles/tokens.css`) used by `theme.css` and new components.
- SVG icon set (`components/Icon.jsx`) replaces emojis on Home, nav icons, Back/Home buttons, Friends, Chat, Login, timer controls.
- Home dashboard: greeting + date, weekly-goal ring (5 workouts/week), Mon–Sun strip, today's minutes, stat tiles with skeletons.
- Empty states + skeleton loaders (Friends, Chat, floating chat). Mobile bottom tab bar (≤768 px).

**Vercel**
- Frontend root directory `frontend/`; env var `VITE_BACKEND_URL=https://<your-backend>`; `vercel.json` SPA rewrite already included.
- Chat presence/typing use Socket.IO, so the backend must run on a persistent host (Render/Railway/Fly), not Vercel serverless, with `CORS_ORIGIN=https://<your-app>.vercel.app`.

## v9.8
- Points: 1 minute = 1 point (whole minutes, no streak multiplier, no half-rate after an hour; 600/day cap kept).
- Streak colours: 1–2, 2–3, 3–5, 5–8, 8+ min (heatmap, week dots and timer ring share `utils/heat.js`).
- Workout timer: workout names in an even, centred grid; golden "Saved" card appears the moment Stop is tapped.
- Home: Streak freeze and Friend challenge bars are cached per user (`utils/engageCache.js`) so they show intact on refresh; no challenge = nothing shown.
