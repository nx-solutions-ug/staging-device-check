# Layout rules (`layout()`)

`layout(opts)` measures the current page in one in-page function and returns one result per rule:
`{ rule, outcome, detail }`.

- `outcome` is `bestanden`, `nicht bestanden` or `nicht prüfbar hier`.
- `detail` is German, with the measured numbers.
- Each rule has a 1 px tolerance.
- A rule whose element is absent is left out: no action bar, no R3/R4.
- Before measuring it waits, at most about 6 s, until the page is at rest: the requested elements' boxes, the
  visual viewport and the scroll position agree twice in a row, no finite animation runs on them, and every one
  that takes room is shown (an action bar with a shown button). Not at rest by then: every rule is
  `nicht bestanden`, with "Seite kam in … s nicht zur Ruhe (…)" in front. The iOS keyboard phase does not wait.
- It first looks for the consent banner (`consentButton`) and dismisses it.

```ts
const results = await layout({
  header: 'header', // required: the sticky header
  actionBar: '.bottom-bar', // the pinned bottom action bar, if the step has one
  footer: '.bottom-bar', // what makes up the bottom space (R1)
  top: '.avatar, .bubble', // elements that must start below the header (R2)
  selectedRow: '[aria-selected="true"]', // a selected picker row (R7)
  actionButton: 'button[type=submit]', // the bar's action button, when the bar has several
  keyboard: false, // true: evaluate the keyboard phase (focused field)
});
```

| Rule  | Checks                                                 | Measured as                                                                |
| ----- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| R1    | No needless scrolling after a step change              | `maxScroll − footerHeight ≤ 1`                                             |
| start | The step starts at the top                             | `scrollY ≤ 1`                                                              |
| R2    | Top elements are not hidden under the header           | every `top` element: `top ≥ header.bottom`                                 |
| R3    | Nothing overlaps the pinned action bar at the page end | no content element intersects the bar (checked after scrolling to the end) |
| R4    | The action button is visible                           | `top ≥ vv.offsetTop − 1` and `bottom ≤ vv.offsetTop + vv.height + 1`       |
| R5    | No horizontal overflow                                 | `scrollWidth − innerWidth ≤ 1`                                             |
| R6    | Tap targets are large enough                           | interactive controls ≥ 44 × 44 px; inline text links excluded              |
| R7    | The selected picker row is visible                     | between `header.bottom` and the action button's (or bar's) top             |

- **Keyboard phase** (`keyboard: true`): on Android, R3/R4 run with the on-screen keyboard open. On iOS, every rule
  of that phase is `nicht prüfbar hier`, because Playwright opens no on-screen keyboard there.
- **Use the rules only on steps that have the element they measure.** Assert them with `expect.soft` so one failing
  rule does not hide the others.
- A rule that fails means a measured layout problem. Anything about look or feel is a screenshot with a
  `'zu prüfen'` annotation instead.
