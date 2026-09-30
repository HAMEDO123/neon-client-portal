# UI redesign — progress

The whole app, rebuilt on one design kit in the visual language of the owner's
two mockups (Home and Chat list). Status as of 2026-09-30: **every area done,
reviewed from live screenshots, fixed, merged.**

## How it was done

1. **Kit first.** `ios/Sources/UI/` was upgraded to the mockups — tokens, hues,
   KPI and section cards, mini bars, segmented progress, pill filters, story
   avatars, list row cards, hero with photo. `UI/README.md` is the reference
   and the rules; `-neonScreen kit` … `kit-12` shows every component.
2. **One agent per area, in parallel**, each in its own worktree and owning
   only its own files, so eleven areas could not collide.
3. **Live screenshots of every screen** through the Debug screen router
   (`-neonScreen <id>`, `-neonScroll <anchor>`, `tools/screenshot.sh`),
   read-only against the live studio: the app refuses every non-GET in that
   mode, so nothing is marked read and nobody is shown online.
4. **A design critic per area** judged those screenshots against the mockups
   and the kit; the area's engineer fixed what it found.
5. Merged, rebuilt, re-screenshotted (`/Users/hamedsamir/neon-wt/ux-shots/round2`).

## Areas

| Area | Router ids | Critic findings | Fixed | Detail |
|---|---|---|---|---|
| Home (manager) | 6 | 19 | 18 | [home.md](redesign/home.md) |
| Alerts · Reviews · Analytics | 3 | 17 | 17 | [insights.md](redesign/insights.md) |
| Chat list & stories | 15 | 17 | 15 | [chatlist.md](redesign/chatlist.md) |
| Chat room | 9 | 18 | 18 | [chatroom.md](redesign/chatroom.md) |
| Projects & gallery | 11 | 20 | 20 | [projects.md](redesign/projects.md) |
| Project files | 16 | 18 | 16 | [projectfiles.md](redesign/projectfiles.md) |
| Tasks (manager) | 18 | 23 | 23 | [tasks.md](redesign/tasks.md) |
| Team & payroll | 9 | 23 | see team.md | [team.md](redesign/team.md) |
| Attendance · Requests · Site visits · Settings · WhatsApp | 8 | 20 | 20 | [ops.md](redesign/ops.md) |
| Team member screens · More · Login | 11 | 19 | 17 | [me.md](redesign/me.md) |
| Calls | 21 | 20 | 21 | [calls.md](redesign/calls.md) |

Every screen and sheet of an area has a router id (see each area's
`<Area>Screens.swift`); `-neonScreen list` prints them all.

## Open — needs the live server or a device

- **Deploy the server.** Home's Today's Tasks, This Month, KPI trends and the
  manager's name (`home/today`, `home/pulse`), photo thumbnails
  (`/api/media?w=`) and the Employees team count (`accessRole`) need the
  current `main` running on the studio's PC.
- **Calls** were fixed from code review only (answering phone never started
  the connection; glare deadlock; frozen video; earpiece audio). They need one
  real call phone↔phone and phone↔browser on TestFlight.
- **Team member screens** (Today, Tasks, Requests, Profile …) have not been
  seen with live data: only the manager's sign-in is used for screenshots.
- Group info and another person's story could not be reviewed: there was no
  custom group or live story on the server when the shots were taken.

## Open — shared pieces no area owned

These were skipped by area engineers because they live in the kit or the app
shell; each area worked around them locally where it mattered.

- Kit: disabled-button contrast (`NeonButton`), `SheetScaffold`'s bottom bar and
  header tile hue, `AccountMenu` avatar at 44 pt, a top scrim in `NeonScroll`
  (Home and Tasks have their own), `HeroCard` photo-mask start, `ErrorState`
  with a contextual title, `ProgressLegend` wrapping past four segments.
- Shell: the system tab bar (only its unselected colour was changed; the kit
  has `NeonTabBar`, not adopted), a proper "open this tab" API instead of
  `PushCenter.pendingPath`.
- English plurals: `L()` never reads a `.stringsdict` for English.
