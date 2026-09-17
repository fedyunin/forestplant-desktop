# Security

## Reporting a vulnerability

Please do not open a public issue.

Use GitHub's private reporting —
[Report a vulnerability](https://github.com/fedyunin/forestplant-desktop/security/advisories/new) —
or write to <fedyunin@ipoint.ru>.

Say what you found, how to reproduce it, and what an attacker gets out of it.
Expect a first answer within a week. This is a small project with one
maintainer, so a fix takes as long as it takes, but you will be told where it
stands rather than left guessing.

## Supported versions

The latest release, and only it. There are no maintenance branches — fixes go
into the next tag.

## What this application does with secrets

Worth knowing before reporting, and worth preserving in any change:

- **The GIS password is held by the operating system**, encrypted through
  Electron's `safeStorage` — Keychain on macOS, DPAPI on Windows — and written
  to `credentials.json` in the application data folder with mode `0600`.
  Without the system store the application refuses to save it rather than
  falling back to plain text.
- **The password never reaches the renderer, a config file, or a log.** Only
  the user name and a «password saved» flag cross that boundary.
  ([`src/main/creds.js`](src/main/creds.js), [`src/main/ipc.js`](src/main/ipc.js))
- **`FP_USER` and `FP_PASS` override the stored pair** when set, for CI and
  debugging. Environment variables are visible to other processes of the same
  user — that is the trade-off, and it is why they are not the default path.
- **Tokens live for a day** and are held in memory only; an expired one is
  reissued on a 498/499 answer.
  ([`src/core/arcgis.js`](src/core/arcgis.js))
- **CI greps every push for hardcoded passwords**, because a secret that
  reaches the git history stays there.
  ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))

## What is out of scope

- **The GIS server itself.** Issues in `forestplant.gharysh.kz` belong to its
  operator, not here. Please do not send findings about the server to this
  repository, and please do not probe it on this project's account.
- **Unsigned builds.** The installers are ad-hoc signed and not notarized —
  that needs a paid Apple Developer ID. It is documented in the
  [README](README.md#download-a-build), not a finding.
- **Anything reachable only by a user who already controls the machine.** The
  data folder, the SQLite file and the exports are ordinary user files with no
  protection beyond the file system's.
