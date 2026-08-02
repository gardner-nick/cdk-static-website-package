import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { StaticWebsite, StaticWebsiteProps } from '../lib/modules/static-website';

const TEST_ENV = { account: '111122223333', region: 'us-east-1' };

function synth(propsOverrides: Partial<StaticWebsiteProps> = {}) {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', { env: TEST_ENV });
  new StaticWebsite(stack, 'Site', {
    stackPrefix: 'test',
    envType: 'test',
    hostedZone: 'example.com',
    subDomain: 'www',
    acmCertArn: 'arn:aws:acm:us-east-1:111122223333:certificate/abcd-1234',
    ...propsOverrides,
  });
  return Template.fromStack(stack);
}

describe('StaticWebsite', () => {
  test('creates a private S3 bucket with BLOCK_ACLS', () => {
    const template = synth();
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
      },
    });
  });

  test('creates a CloudFront distribution with US/CA geo-restriction and SPA error responses', () => {
    const template = synth();
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['www.example.com'],
        Restrictions: {
          GeoRestriction: {
            RestrictionType: 'whitelist',
            Locations: ['US', 'CA'],
          },
        },
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' }),
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' }),
        ]),
      }),
    });
  });

  test('redirects HTTP viewers to HTTPS on the default behavior', () => {
    const template = synth();
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
        }),
      }),
    });
  });

  test('allowedCountries override is respected', () => {
    const template = synth({ allowedCountries: ['US', 'CA', 'GB'] });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Restrictions: {
          GeoRestriction: {
            RestrictionType: 'whitelist',
            Locations: ['US', 'CA', 'GB'],
          },
        },
      }),
    });
  });

  test('creates a Route53 A-record aliased to the distribution', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Type: 'A',
      Name: 'www.example.com.',
      AliasTarget: Match.objectLike({
        DNSName: Match.anyValue(),
      }),
    });
  });

  test('uses the apex when subDomain is omitted', () => {
    const template = synth({ subDomain: undefined });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['example.com'],
      }),
    });
  });

  test('createAcmCert: true provisions a DNS-validated certificate', () => {
    const template = synth({ acmCertArn: undefined, createAcmCert: true });
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'www.example.com',
      ValidationMethod: 'DNS',
    });
  });

  test('imports the cert when acmCertArn is supplied (no Certificate resource created)', () => {
    const template = synth();
    template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
  });

  test('wildcard: true adds the zone-level wildcard alias to the distribution', () => {
    const template = synth({ wildcard: true });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['www.example.com', '*.example.com'],
      }),
    });
  });

  test('wildcard: true adds the zone-level wildcard SAN to a created certificate', () => {
    const template = synth({ acmCertArn: undefined, createAcmCert: true, wildcard: true });
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'www.example.com',
      SubjectAlternativeNames: ['*.example.com'],
      ValidationMethod: 'DNS',
    });
  });

  test('wildcard: true creates a zone-level wildcard A-record alongside the base record', () => {
    const template = synth({ wildcard: true });
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Type: 'A',
      Name: '*.example.com.',
      AliasTarget: Match.objectLike({ DNSName: Match.anyValue() }),
    });
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Type: 'A',
      Name: 'www.example.com.',
    });
  });

  test('wildcard on the apex (no subDomain) uses *.<hostedZone>', () => {
    const template = synth({ subDomain: undefined, wildcard: true });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['example.com', '*.example.com'],
      }),
    });
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Type: 'A',
      Name: '*.example.com.',
    });
  });

  test('no wildcard alias or record when wildcard is omitted', () => {
    const template = synth();
    template.resourceCountIs('AWS::Route53::RecordSet', 1);
  });

  test('sets index.html as the default root object', () => {
    const template = synth();
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
      }),
    });
  });

  test('spaFallback: false omits the SPA custom error responses', () => {
    const template = synth({ spaFallback: false });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.absent(),
      }),
    });
  });

  test('defaultBehaviorFunctionAssociations attaches to the default behavior only', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack', { env: TEST_ENV });
    const fn = new cloudfront.Function(stack, 'RewriteFn', {
      code: cloudfront.FunctionCode.fromInline('function handler(event) { return event.request; }'),
    });
    new StaticWebsite(stack, 'Site', {
      stackPrefix: 'test',
      envType: 'test',
      hostedZone: 'example.com',
      subDomain: 'www',
      acmCertArn: 'arn:aws:acm:us-east-1:111122223333:certificate/abcd-1234',
      spaFallback: false,
      defaultBehaviorFunctionAssociations: [
        { function: fn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
      ],
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: [
            Match.objectLike({ EventType: 'viewer-request' }),
          ],
        }),
      }),
    });
  });

  test('bucketProps are forwarded to the origin bucket', () => {
    const template = synth({
      bucketProps: {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      },
    });
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    });
    template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' });
  });

  /**
   * The one override whose effect is invisible in every other assertion here:
   * StaticWebsite otherwise always names the bucket `test-bucket-test`, so a
   * regression in the `false` passthrough would leave the suite green.
   */
  test('bucketProps.bucketName: false leaves the name to CloudFormation', () => {
    synth({ bucketProps: { bucketName: false } }).hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.absent(),
    });
  });

  test('omitting bucketProps keeps the historical bucket configuration', () => {
    const template = synth();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'test-bucket-test',
      BucketEncryption: Match.absent(),
    });
    template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Delete' });
  });

  test('throws when neither acmCertArn nor createAcmCert is set', () => {
    expect(() => synth({ acmCertArn: undefined })).toThrow(
      /exactly one of `acmCertArn` or `createAcmCert: true`/,
    );
  });

  test('throws when both acmCertArn and createAcmCert are set', () => {
    expect(() => synth({ createAcmCert: true })).toThrow(
      /exactly one of `acmCertArn` or `createAcmCert: true`/,
    );
  });
});
