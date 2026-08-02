# @gardner-nick/cdk-static-website

AWS CDK v2 constructs for static websites. Provisions S3 + CloudFront + Route53 with sensible defaults (private bucket via OAC, SPA-style 403/404 rewrites, geo-restricted to US/CA, ACM cert).

Use the `StaticWebsite` construct standalone for a pure static site, or compose it with your own backend constructs (API Gateway, Lambda, etc.) in a single stack.

## Install

```sh
npm install @gardner-nick/cdk-static-website
npm install --save-peer aws-cdk-lib constructs
```

`aws-cdk-lib` and `constructs` are peer dependencies — your consuming CDK app provides them.

## Quick start

```ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StaticWebsite } from '@gardner-nick/cdk-static-website';

class MySiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new StaticWebsite(this, 'Site', {
      stackPrefix: 'mysite',
      envType: 'prod',
      hostedZone: 'example.com',
      subDomain: 'www',
      acmCertArn: 'arn:aws:acm:us-east-1:111122223333:certificate/abcd-1234',
    });
  }
}
```

### Prerequisites

- A Route53 hosted zone for your domain in the same AWS account.
- An ACM certificate **in `us-east-1`** (CloudFront requirement) covering the domain — either supply `acmCertArn`, or set `createAcmCert: true` to have the construct provision one (see below).

### Defaults worth knowing

- **Geo-restriction is US + CA only.** Override with `allowedCountries: ['US', 'CA', 'GB', ...]` if you need a wider audience.
- **SPA error rewrites:** 403 and 404 from the origin both rewrite to `/index.html` with a 200, which is what client-side routers expect. These are distribution-wide — if you attach additional behaviors (e.g. an `/api/*` path via `distribution.addBehavior`) whose error statuses must reach the viewer untouched, set `spaFallback: false` and scope the fallback to the S3 behavior with a viewer-request function via `defaultBehaviorFunctionAssociations` instead.
- **`index.html` is the default root object**, so `https://<domain>/` serves the SPA shell without relying on the error rewrites.
- **Bucket removal policy is `DESTROY`.** Suitable for static site assets redeployed from CI; don't store anything you can't reproduce.
- **Bucket name = `<stackPrefix>-bucket-<envType>`.** S3 bucket names are globally unique, so pick a `stackPrefix` unlikely to collide — or set `bucketProps: { bucketName: false }` to let CloudFormation generate one (but see the caveat under [Hardening the bucket](#hardening-the-bucket) before you do).
- **Public access blocking is `BLOCK_ACLS`,** which blocks public ACLs but still permits a public bucket *policy*. Nothing needs public access when reading through CloudFront OAC, so `bucketProps: { blockPublicAccess: BlockPublicAccess.BLOCK_ALL }` is the stricter choice.
- **No bucket encryption or TLS enforcement by default.** See `bucketProps` below.

## Hardening the bucket

`bucketProps` forwards to the origin bucket. Every option defaults to the historical behavior, so omitting it changes nothing.

```ts
import { BlockPublicAccess, BucketEncryption } from 'aws-cdk-lib/aws-s3';

new StaticWebsite(this, 'Site', {
  stackPrefix: 'mysite',
  envType: 'prod',
  hostedZone: 'example.com',
  acmCertArn: '<arn>',
  bucketProps: {
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    encryption: BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    bucketName: false,
  },
});
```

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `bucketName` | `string \| false` | construct id, lowercased | Explicit name; `false` lets CloudFormation generate one (avoids global-uniqueness collisions, but ties the bucket to the construct path — see below) |
| `blockPublicAccess` | `s3.BlockPublicAccess` | `BLOCK_ACLS` | `BLOCK_ALL` also denies public bucket policies |
| `encryption` | `s3.BucketEncryption` | none | e.g. `S3_MANAGED` for SSE-S3 |
| `enforceSSL` | `boolean` | `false` | Adds a bucket policy denying non-TLS requests |
| `removalPolicy` | `cdk.RemovalPolicy` | `DESTROY` | `RETAIN` to survive stack deletion |
| `autoDeleteObjects` | `boolean` | `false` | Empty the bucket on delete; requires `DESTROY` |

### `bucketName: false` ties the bucket to the construct path

A generated name is derived from the CloudFormation logical id, which is derived from the construct path. Renaming `stackPrefix` or `envType` therefore changes the logical id, and CloudFormation responds by **replacing the bucket** — which under the default `removalPolicy: DESTROY` discards whatever was in it. A fixed `bucketName` survives such a rename; a generated one does not.

So `false` is the right choice when you deploy the same construct to several accounts and global uniqueness is the binding constraint, and the wrong choice when `stackPrefix`/`envType` are values you expect to revise. The default (`<stackPrefix>-bucket-<envType>`) is only lowercased, not sanitized: an id containing `_`, or any other character S3 disallows, fails at synth rather than at deploy.

## Security headers

No response headers policy is attached by default, so a site that relies on a Content Security Policy must pass one. `responseHeadersPolicy` attaches to the default (S3) behavior:

```ts
import { Duration } from 'aws-cdk-lib';
import {
  HeadersFrameOption,
  PriceClass,
  ResponseHeadersPolicy,
} from 'aws-cdk-lib/aws-cloudfront';

const securityHeaders = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
  securityHeadersBehavior: {
    contentSecurityPolicy: {
      contentSecurityPolicy: ["default-src 'none'", "script-src 'self'"].join('; '),
      override: true,
    },
    contentTypeOptions: { override: true },
    frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
    strictTransportSecurity: {
      accessControlMaxAge: Duration.days(365),
      includeSubdomains: true,
      override: true,
    },
  },
});

new StaticWebsite(this, 'Site', {
  stackPrefix: 'mysite',
  envType: 'prod',
  hostedZone: 'example.com',
  acmCertArn: '<arn>',
  responseHeadersPolicy: securityHeaders,
  priceClass: PriceClass.PRICE_CLASS_100,
  allowedCountries: false,
  errorResponseTtl: Duration.minutes(5),
});
```

`allowedCountries: false` is worth calling out: the default is a US/CA allowlist, which is the wrong shape for most public sites but cannot be changed without silently widening access for existing callers.

## Auto-creating the ACM certificate

If you don't already have a cert, set `createAcmCert: true` and omit `acmCertArn`. The construct creates an `acm.Certificate` validated via DNS against the hosted zone.

```ts
new StaticWebsite(this, 'Site', {
  stackPrefix: 'mysite',
  envType: 'prod',
  hostedZone: 'example.com',
  subDomain: 'www',
  createAcmCert: true,
});
```

**Region requirement:** because CloudFront requires the cert in `us-east-1`, the **stack containing `StaticWebsite` must be deployed to `us-east-1`** when `createAcmCert` is true. If your app lives elsewhere, create the cert in a separate `us-east-1` stack and pass its ARN as `acmCertArn` instead.

Exactly one of `acmCertArn` or `createAcmCert: true` must be set — the construct throws at synth time if both or neither are provided.

## Wildcard subdomains

Set `wildcard: true` to serve every subdomain of the hosted zone from the same distribution — useful for multi-tenant sites (one distinguished subdomain like `admin` plus a catch-all for per-tenant subdomains) or per-branch preview URLs that all point at the same bucket.

```ts
new StaticWebsite(this, 'Site', {
  stackPrefix: 'mysite',
  envType: 'prod',
  hostedZone: 'example.com',
  subDomain: 'admin',
  wildcard: true,
  createAcmCert: true,
});
```

The wildcard is always at the **hosted-zone level** (`*.example.com`), regardless of `subDomain`. Relative to the non-wildcard setup this adds:

- `*.example.com` as an extra CloudFront alias, alongside `admin.example.com` (a single-label ACM/CloudFront wildcard covers the subdomain itself too).
- A second `*` A-record at the zone in Route53, aliased to the distribution.
- When `createAcmCert: true`, `*.example.com` as a SAN on the generated certificate.

**If you supply `acmCertArn` instead**, the imported certificate must already cover both names (e.g. issued for `*.example.com` with `admin.example.com` as a SAN, or vice versa) — CloudFront rejects aliases the cert doesn't cover at deploy time. The construct can't verify this at synth.

Two caveats:

- ACM wildcard certs and CloudFront wildcard aliases cover a **single label** (`app.example.com`, not `a.b.example.com`). The wildcard DNS record matches *any* depth (per RFC 4592), so deeper names still resolve to the distribution — visitors hitting one get a TLS certificate mismatch or a CloudFront error rather than NXDOMAIN. For the same reason, a multi-label `subDomain` (e.g. `a.b`) is **not** covered by the zone-level wildcard cert — supply a cert that covers it explicitly.
- Because the wildcard sits at the zone level, only one distribution per zone can use it: CloudFront aliases are globally unique.

> **Changed in 0.1.3:** `wildcard: true` with a `subDomain` previously produced `*.<subDomain>.<zone>`; it now produces `*.<zone>`. The no-`subDomain` behavior is unchanged.

## Adding a backend

`StaticWebsite` is a `Construct`, not a `Stack` — drop it into any stack alongside your own resources:

```ts
import { StaticWebsite } from '@gardner-nick/cdk-static-website';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';

class FullSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new StaticWebsite(this, 'Site', {
      stackPrefix: 'app',
      envType: 'prod',
      hostedZone: 'example.com',
      subDomain: 'www',
      acmCertArn: '<arn>',
    });

    const api = new lambda.Function(this, 'Api', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
    });

    new apigw.LambdaRestApi(this, 'ApiGateway', { handler: api });
  }
}
```

## API

### `StaticWebsite`

Composed construct that wires bucket + distribution + DNS record.

| Prop | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `stackPrefix` | `string` | yes | — | Resource name prefix (becomes part of the S3 bucket name, which is globally unique — pick something unlikely to collide) |
| `envType` | `string` | yes | — | Environment label, e.g. `test`, `prod` |
| `hostedZone` | `string` | yes | — | Apex domain (must exist in Route53) |
| `subDomain` | `string` | no | `''` | Subdomain; empty for apex |
| `acmCertArn` | `string` | one of | — | Existing ACM cert ARN in `us-east-1` |
| `createAcmCert` | `boolean` | one of | `false` | Create a new DNS-validated cert (stack must be in `us-east-1`) |
| `allowedCountries` | `string[] \| false` | no | `['US', 'CA']` | CloudFront geo-allowlist; `false` serves every country |
| `wildcard` | `boolean` | no | `false` | Also serve `*.<hostedZone>` from the same distribution (see above) |
| `spaFallback` | `boolean` | no | `true` | Distribution-wide 403/404 → `/index.html` rewrites; disable when adding non-SPA behaviors |
| `defaultBehaviorFunctionAssociations` | `cloudfront.FunctionAssociation[]` | no | — | CloudFront Functions attached to the default (S3) behavior only |
| `bucketProps` | `WebsiteBucketProps` | no | — | Origin bucket overrides — see [Hardening the bucket](#hardening-the-bucket) |
| `responseHeadersPolicy` | `cloudfront.IResponseHeadersPolicy` | no | — | Security headers / CSP on the default behavior — see [Security headers](#security-headers) |
| `priceClass` | `cloudfront.PriceClass` | no | CloudFront's | `PRICE_CLASS_100` (NA + EU) is cheapest |
| `httpVersion` | `cloudfront.HttpVersion` | no | CloudFront's | e.g. `HTTP2_AND_3` |
| `cachePolicy` | `cloudfront.ICachePolicy` | no | CloudFront's | e.g. `CACHING_OPTIMIZED` |
| `allowedMethods` | `cloudfront.AllowedMethods` | no | CloudFront's | e.g. `ALLOW_GET_HEAD_OPTIONS` |
| `compress` | `boolean` | no | CloudFront's | Automatic object compression |
| `errorResponseTtl` | `cdk.Duration` | no | — | How long the SPA fallback response is cached |

Exposes `bucket: s3.Bucket` and `distribution: cloudfront.Distribution` for further customization.

### Lower-level constructs

`WebsiteBucket`, `WebsiteCloudFront`, `WebsiteRoute53` are also exported if you want to wire them up yourself.

`WebsiteBucket` takes the same `WebsiteBucketProps` as `bucketProps` above, and is the one worth using standalone — it's the only sub-construct with no domain requirement. Use it when you need a CloudFront distribution this package can't express (no custom domain, a custom `ResponseHeadersPolicy`, a specific price class) but still want the bucket configured consistently:

```ts
import { WebsiteBucket } from '@gardner-nick/cdk-static-website';

const { bucket } = new WebsiteBucket(this, 'SiteBucket', {
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  encryption: BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  bucketName: false,
});
// ...then build your own Distribution over `bucket`.
```

Note that `WebsiteCloudFront` requires `hostedZone` plus a certificate — it cannot produce a distribution served only from its `*.cloudfront.net` domain.

> **Added in 0.2.0:** `WebsiteBucketProps` and `StaticWebsite`'s `bucketProps`. Purely additive — every default reproduces 0.1.x, so a no-props upgrade synthesizes an identical template.

> **Added in 0.3.0:** distribution overrides — `responseHeadersPolicy`, `priceClass`, `httpVersion`, `cachePolicy`, `allowedMethods`, `compress`, `errorResponseTtl` — plus `allowedCountries: false` to drop the geo restriction. Additive on the same terms: verified against the published 0.2.0 build, a no-props `StaticWebsite` synthesizes an identical template.

## Releasing

Tag pushes matching `v*.*.*` trigger `.github/workflows/publish.yml`, which builds, tests, and publishes to npm with provenance.

```sh
npm version patch   # or minor / major
git push --follow-tags
```

Requires the `NPM_TOKEN` repo secret (npmjs.com → Access Tokens → Automation token). The workflow refuses to publish if the tag and `package.json` version disagree.
