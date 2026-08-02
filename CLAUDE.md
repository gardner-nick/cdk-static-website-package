# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — compile TypeScript (`tsc`) to `lib/**/*.js` + `*.d.ts`. Required before `npm test` after editing `.ts` sources only if you care about consumers; tests themselves run via `ts-jest` and don't need a prior build.
- `npm test` — runs Jest. Test files live in `test/` and match `**/*.test.ts`.
- Single test: `npx jest test/static-website.test.ts -t "creates a private S3 bucket"` (substring matches the `test(...)` name).
- `npm run watch` — `tsc -w` for incremental compilation while iterating.
- `npm run prepublishOnly` — build + test; runs automatically on `npm publish`.

There is no linter configured; TypeScript `strict: true` is the only static check.

## Architecture

This is a published npm package (`@gardner-nick/cdk-static-website`) of AWS CDK v2 constructs, not a CDK app — there is no `cdk.json`, no `bin/`, and `aws-cdk-lib` + `constructs` are **peer dependencies**, supplied by the consumer.

### Construct layering

`lib/index.ts` re-exports four constructs. Three are leaf building blocks; one composes them:

- `WebsiteBucket` (`lib/modules/bucket.ts`) — private S3 bucket, `BLOCK_ACLS`, `RemovalPolicy.DESTROY`. Bucket name is derived from the construct `id` (lowercased) — callers pass `${stackPrefix}-bucket-${envType}` as `id`.
- `WebsiteCloudFront` (`lib/modules/cloudfront.ts`) — CloudFront Distribution with OAC origin, geo-allowlist (defaults `['US', 'CA']`), and SPA error rewrites (403/404 → `/index.html` with 200). Owns the ACM cert: either imports from `acmCertArn` or creates a new DNS-validated `acm.Certificate`.
- `WebsiteRoute53` (`lib/modules/route53.ts`) — A-record alias to the distribution. Accepts an optional `hostedZoneRef` to avoid a duplicate `HostedZone.fromLookup`.
- `StaticWebsite` (`lib/modules/static-website.ts`) — the public surface most consumers use. Does one `HostedZone.fromLookup` and threads the `IHostedZone` to both `WebsiteCloudFront` (for DNS-validated cert) and `WebsiteRoute53` (for the A-record) via `hostedZoneRef`, so there's only one lookup per stack.

### Prop forwarding: flat vs nested

`StaticWebsite` exposes its children's options two different ways, and the split is deliberate:

- **Bucket options are nested** behind a single `bucketProps?: WebsiteBucketProps` (added in 0.2.0).
- **Distribution options are flat** — `responseHeadersPolicy`, `priceClass`, `httpVersion`, `cachePolicy`, `allowedMethods`, `compress`, `errorResponseTtl`, plus the older `allowedCountries`/`spaFallback`/`wildcard`/`defaultBehaviorFunctionAssociations` (added in 0.3.0).

The distribution is what consumers actually tune — a CSP, a cheaper price class, dropping the geo restriction are all common, whereas bucket overrides are the rare hardening case. Burying the common ones under `distributionProps` would cost every caller a nesting level to save the rare caller nothing. The bucket's options are also cohesive enough to name as a group; the distribution's aren't.

The cost is real: each flat prop is declared in **both** `WebsiteCloudFrontProps` and `StaticWebsiteProps` and forwarded by name in the `WebsiteCloudFront` constructor call, so adding one means four edits (both interfaces, the forwarding call, the README table). Keep the declaration order identical in both interfaces — that is what makes a missed forward visible in review. Mirror the leaf's `@default` tags into `StaticWebsiteProps` rather than cross-linking: both interfaces ship in the published `.d.ts`, and `StaticWebsite` is the one consumers hover.

Don't convert either side to match the other without a reason to; the asymmetry is the design, not drift.

### Cert mode invariant

Both `StaticWebsite` and `WebsiteCloudFront` enforce **exactly one** of `acmCertArn` (import existing) or `createAcmCert: true` (create new) at synth time. The check is `if (hasArn === wantsCreate) throw` — covers both "neither" and "both". When changing cert handling, keep this invariant in both constructs and the two corresponding `throws` tests.

### Region constraint

When `createAcmCert: true`, the consuming stack **must** be in `us-east-1` (CloudFront requires the cert there). The construct doesn't enforce this — it's documented in the README and is the consumer's responsibility.

## Testing

Tests use `aws-cdk-lib/assertions` (`Template.fromStack` + `Match`) to assert on synthesized CloudFormation, not real AWS. The shared `synth()` helper in `test/static-website.test.ts` takes partial prop overrides — follow that pattern for new tests rather than building stacks from scratch.

## Publishing

**The version in `package.json` on `main` is what triggers a release, and the tag is created by CI at the end — not by you.** `.github/workflows/publish.yml` runs on `workflow_run` after CI succeeds on `main` (or via `workflow_dispatch`):

1. Reads the version from `package.json` and checks whether `refs/tags/v<version>` already exists on the remote.
2. **If the tag exists, every remaining step is skipped** — that is the idempotency guard that lets this run after each `main` push.
3. Otherwise `npm ci` → `npm run build` → `npm test` → `npm publish --provenance --access public`.
4. Creates and pushes `v<version>` itself.

Release flow: bump `package.json` (and `package-lock.json`) in the PR, merge to `main`, and let CI publish.

Do **not** run `npm version` or push a `v*.*.*` tag by hand. Because step 2 skips when the tag is already present, tagging first doesn't just duplicate the tag — it makes the publish a silent no-op, and the release looks green while nothing ships. If a publish is genuinely missed, re-run via `workflow_dispatch`.

Auth is **OIDC Trusted Publishing**, configured on npmjs.com against the `prod` GitHub environment — there is no `NPM_TOKEN` secret, and provenance is implied. This needs npm >= 11.5.1, which is why the workflow installs `npm@^11.5.1` over the version bundled with Node 22; the pin is to a major because `npm@latest` moved to 12.x and broke the step with `EBADENGINE`.

`.npmignore` keeps `.ts` sources out of the published tarball (only `.d.ts` + `.js` from `lib/` ship, per `package.json` `files`).
