# Contributing

The project is small and the rules are few. Most of them exist because
something went wrong once.

## Getting it running

```bash
git clone https://github.com/fedyunin/forestplant-desktop.git
cd forestplant-desktop
npm install
npm test          # passes without any data or credentials
npm start         # the application; asks for a data folder on first launch
```

Node 22 or newer. `npm test` and `npm run lint` need neither a database nor a
GIS account — the core is pure functions over fixtures on purpose, so a change
can be checked without a six-hour sync.

To work against real data you need either a GIS account (`FP_USER`, `FP_PASS`
for the command line) or a data folder someone has already synced. The second
is enough for everything except the download code itself.

## What a change should come with

**Tests and style pass.** `npm test`, `npm run lint`. CI runs both on every
push and pull request, plus a grep for hardcoded passwords.

**A field-recognition change comes with the real field name.** Every rule in
[`src/core/fields.js`](src/core/fields.js) is there because some region spells
a column differently. Four times a wrong guess silently produced plausible
output — files written, objects in place, numbers labelled, all wrong. So a
change to how roles are resolved needs a case in
[`test/fields.test.js`](test/fields.test.js) carrying the actual name from the
actual layer, not an invented example. The table of what those four mistakes
cost is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Core code stays free of Electron.** Nothing under `src/core/` may import
`electron`. That is what keeps it testable with `node --test` and usable from
the command line.

**No credentials, anywhere.** Not in code, not in tests, not in a fixture, not
in an issue. They belong in the system keychain or in `FP_USER` / `FP_PASS`.
Anything that reaches the git history stays there.

**The raw archive stays authoritative.** `raw/` is the lossless original and
the database is derived from it. A change may rebuild the database from the
archive; nothing may write back the other way.

## Commit messages

A subject line that says what changed, and a body that says why — what the old
behaviour was, what it cost, and what the numbers are if there are numbers.
`git log` is the reasoning record for this project, and it reads like one.
Look at a few entries before writing the first.

## Pull requests

Open one against `main`. Say what problem it solves and how you checked it —
on which region, on how many objects, whether the file actually opened in
Google Earth or QGIS. «Works on my data» is a fine answer when it says which
data.

For anything large, open an issue first. The data has enough peculiarities
that a design conversation is usually shorter than a rewrite.

## Reporting a problem with the data

The most useful reports name the layer. A stand that lost its number, a
forestry that did not link to its blocks, a region whose count looks a
twenty-seventh too small — all of these have happened, and all of them were
found by someone who knew the territory noticing the number was wrong.

Include the region and forestry, what you expected, and what you got. A
screenshot of the field-schema screen in Settings helps: it shows which column
took which role.

Security-shaped problems go to [SECURITY.md](SECURITY.md) instead, not to a
public issue.

## Licence

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE) that covers the project.
