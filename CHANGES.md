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
