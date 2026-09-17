# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org);
while the major is 0 a minor bump is where breaking changes live.

Installers for every version are on the
[releases page](https://github.com/fedyunin/forestplant-desktop/releases).

## [Unreleased]

- Releases publish themselves. A `v*` tag now builds the four installers and
  puts out a finished Release rather than a draft waiting on a button, and its
  notes are this file's section for that version. The practical consequence:
  the changelog entry has to exist **before** the tag is pushed.

## [0.4.1] — 2026-09-17

**The repository is open, and the application moved to Electron 44.**

- Published under the [MIT licence](LICENSE), with the documents an open
  project needs: contributing guide, security policy, code of conduct, issue
  and pull request templates, and this changelog.
- **Electron 43 → 44. Requires macOS 13 (Ventura) or later** — Electron 44
  dropped macOS 12 in step with Chromium, so `minimumSystemVersion` is now
  declared and Monterey is told why rather than failing at startup. Windows is
  unaffected: the 32-bit target Electron also dropped was never built here.
- Checked before shipping, because the checks in CI never launch the
  application: the window self-check passes against the real 1.4-million-object
  database, and `better-sqlite3` rebuilds for both macOS architectures under
  the new runtime.
- **A Linux build.** `electron-builder.yml` had declared an AppImage target
  all along, but no job ever built it; the release workflow now builds on
  Ubuntu alongside macOS and Windows. One file, no package manager, runs after
  a `chmod +x`.
- eslint 10.10, globals 17.12 in development.

v0.4.0 was tagged and built, but never published: it went out before the Linux
build existed, and there was no reason to ship the same release twice.

## [0.3.0] — 2026-09-14

**Two more export formats: GeoJSON and CSV.** KML is for looking at data in
Google Earth and a poor way to hand it to someone else. GeoJSON opens in QGIS
and ArcGIS with no plugin; CSV is the table without geometry, for Excel and
reports.

- Both formats write straight to the file descriptor, feature by feature, so a
  region does not become a gigabyte-long string in memory before the first byte
  reaches the disk. One forestry: GeoJSON 10 MB in 206 ms, CSV 347 KB in 90 ms.
- CSV carries the delimiter and the UTF-8 BOM that Excel on a Russian-language
  Windows needs, and neutralises values that would otherwise execute as
  formulas in a spreadsheet.
- The size estimate is per format: KML splits on a vertex budget, GeoJSON takes
  a whole forestry however big, CSV holds no geometry to count. Each format
  says what to count and words the line above the button itself.

[Full diff](https://github.com/fedyunin/forestplant-desktop/compare/v0.2.1...v0.3.0)

## [0.2.1] — 2026-09-14

Workflow maintenance. Every action moved to its Node 24 major — checkout v7,
setup-node v7, upload-artifact v7, download-artifact v8, action-gh-release v3 —
because the runners were forcing the Node 20 runtime onto Node 24 with a
deprecation warning on every run. The release exists to take the publish path
end to end, since that job only runs on a tag.

[Full diff](https://github.com/fedyunin/forestplant-desktop/compare/v0.2.0...v0.2.1)

## [0.2.0] — 2026-09-14

**Whole-region picking, per-layer switches and label templates.**

- Region and agency rows in the forestry tree are pickable themselves: one
  click takes a whole region.
- The five KML layers — stand polygons, stand labels, block polygons, block
  labels, forestry outline — switch on and off separately. An overview map of a
  region needs none of the detail and loads in seconds without it.
- Labels follow a preset or a template of your own (`{kv}-{vd} {poroda}`), with
  a preview for colours and line widths.

[Full diff](https://github.com/fedyunin/forestplant-desktop/compare/v0.1.0...v0.2.0)

## [0.1.0] — 2026-08-23

First release. Sync from the GIS into a local SQLite database with a lossless
`raw/` archive beside it, browsing and querying with filters and SQL, KML
export with automatic splitting on Google Earth's 250 000-vertex limit, field
schemas resolved by pattern across the system's ten different naming
conventions, and an interface in Russian, English and Kazakh. macOS and
Windows installers built on GitHub Actions.

[Unreleased]: https://github.com/fedyunin/forestplant-desktop/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/fedyunin/forestplant-desktop/releases/tag/v0.4.1
[0.3.0]: https://github.com/fedyunin/forestplant-desktop/releases/tag/v0.3.0
[0.2.1]: https://github.com/fedyunin/forestplant-desktop/releases/tag/v0.2.1
[0.2.0]: https://github.com/fedyunin/forestplant-desktop/releases/tag/v0.2.0
[0.1.0]: https://github.com/fedyunin/forestplant-desktop/releases/tag/v0.1.0
