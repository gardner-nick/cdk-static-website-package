import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';

export interface WebsiteRoute53Props {
  readonly hostedZone: string;
  readonly distribution: cloudfront.Distribution;
  readonly subDomain?: string;
  readonly hostedZoneRef?: route53.IHostedZone;
}

export class WebsiteRoute53 extends Construct {
  public readonly zone: route53.IHostedZone;

  constructor(scope: Construct, id: string, props: WebsiteRoute53Props) {
    super(scope, id);

    this.zone =
      props.hostedZoneRef ??
      route53.HostedZone.fromLookup(this, `${id}-HostedZone`, {
        domainName: props.hostedZone,
      });

    new route53.ARecord(this, `${id}-Route53Record`, {
      zone: this.zone,
      recordName: props.subDomain,
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(props.distribution)),
    });
  }
}
