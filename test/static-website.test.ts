import * as cdk from 'aws-cdk-lib';
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
