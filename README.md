# Forest Fund — a local copy you can export

[![checks](https://github.com/fedyunin/forestplant-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/fedyunin/forestplant-desktop/actions/workflows/ci.yml)
[![installers](https://github.com/fedyunin/forestplant-desktop/actions/workflows/release.yml/badge.svg)](https://github.com/fedyunin/forestplant-desktop/actions/workflows/release.yml)
[![releases](https://img.shields.io/github/v/release/fedyunin/forestplant-desktop?display_name=tag&color=1f6feb)](https://github.com/fedyunin/forestplant-desktop/releases/latest)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-5fa04e)](https://nodejs.org)

A desktop application: it pulls forest fund data out of the GIS
`forestplant.gharysh.kz`, keeps it locally, and hands selections over as KML
for Google Earth, GeoJSON for QGIS and ArcGIS, or CSV for Excel.

The GIS itself offers no export, and the services directory is switched off by
the administrator — the data cannot be taken from there by ordinary means.

The interface speaks Russian, English and Kazakh; the language is chosen in
Settings and follows the system by default.

## What it needs from you

**Your own GIS account.** The application signs in to the same ArcGIS REST
endpoint the web client uses, with the login and password you already have,
and reads exactly what that account is allowed to read. It carries no account
of its own, ships no credentials, and works around no access control: the
[47 layers the account has no rights to](#what-you-need-to-know-about-the-data)
answer 403 and stay empty. What it adds on top is the export the web interface
does not offer, and a local copy that outlives a session.

Without an account there is still something to run: point the application at a
data folder someone else has already synced and it works offline, with no
server involved.

## Download a build

| | |
|---|---|
| **macOS** — Apple Silicon | [ForestPlant-mac-arm64.dmg](https://github.com/fedyunin/forestplant-desktop/releases/latest/download/ForestPlant-mac-arm64.dmg) |
| **macOS** — Intel | [ForestPlant-mac-x64.dmg](https://github.com/fedyunin/forestplant-desktop/releases/latest/download/ForestPlant-mac-x64.dmg) |
| **Windows** — installer | [ForestPlant-win-x64-setup.exe](https://github.com/fedyunin/forestplant-desktop/releases/latest/download/ForestPlant-win-x64-setup.exe) |
| **Linux** — AppImage | [ForestPlant-linux-x86_64.AppImage](https://github.com/fedyunin/forestplant-desktop/releases/latest/download/ForestPlant-linux-x86_64.AppImage) |

macOS 13 (Ventura) or later: Electron 44 dropped macOS 12 in step with
Chromium. On Monterey the last version that runs is
[v0.3.0](https://github.com/fedyunin/forestplant-desktop/releases/tag/v0.3.0).
Windows and Linux are unaffected.

Those links always resolve to the newest release — every version is built on
[GitHub Actions](.github/workflows/release.yml) under the same file names, so
nothing here needs editing when one ships. Every build is on the
[releases page](https://github.com/fedyunin/forestplant-desktop/releases), and
what changed in each is in the [changelog](CHANGELOG.md).

The builds are ad-hoc signed but not notarized — that needs a paid Apple
Developer ID — so the first launch needs a nudge past the OS:

- **macOS** — right-click the app → **Open**, then confirm. Or, if macOS still
  refuses: `xattr -cr "/Applications/ForestPlant.app"`.
- **Windows** — *More info* → *Run anyway*.
- **Linux** — `chmod +x ForestPlant-linux-x86_64.AppImage`, then run it. An
  AppImage needs no installation and no package manager.

An installed application still needs the data. Point it at a data folder
someone else has already synced, or give it GIS credentials in Settings and let
it fetch the data itself — the first full sync takes hours.

## Quick start

```bash
npm install
npm run sync      # fetch from the server and build the database (hours on the first run)
npm start         # the application
```

Node 22 or newer. The application asks for the credentials itself and stores
them in the system keychain. For the command line, set `FP_USER` and `FP_PASS`.

## Commands

| Command | What it does |
|---|---|
| `npm start` | the application |
| `npm run sync` | fetch changes and update the database |
| `npm run sync -- --check` | only show what changed on the server |
| `npm run sync -- --retry-failed` | retry the layers that failed |
| `npm run sync -- --full` | refetch everything from scratch |
| `npm run load -- --reset` | rebuild the database from the archive, offline |
| `npm test` | core tests |
| `npm run smoke` | window self-check |
| `npm run lint` | style |

## Building

```bash
npm run dist       # macOS (DMG for Apple Silicon and Intel) + Windows (installer)
npm run dist:mac
npm run dist:win
npm run dist:linux # AppImage; built on Linux, or in the release workflow
```

The finished files land in `dist/` under the same names as the released ones —
`ForestPlant-mac-arm64.dmg`, `ForestPlant-mac-x64.dmg`,
`ForestPlant-win-x64-setup.exe`, `ForestPlant-linux-x86_64.AppImage`. They
carry no version on purpose, so the download links above keep working release
after release.

Pushing a `v*` tag builds all four on GitHub — macOS on a Mac runner, Windows
on a Windows runner, Linux on Ubuntu, each rebuilding the native database
module for its own platform — and attaches them to a draft Release, which
stays a draft until someone presses Publish.

Three things that took a long time and must not be touched without a reason:

**The application name has to be ASCII.** With Cyrillic in `productName` the
built application dies at startup, before Electron initialisation. The display
name is set separately, through `CFBundleDisplayName`.

**macOS signing entitlements.** Ad-hoc signing is mandatory on Apple Silicon,
and with it come `disable-library-validation` (or the system kills the app on
the native module) and `allow-jit` (or V8 dies with `Failed to reserve virtual
memory for CodeRange`).

**The startup log.** Written to `app.log` next to the application settings.
Without it a crash at startup looks like «it just does not open» — nobody sees
console output from a packaged application.

## What lives where

```
db/               data folder (path set in Settings)
  forest.sqlite     the database
  raw/              raw archive: one .geojson.gz per layer + the manifest
src/core/         core without Electron: client, geometry, KML, database
src/main/         main process: window, IPC, queries
src/renderer/     the window
src/exporters/    export formats: KML, GeoJSON, CSV
test/             tests
docs/             architecture and the decisions taken
```

Do not delete `raw/`: it is the lossless original, the database is rebuilt from
it at any time and never the other way round. Resuming a download and spotting
changes both rest on it.

## Screens

**Data** — browsing and querying: the object table, filters by block, stand,
area, species and land category, an object card with the raw attributes, and
SQL as a second way of building the same selection.

**Export** — three formats: KML for Google Earth, GeoJSON for QGIS and ArcGIS,
CSV for Excel and reports. Search over the forestries, with the region and
agency rows pickable themselves: one click takes a whole region.

In KML, five layers — stand polygons, stand labels, block polygons, block
labels, forestry outline — switch on and off separately, because an overview
map of a region needs none of the detail and loads in seconds without it.
Labels follow a preset or a template of your own (`{kv}-{vd} {poroda}`), and
colours and line widths have a preview. GeoJSON writes the geometry with the
attributes as they are; CSV writes the table, with the delimiter and the UTF-8
mark Excel needs. An estimate of what the export will weigh comes before the
run, in the terms of the chosen format.

**Settings** — the data folder, credentials, database management (checking for
updates by layer fingerprints without downloading, fetching changes, retrying
failures), the archive state, and the field schemas: which field took which
role. Not decoration — the field names across the system are inconsistent, and
twice a silent bug hid exactly there.

## What you need to know about the data

**47 layers answer 403** — nurseries, tree plantings, seed harvesting. The
account has no rights on the server; retrying does not help. The application
marks them separately, so missing data does not look like data that never
existed.

**Field names differ between regions.** The stand number appears as
`НумерацияВыделов`, `Nвыд`, `NВыд`, `Нумерация_выделов`. Roles are resolved by
the shape of the name, not from a list.

**Forestry names disagree between layers and contain typos.** The stands say
«Байнкольское», the blocks «Байынкольское»; one Kaskelenskoe stand spells it
«Каскеленско». Blocks are linked first by normalised name, and the remainder by
geography.

**Google Earth refuses more than 250 000 vertices per file** — vertices, not
objects, and every label is a vertex too. Files are split automatically, with
an index file of links written next to them.

More about the decisions taken — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contributing

Bug reports, layers that come back wrong and pull requests are welcome —
[CONTRIBUTING.md](CONTRIBUTING.md) has the short version: `npm test` and
`npm run lint` must pass, and a change to how fields are recognised needs a
test with the real field name that prompted it.

Found something security-shaped? [SECURITY.md](SECURITY.md) — please do not
open a public issue for it.

## License

[MIT](LICENSE) © Alexey Fedyunin.

The licence covers this application, not the data it reads: what you may do
with the forest fund data is settled by your agreement with the GIS operator,
not by this repository.
