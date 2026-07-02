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
  readonly allowedCountries?: string[];
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
      },
      geoRestriction: cloudfront.GeoRestriction.allowlist(...countries),
      comment: id,
      domainNames,
      certificate: this.certificate,
      defaultRootObject: 'index.html',
      errorResponses:
        props.spaFallback === false
          ? undefined
          : [
              { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
              { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
            ],
      enableLogging: false,
    });
  }
}
