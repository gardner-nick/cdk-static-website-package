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
    const countries = props.allowedCountries ?? ['US', 'CA'];

    if (hasArn) {
      this.certificate = acm.Certificate.fromCertificateArn(this, 'Cert', props.acmCertArn!);
    } else {
      const zone =
        props.hostedZoneRef ??
        route53.HostedZone.fromLookup(this, 'CertZoneLookup', { domainName: props.hostedZone });
      this.certificate = new acm.Certificate(this, 'Cert', {
        domainName: domain,
        validation: acm.CertificateValidation.fromDns(zone),
      });
    }

    this.distribution = new cloudfront.Distribution(this, id, {
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(props.bucket),
      },
      geoRestriction: cloudfront.GeoRestriction.allowlist(...countries),
      comment: id,
      domainNames: [domain],
      certificate: this.certificate,
      errorResponses: [
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      enableLogging: false,
    });
  }
}
