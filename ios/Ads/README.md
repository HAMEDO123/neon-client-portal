# NEON Ads — the marketing section of the Mac app

Until 2026-11-24 NEON Ads was its own macOS app (`~/neon-ads/mac`, "NEON Ads.app").
Hamed asked for one app instead of many ("بدي افتح برنامج واحد بدل ما افتح برامج
كتير"), so its pages became a section of NEON's Mac sidebar, **«التسويق» / Marketing**,
between "The office" and "Account". The iPhone build is untouched.

## What is where

| Piece | Where |
|---|---|
| The pages (command center, approvals, CRM, lead quality, today & shoots, my take, all campaigns, market, new ad, connection) | `Ads/Sources/NeonAds/` — a local Swift package, module `NeonAds` |
| The door the app uses | `AdsHost.swift`: `Ads.rows`, `Ads.screen(_:select:)`, `Ads.store`, `Ads.startEngine()`, `Ads.open(url)`, `Ads.snapshotIfAsked()` |
| The engine's models and the widget's views | `Ads/Shared/` — compiled into the package **and** into `NeonWidgets` (project.yml lists the two files) |
| The widget | `Widgets/AdsWidget.swift`, in `NeonWidgetsBundle` |
| The sidebar rows | `Sources/App/MacSidebarHome.swift` (`AdminHome.macSections`) |
| The engine (Python, Meta, the Brain queue) | `~/neon-ads` — not in this repo. `dashboard.py` on `127.0.0.1:8793` |

## Rules this code keeps

- **Mac only.** Every file is inside `#if targetEnvironment(macCatalyst)`, so the iPhone
  build links an empty module. The pages read an engine on the same Mac; a phone has
  nothing to read.
- **The Mac build needs macOS 14** (`IPHONEOS_DEPLOYMENT_TARGET[sdk=macosx*]: 17.0` on
  the app and the widgets; the package says `.macCatalyst(.v17)`), which is what NEON Ads
  always needed. The iPhone stays at iOS 16.
- **The engine is started by the app** (`Engine.ensureRunning`, posix_spawn of a login
  zsh — Catalyst has no `Process`), at sign-in as the manager and again by the 5-minute
  sync if it died. It outlives the app. Nothing is asked of Meta until a marketing page
  is opened (`Store.start()`, once per run).
- **Plain HTTP to 127.0.0.1 only**: `NSAllowsLocalNetworking` on the app and the widget.
- **Views read `Store.shared`** (`@ObservedObject var store = Store.shared`), never an
  environment object: toolbar items do not inherit one on Catalyst, and the first build
  crashed on exactly that.
- **Sheets fit their content** (`.fittedSheet()`, macOS 15+); a Catalyst sheet is a fixed
  form sheet otherwise.
- **The widget's buttons open `neon://ads?c=<campaign>&a=<action>`**: the app shows the
  confirmation sheet and nothing changes on Meta until Hamed confirms it there.
- Everything that needs AI goes to the engine's Brain queue, answered by Claude in chat —
  never an LLM API (see `~/neon-ads/CLAUDE.md`).

## Seeing it

- `NeonAdmin -neonScreen mac:ads.quality` (Debug): the window on that row, API GET-only.
- `NeonAdmin -neonScreen mac:ads.command -neonAdsSnapshot <dir>` (Debug): every page to
  PNG through ImageRenderer, then quit. Text fields and pickers come out as yellow
  blocks — ImageRenderer cannot draw them, the window can.
