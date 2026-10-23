# Aivo Admin Console — Guide

Open **http://localhost:3000/admin/login** (separate look and separate sign-in from the member app).

## Getting an admin account
- The **first user who registers** is automatically an admin.
- Or from the terminal: `cd backend && python create_admin.py you@example.com`
  (promotes an existing user, or add `--name "Name" --password "Str0ngPass1"` to create one).
- Admins can promote others from **Users → member → Role** (Regular member / Moderator / Admin).

## Roles
| | Admin | Moderator |
|---|:-:|:-:|
| Dashboard, view users & workouts | ✅ | ✅ |
| Posts & reports (hide, delete, dismiss) | ✅ | ✅ |
| Edit / suspend / delete members, roles, passwords, email | ✅ | ❌ |
| Delete workouts, Leaderboard, Announcements, Audit log, Settings | ✅ | ❌ |
Access is re-checked from the database on every request, so demoting someone takes effect immediately.

## What's in the console
- **Dashboard** – members, activity, workouts, posts, open reports, charts, recent signups, top members.
- **Users** – search, quick filters (joined this week · inactive 30+ days · suspended · admins & moderators), sort, CSV export,
  add user, edit profile, suspend / reactivate, change role, reset password, force logout, adjust points,
  **email the member**, delete (removes all their data), bulk suspend / reactivate / delete.
- **Workouts** – all sessions, filters, automatic flags (over 4h / under 1 min), delete (streak + points recalculated), CSV export.
- **Posts & reports** – members can report a post (🚩 button in Community); admins dismiss / hide / delete / suspend author.
  Hide, restore, delete posts and comments; export posts CSV. Private chats are never readable.
- **Leaderboard** – top 50, adjust points, **Start new season** (archives top 10, resets everyone to 0).
- **Announcements** – banner on every member's Home page; style, schedule start/end, on/off, dismissible by members.
- **Audit log** – every admin action (who, what, when, IP), filterable.
- **Settings** – registration on/off · AI coach on/off · maintenance mode (+ message) · **blocked words** · system status.
- **My account** – change your password (signs out your other sessions).

## Member-side behaviour
- A suspended member is signed out on their next request and sees "Your account has been suspended".
- During maintenance mode members see a "We'll be right back" screen; admins are unaffected.
- Posts containing a blocked word are hidden automatically and land in Reports as "Auto-filter"; comments with blocked words are rejected.

## Optional: emailing members
Add SMTP settings to `backend/.env` (see `.env.example`): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
Without them the Email button explains that email isn't configured.

## Tests
`pip install mongomock pytest && cd backend && python tests_admin.py` – runs ~150 checks of the admin API against an in-memory database.
