# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org);
while the major is 0 a minor bump is where breaking changes live.

Installers for every version are on the
[releases page](https://github.com/fedyunin/forestplant-desktop/releases).

## [Unreleased]

- The repository is public, under the [MIT licence](LICENSE).

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

[Unreleased]: https://github.com/fedyunin/forestplant-desktop/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/fedyunin/forestplant-desktop/releases/tag/v0.3.0
[0.2.1]: https://github.com/fedyunin/forestplant-desktop/releases/tag/v0.2.1
[0.2.0]: https://github.com/fedyunin/forestplant-desktop/releases/tag/v0.2.0
[0.1.0]: https://github.com/fedyunin/forestplant-desktop/releases/tag/v0.1.0
