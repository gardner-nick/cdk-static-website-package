import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { WebsiteBucket, WebsiteBucketProps } from './bucket';
import { WebsiteCloudFront } from './cloudfront';
import { WebsiteRoute53 } from './route53';

export interface StaticWebsiteProps {
  readonly stackPrefix: string;
  readonly envType: string;
  readonly hostedZone: string;
  readonly subDomain?: string;
  /** Countries allowed to reach the distribution; `false` serves every country. @default ['US', 'CA'] */
  readonly allowedCountries?: string[] | false;
  readonly acmCertArn?: string;
  readonly createAcmCert?: boolean;
  readonly wildcard?: boolean;
  /**
   * Rewrite origin 403/404 responses to `/index.html` with a 200. Disable when
   * attaching non-SPA behaviors whose error statuses must pass through.
   * @default true
   */
  readonly spaFallback?: boolean;
  /** CloudFront Functions for the default (S3) behavior only. */
  readonly defaultBehaviorFunctionAssociations?: cloudfront.FunctionAssociation[];
  /**
   * Origin bucket overrides — encryption, TLS enforcement, public-access
   * blocking, removal policy, bucket naming. Defaults preserve the historical
   * behavior; see {@link WebsiteBucketProps}.
   */
  readonly bucketProps?: WebsiteBucketProps;
  /**
   * Response headers policy for the default behavior — the hook for a Content
   * Security Policy. Nothing is attached by default.
   */
  readonly responseHeadersPolicy?: cloudfront.IResponseHeadersPolicy;
  /** Edge locations to serve from; `PRICE_CLASS_100` (NA + EU) is cheapest. */
  readonly priceClass?: cloudfront.PriceClass;
  readonly httpVersion?: cloudfront.HttpVersion;
  readonly cachePolicy?: cloudfront.ICachePolicy;
  readonly allowedMethods?: cloudfront.AllowedMethods;
  readonly compress?: boolean;
  /** How long CloudFront caches the SPA fallback response. */
  readonly errorResponseTtl?: cdk.Duration;
}

export class StaticWebsite extends Construct {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly certificate: acm.ICertificate;
  public readonly hostedZoneRef: route53.IHostedZone;

  constructor(scope: Construct, id: string, props: StaticWebsiteProps) {
    super(scope, id);

    const hasArn = !!props.acmCertArn;
    const wantsCreate = props.createAcmCert === true;
    if (hasArn === wantsCreate) {
      throw new Error(
        'StaticWebsite: exactly one of `acmCertArn` or `createAcmCert: true` must be set',
      );
    }
    if (!props.hostedZone) {
      throw new Error('StaticWebsite: `hostedZone` is required');
    }

    const { stackPrefix, envType } = props;

    this.hostedZoneRef = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.hostedZone,
    });

    const websiteBucket = new WebsiteBucket(
      this,
      `${stackPrefix}-bucket-${envType}`,
      props.bucketProps,
    );
    this.bucket = websiteBucket.bucket;

    const websiteCloudFront = new WebsiteCloudFront(this, `${stackPrefix}-distribution-${envType}`, {
      bucket: websiteBucket.bucket,
      hostedZone: props.hostedZone,
      subDomain: props.subDomain,
      allowedCountries: props.allowedCountries,
      acmCertArn: props.acmCertArn,
      createAcmCert: props.createAcmCert,
      hostedZoneRef: this.hostedZoneRef,
      wildcard: props.wildcard,
      spaFallback: props.spaFallback,
      defaultBehaviorFunctionAssociations: props.defaultBehaviorFunctionAssociations,
      responseHeadersPolicy: props.responseHeadersPolicy,
      priceClass: props.priceClass,
      httpVersion: props.httpVersion,
      cachePolicy: props.cachePolicy,
      allowedMethods: props.allowedMethods,
      compress: props.compress,
      errorResponseTtl: props.errorResponseTtl,
    });
    this.distribution = websiteCloudFront.distribution;
    this.certificate = websiteCloudFront.certificate;

    new WebsiteRoute53(this, `${stackPrefix}-route53-${envType}`, {
      hostedZone: props.hostedZone,
      distribution: websiteCloudFront.distribution,
      subDomain: props.subDomain,
      hostedZoneRef: this.hostedZoneRef,
      wildcard: props.wildcard,
    });
  }
}
