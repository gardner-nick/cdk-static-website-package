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
- **SPA error rewrites:** 403 and 404 from the origin both rewrite to `/index.html` with a 200, which is what client-side routers expect.
- **Bucket removal policy is `DESTROY`.** Suitable for static site assets redeployed from CI; don't store anything you can't reproduce.
- **Bucket name = `<stackPrefix>-bucket-<envType>`.** S3 bucket names are globally unique, so pick a `stackPrefix` unlikely to collide.

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
| `allowedCountries` | `string[]` | no | `['US', 'CA']` | CloudFront geo-allowlist |

Exposes `bucket: s3.Bucket` and `distribution: cloudfront.Distribution` for further customization.

### Lower-level constructs

`WebsiteBucket`, `WebsiteCloudFront`, `WebsiteRoute53` are also exported if you want to wire them up yourself.

## Releasing

Tag pushes matching `v*.*.*` trigger `.github/workflows/publish.yml`, which builds, tests, and publishes to npm with provenance.

```sh
npm version patch   # or minor / major
git push --follow-tags
```

Requires the `NPM_TOKEN` repo secret (npmjs.com → Access Tokens → Automation token). The workflow refuses to publish if the tag and `package.json` version disagree.
