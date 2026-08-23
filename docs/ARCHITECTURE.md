# ForestPlant Desktop — architecture

A desktop application that pulls forest fund data out of the GIS
`forestplant.gharysh.kz` (ArcGIS Server), keeps it locally and generates KML.

## Why

The web application of the system offers neither an export nor a services
directory — the data cannot be taken from there by ordinary means. The
application solves three problems:

1. **Take a complete snapshot** of the data while access exists, and keep it
   up to date.
2. **Store it locally** so that nothing is lost to a mistake in unification.
3. **Hand out selections as KML** with configurable styling, within the limits
   of Google Earth.

## Decisions, and why they are what they are

### Plain JavaScript on Electron, core free of Electron

One language, one build, one installer. Everything under `src/core/` runs on
plain Node with no Electron import, which is what makes it testable with
`node --test` and reusable from the command line.

### The raw archive is mandatory, the database is derived

`raw/layers/*.geojson.gz` plus `raw/_manifest.json` is the lossless original.
The database is rebuilt from the archive at any time; never the other way
round. Resuming a download and spotting changes both rest on the archive.

The practical consequence: **a mistake in unification needs no second trip to
the server.** That is the whole reason the archive is kept separately.

### Raw attributes are stored verbatim

The heavy half of an object lives in `feature_data`: the `props` column holds
the source attributes as they are, and `geom` the geometry. The canonical
columns (`lesnichestvo`, `kvartal`, `vydel`, `ploshad`, ...) sit on top of them
in `feature`. The canonical columns can be filled in wrongly; `props` cannot.

### Hot and cold columns live in different tables

Geometry takes 6.8 GB out of 11, and the raw attributes almost another
gigabyte. While everything sat in one table, a filter by species dragged
gigabytes of geometry it did not need off the disk: a query took 22 seconds.
`feature` now holds only what is searched on; `feature_data` is read when an
object is shown and when exporting.

The forestry tree (`forestry`) and the filter lookups (`facet`) are
materialised for the same reason: recomputing them over 1.4 million rows took
22 and 62 seconds respectively.

### Field roles are resolved by pattern, not by name

The system holds **10 different field schemas**. The stand number appears as
`НумерацияВыделов`, `Nвыд`, `NВыд`, `Нумерация_выделов`. The forestry as
`Лесничество` and `Лесничеств`. Nor does the layer type follow from the name:
in the North Kazakhstan region the stands are called `ВыдПород`,
`ВыдПород2_12`.

This caused silent bugs twice:

- a hardcoded `НумерацияВыделов` covered 266 layers out of 381 — in the other
  115 the label would have carried `OBJECTID` instead of the stand number;
- the «land category» role stole `КатегорияЗащитностиЛесныхЗемель` (the name
  holds both «категор» and «Земель»), and the real `КатегорияЛесныхЗемель` was
  lost.

The inconsistency in names broke the data **four times**, silently every time:

| What | Cost |
|---|---|
| `НумерацияВыделов` against `Nвыд` | 115 layers would carry OBJECTID instead of the stand number |
| `ВыдПород` instead of «Границы выделов» | 106 layers, +491 480 stands counted as «other» |
| `\b` in JS does not work on Cyrillic | blocks were not linked to forestries at all |
| `Лесни` and `Nквар` truncated | 59 layers, +203 809 stands; the Kostanay region was represented by one twenty-seventh of its data |

Not one of them raised an error: files were created, objects were in place,
numbers were labelled. All four were found only by checking the expected
against the actual.

**That is why field mapping is a screen of its own**, not a hidden constant.
The screen shows every schema, its roles and the number of objects under it.

### The download page size is settled by actual refusal

The server limits not the number of objects in an answer but its size. Four
hundred small stands it serves easily; thirty forestry boundary polygons of a
region it never serves, answering with an HTML error page instead of JSON. The
page size cannot be guessed ahead.

So: if a chunk fails, halve it and try again, down to a single object. Large
chunks are abandoned after two attempts and split at once; waiting patiently
only pays off on small ones, otherwise every level of splitting spends minutes
on a request that is hopeless anyway.

What that gave on the «Архивные данные» layer: 18 803 objects out of 19 203
before, 19 202 after. The single record the server refuses even one by one is
named explicitly and recorded in the manifest as knowingly unavailable —
otherwise the layer would be refetched forever for nothing.

### The timeout runs on its own timer, not on the request option

The `timeout` option of `https.request` is not applied to sockets reused by a
keepAlive agent. One hung request blocked the whole pool: a dump stood still
for 8 hours 25 minutes at zero CPU and fetched nothing.

The same follows for progress: it has to move **inside** a layer, not only when
the layer finishes. Otherwise a hang is indistinguishable from slow work.

### The Google Earth limit counts vertices, not objects

`Your file has too many vertices (287,793). The total number of vertices from
points, lines, and polygons cannot exceed 250,000.`

Coordinate points are counted, and every label is a point too. Splitting runs
on a vertex budget (240 000 by default). Blocks and the forestry outline go
into the first part only, so their weight is not counted again — and when they
alone would crowd out the stands, they move into a file of their own.

### The forestry boundary is computed, not taken ready

There is no usable ready layer of forestry boundaries on the server: in
`Granica_uchrezhdenii` the field names are mangled by an encoding error. The
outline is computed by merging the blocks — edges seen twice are interior and
are dropped.

Checked against real data: merging the stands of each block matched the actual
block polygon in 56 cases out of 59; the other three turned out to be blocks
made of two separate pieces, not an error. Microscopic sliver rings (43 out of
46 at Kaskelenskoe) are filtered out by their share of the area.

## The limits of what is possible

- **47 layers answer 403** — nurseries, tree plantings, seed harvesting per
  region. The account has no rights on the server. The UI must show this as an
  explicit «no access» line, or missing data looks like data that never
  existed.
- The «Вырубки по 2022» layer serves 18 803 objects out of the 19 203 declared.
- Layers of the Akmola region occasionally return a broken answer instead of
  JSON.

## Data schema

```
layer                       registry of layers
  key            TEXT PK    <service>_<MS|FS>_<id>
  kind           TEXT       vydel | kvartal | misc  -- by field composition
  oblast, service_url, layer_id, path, layer_name, geometry_type
  uchrezhdenie, lesnichestvo
  fields         JSON       source field names
  roles          JSON       role -> field name
  server_count, loaded_count, sha256

feature                     objects: only what is searched and sorted on
  id             INTEGER PK
  layer_key, kind
  oblast, uchrezhdenie, lesnichestvo, les_key, company
  kvartal, vydel             INTEGER
  ploshad                    REAL
  poroda, bonitet, tip_lesa, kat_zem, kat_zasch
  objectid, nvert
  minx, miny, maxx, maxy     bbox

feature_data                the heavy half, read on demand
  feature_id     INTEGER PK
  props          JSON        raw attributes, verbatim
  geom           JSON        GeoJSON geometry, WGS84

forestry                    materialised tree with counters and weights
facet                       materialised lookups for the filters
kvartal_link                blocks linked to forestries
```

Migrations are versioned through `PRAGMA user_version`; new steps are appended
to the list in `src/core/db.js`.

## Processes

```
main (Node)              window, IPC, access checks — nothing heavy
  └── utility: fast      browsing: the list, the table, one object, the estimate
  └── utility: heavy     the slow ones: SQL console, export, syncing, rebuild
renderer                 the UI only, sandbox: true, nodeIntegration: false
```

There are two worker processes, and that is not a luxury: one process handles
messages in order, so a heavy query held up everything else — a measurement
showed 3.8 seconds for an ordinary call while an SQL console query ran. SQLite
allows several readers, so both open the same database.

IPC runs through `contextBridge` over a closed list of channels, and the input
is validated in `src/main/ipc.js`. A strict CSP, no remote content.
Credentials go only through `safeStorage` (the system keychain), never into
configs or logs.

## Screens

1. **Data** — the object table, filters by block, stand, area, species and land
   category, an object card with the raw attributes, and SQL as a second way of
   building the same selection: a query returning an id column narrows the
   selection exactly as the filters do.
2. **Export** — search over the forestries, a style editor with a preview, the
   vertex budget and splitting, an index file of links.
3. **Settings** — the data folder, credentials, database management (checking
   for updates by fingerprints — count, max OBJECTID, max edit date — without
   downloading), the archive state and the field mapping screen. The interface
   language lives here too.

## Default styling

| Level | Colour | Width |
|---|---|---|
| Forestry boundary | `#FFD400` | 4.5 |
| Blocks | `#00A03C` | 2.6 |
| Stands | `#9400D3` | 1.2 |

The width grows with the hierarchy — otherwise the levels merge visually on an
overview.

## Labels

KML shows no labels on polygons — a limit of the format, not of the renderer. A
label is placed as an anchor point inside the outline with a transparent icon.

The anchor is not the centroid: on concave and ring-shaped figures the centroid
lands outside. First the centroid of the largest ring is taken, and when that
falls outside the polygon — the midpoint of the widest horizontal segment
inside the outline.

The check is mandatory and automated: across 9246 labels of four forestries —
not one miss.

## Interface language

The dictionary lives in `src/renderer/i18n.js`, and the markup carries the keys
in `data-i18n`. The language is chosen in Settings and follows `app.getLocale()`
by default. Text that reaches the exported files is chosen in the same way and
passed down to the exporter — the KML that a Russian-speaking forester opens
should not suddenly speak English.

The window self-check reads data attributes and numbers rather than the visible
text, so switching the language cannot break it.

## Quality

- ESLint over the whole repository, including the CI.
- `node --test`: outline merging, the label point, vertex counting, field
  resolution, splitting by budget, the language of the exported text.
- The window self-check `npm run smoke` on the running application: the table,
  the object card, search, SQL as a selection and as a report, the estimate
  agreeing with the selection, the window staying alive during a heavy query,
  the export estimate, and the language switch.
- CI: GitHub Actions — checks on every push, installers for macOS and Windows
  on a `v*` tag.
