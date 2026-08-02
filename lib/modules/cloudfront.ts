import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

export interface WebsiteCloudFrontProps {
  readonly bucket: s3.Bucket;
  readonly hostedZone: string;
  readonly subDomain?: string;
  /**
   * Countries allowed to reach the distribution. Pass `false` to serve every
   * country — an allowlist is the wrong default for a public marketing site,
   * but changing the default would silently widen access for existing callers.
   * @default ['US', 'CA']
   */
  readonly allowedCountries?: string[] | false;
  readonly acmCertArn?: string;
  readonly createAcmCert?: boolean;
  readonly hostedZoneRef?: route53.IHostedZone;
  readonly wildcard?: boolean;
  /**
   * Rewrite origin 403/404 responses to `/index.html` with a 200 — what
   * client-side routers expect. CloudFront custom error responses are
   * distribution-wide: disable this if you attach non-SPA behaviors to the
   * distribution (e.g. an `/api/*` path) whose error statuses must reach the
   * viewer untouched, and scope the fallback to the default behavior with a
   * viewer-request function via `defaultBehaviorFunctionAssociations` instead.
   * @default true
   */
  readonly spaFallback?: boolean;
  /**
   * CloudFront Functions to associate with the default (S3) behavior only —
   * e.g. a viewer-request SPA rewrite when `spaFallback` is disabled.
   */
  readonly defaultBehaviorFunctionAssociations?: cloudfront.FunctionAssociation[];
  /**
   * Response headers policy for the default behavior — the hook for a Content
   * Security Policy and the other security headers. Nothing is attached by
   * default, so a site relying on a CSP must pass one.
   * @default none
   */
  readonly responseHeadersPolicy?: cloudfront.IResponseHeadersPolicy;
  /**
   * Edge locations to serve from. `PRICE_CLASS_100` (NA + EU) is the cheapest.
   * @default PriceClass.PRICE_CLASS_ALL — CloudFront's own default
   */
  readonly priceClass?: cloudfront.PriceClass;
  /** @default HttpVersion.HTTP2 — CloudFront's own default */
  readonly httpVersion?: cloudfront.HttpVersion;
  /** @default CachePolicy.CACHING_OPTIMIZED — CloudFront's own default */
  readonly cachePolicy?: cloudfront.ICachePolicy;
  /**
   * Methods the default behavior accepts. The origin here is always a static
   * bucket, so anything past `ALLOW_GET_HEAD_OPTIONS` has nothing to reach.
   * @default AllowedMethods.ALLOW_GET_HEAD — CloudFront's own default
   */
  readonly allowedMethods?: cloudfront.AllowedMethods;
  /** Compress objects automatically. @default true — CloudFront's own default */
  readonly compress?: boolean;
  /**
   * How long CloudFront caches the SPA fallback response. Without a TTL an
   * error response is cached at CloudFront's default of 5 minutes anyway; set
   * this to make the window explicit. Ignored when `spaFallback` is false.
   * @default none — CloudFront's own error-caching default applies
   */
  readonly errorResponseTtl?: cdk.Duration;
}

export class WebsiteCloudFront extends Construct {
  public readonly distribution: cloudfront.Distribution;
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: WebsiteCloudFrontProps) {
    super(scope, id);

    const hasArn = !!props.acmCertArn;
    const wantsCreate = props.createAcmCert === true;
    if (hasArn === wantsCreate) {
      throw new Error(
        'WebsiteCloudFront: exactly one of `acmCertArn` or `createAcmCert: true` must be set',
      );
    }

    const subDomain = props.subDomain ?? '';
    const domain = subDomain !== '' ? `${subDomain}.${props.hostedZone}` : props.hostedZone;
    // The wildcard is always at the hosted-zone level (`*.example.com`, never
    // `*.www.example.com`): with a subDomain the alias set is
    // [sub.zone, *.zone] — the "one distinguished subdomain plus catch-all
    // tenant/preview subdomains" pattern. ACM/CloudFront wildcards cover a
    // single label, so `*.zone` also covers `sub.zone` itself.
    const wildcardDomain = `*.${props.hostedZone}`;
    const domainNames = props.wildcard ? [domain, wildcardDomain] : [domain];
    // `false` disables the restriction entirely; `undefined` keeps the historical
    // US/CA allowlist. Distinguishing them is why the type is `string[] | false`
    // rather than an empty array — `allowlist()` rejects zero countries anyway.
    const countries = props.allowedCountries ?? ['US', 'CA'];

    if (hasArn) {
      this.certificate = acm.Certificate.fromCertificateArn(this, 'Cert', props.acmCertArn!);
    } else {
      const zone =
        props.hostedZoneRef ??
        route53.HostedZone.fromLookup(this, 'CertZoneLookup', { domainName: props.hostedZone });
      this.certificate = new acm.Certificate(this, 'Cert', {
        domainName: domain,
        subjectAlternativeNames: props.wildcard ? [wildcardDomain] : undefined,
        validation: acm.CertificateValidation.fromDns(zone),
      });
    }

    this.distribution = new cloudfront.Distribution(this, id, {
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(props.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: props.defaultBehaviorFunctionAssociations,
        responseHeadersPolicy: props.responseHeadersPolicy,
        cachePolicy: props.cachePolicy,
        allowedMethods: props.allowedMethods,
        compress: props.compress,
      },
      geoRestriction: countries === false ? undefined : cloudfront.GeoRestriction.allowlist(...countries),
      comment: id,
      domainNames,
      certificate: this.certificate,
      defaultRootObject: 'index.html',
      priceClass: props.priceClass,
      httpVersion: props.httpVersion,
      errorResponses:
        props.spaFallback === false
          ? undefined
          : [404, 403].map((httpStatus) => ({
              httpStatus,
              responseHttpStatus: 200,
              responsePagePath: '/index.html',
              ttl: props.errorResponseTtl,
            })),
      enableLogging: false,
    });
  }
}
