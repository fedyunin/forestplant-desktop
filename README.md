# Forest Fund — export to KML

A desktop application: it pulls forest fund data out of the GIS
`forestplant.gharysh.kz`, keeps it locally, and hands selections over as KML
for Google Earth.

The GIS itself offers no export, and the services directory is switched off by
the administrator — the data cannot be taken from there by ordinary means.

The interface speaks English and Russian; the language is chosen in Settings
and follows the system by default.

## Quick start

```bash
npm install
npm run sync      # fetch from the server and build the database (hours on the first run)
npm start         # the application
```

The application asks for the credentials itself and stores them in the system
keychain. For the command line, set `FP_USER` and `FP_PASS`.

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

## Building

```bash
npm run dist       # macOS (DMG for Apple Silicon and Intel) + Windows (installer)
npm run dist:mac
npm run dist:win
```

The finished files land in `dist/`. Pushing a `v*` tag builds them on GitHub
and attaches them to a draft Release.

There is no signing with a real certificate, so on the first launch:
- **macOS** — right-click the app, «Open», confirm once;
- **Windows** — in the SmartScreen warning press «More info» and «Run anyway».

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
src/exporters/    export formats, KML first
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

**Export** — search over the forestries, colours and line widths with a
preview, and an estimate of «how many stands, how many vertices, how many
files» before the run.

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
