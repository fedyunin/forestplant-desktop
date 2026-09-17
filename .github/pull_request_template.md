## What and why

<!-- What problem this solves. If the old behaviour was wrong, say what it
     cost — that is the part that matters in six months. -->

## How it was checked

<!-- Which region or forestry, how many objects, whether the file actually
     opened in Google Earth / QGIS / Excel. Numbers if there are numbers. -->

- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] A change to field recognition carries a test with the real field name
      that prompted it
- [ ] No credentials in the code, the tests or the fixtures
- [ ] `src/core/` still imports no Electron
