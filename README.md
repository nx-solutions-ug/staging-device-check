# staging-device-check

Claude Code plugin: Lässt Claude ein Jira-Ticket auf echten Handys über BrowserStack gegen Staging testen.

`/tests-e2e <TICKET>` runs Playwright through `browserstack-node-sdk`, configured from the tester's own
`browserstack.yml`, against the ticket's app host on the staging system.

## Install

```text
/plugin marketplace add nx-solutions-ug/staging-device-check
/plugin install staging-device-check@staging-device-check
```

## Development

```bash
bun install
bun run test         # bun test
bun run lint         # oxlint
bun run format:check # oxfmt
bun run type-check   # tsc --noEmit
bun run build        # tsup -> plugins/staging-device-check/dist
```

Design and plan: `docs/superpowers/`.

## License

MIT
