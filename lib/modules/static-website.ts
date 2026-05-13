import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { WebsiteBucket } from './bucket';
import { WebsiteCloudFront } from './cloudfront';
import { WebsiteRoute53 } from './route53';

export interface StaticWebsiteProps {
  readonly stackPrefix: string;
  readonly envType: string;
  readonly hostedZone: string;
  readonly subDomain?: string;
  readonly allowedCountries?: string[];
  readonly acmCertArn?: string;
  readonly createAcmCert?: boolean;
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

    const websiteBucket = new WebsiteBucket(this, `${stackPrefix}-bucket-${envType}`);
    this.bucket = websiteBucket.bucket;

    const websiteCloudFront = new WebsiteCloudFront(this, `${stackPrefix}-distribution-${envType}`, {
      bucket: websiteBucket.bucket,
      hostedZone: props.hostedZone,
      subDomain: props.subDomain,
      allowedCountries: props.allowedCountries,
      acmCertArn: props.acmCertArn,
      createAcmCert: props.createAcmCert,
      hostedZoneRef: this.hostedZoneRef,
    });
    this.distribution = websiteCloudFront.distribution;
    this.certificate = websiteCloudFront.certificate;

    new WebsiteRoute53(this, `${stackPrefix}-route53-${envType}`, {
      hostedZone: props.hostedZone,
      distribution: websiteCloudFront.distribution,
      subDomain: props.subDomain,
      hostedZoneRef: this.hostedZoneRef,
    });
  }
}
