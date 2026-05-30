# Contributing to @topolab/sdk

Thanks for your interest in improving the Topolab TypeScript SDK.

## Development setup

```bash
npm install
```

## Checks

```bash
npm test            # vitest (mocked with msw)
npm run typecheck   # tsc --noEmit
npm run build       # tsup — dual ESM/CJS + the /node subpath
```

Tests read shared golden fixtures from the sibling
[`topolab-sdk-spec`](../topolab-sdk-spec) repository — keep both checked out
side by side.

## Conventions

The public surface (method names, parameters, error types) is defined in
`topolab-sdk-spec/conventions.yaml` and enforced by `test/conventions.test.ts`.
If you change the public API, update the convention file in the same change so
all three SDKs stay aligned.

## Runtime support

Core methods target Node 18+ and modern browsers / edge runtimes. Anything that
touches the filesystem (e.g. `download`) lives under the `@topolab/sdk/node`
subpath so the main entry point stays browser-safe.

## Before opening a PR

- `npm test`, `npm run typecheck`, and `npm run build` all pass
- New behaviour has a test
- Public changes are reflected in `conventions.yaml` and the README

## Releasing

Releases are gated until publishing is enabled. The npm workflow publishes with
provenance and triggers on a published GitHub release.
