import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { WebsiteCloudFront, WebsiteCloudFrontProps } from '../lib/modules/cloudfront';

const TEST_ENV = { account: '111122223333', region: 'us-east-1' };
const CERT_ARN = 'arn:aws:acm:us-east-1:111122223333:certificate/abcd-1234';

function synth(overrides: Partial<WebsiteCloudFrontProps> = {}) {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', { env: TEST_ENV });
  const bucket = new s3.Bucket(stack, 'OriginBucket');
  new WebsiteCloudFront(stack, 'Dist', {
    bucket,
    hostedZone: 'example.com',
    acmCertArn: CERT_ARN,
    ...overrides,
  });
  return Template.fromStack(stack);
}

/** The `DefaultCacheBehavior` of the single distribution in the template. */
function defaultBehavior(template: Template) {
  const dist = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0];
  return dist.Properties.DistributionConfig.DefaultCacheBehavior;
}

describe('WebsiteCloudFront', () => {
  /**
   * These props are additive: every default reproduces what 0.2.x synthesized,
   * which for most of them means leaving the property off the template entirely
   * so CloudFront's own default applies.
   */
  describe('defaults (0.2.x compatibility)', () => {
    test('attaches no response headers policy', () => {
      expect(defaultBehavior(synth()).ResponseHeadersPolicyId).toBeUndefined();
    });

    test('sets no price class, and leaves http version at CDK’s http2', () => {
      const config = Object.values(synth().findResources('AWS::CloudFront::Distribution'))[0]
        .Properties.DistributionConfig;
      expect(config.PriceClass).toBeUndefined();
      // CDK always emits HttpVersion; omitting the prop yields its own default.
      expect(config.HttpVersion).toEqual('http2');
    });

    test('keeps the US/CA geo allowlist', () => {
      synth().hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          Restrictions: {
            GeoRestriction: { RestrictionType: 'whitelist', Locations: ['US', 'CA'] },
          },
        }),
      });
    });

    /**
     * Not symmetrical, and the asymmetry is the point: CDK materialises its own
     * `cachePolicy` and `compress` defaults into the template even when the
     * props are omitted, while `allowedMethods` is left off entirely. Pinning
     * the emitted values is what makes the override tests below meaningful —
     * an override asserting the *default* value would pass while unwired.
     */
    test('cache policy and compression fall through to CDK’s defaults', () => {
      const behavior = defaultBehavior(synth());
      // The managed CACHING_OPTIMIZED policy id — CDK's default, not ours.
      expect(behavior.CachePolicyId).toEqual('658327ea-f89d-4fab-a63d-7e88639e58f6');
      expect(behavior.Compress).toBe(true);
      expect(behavior.AllowedMethods).toBeUndefined();
    });

    test('SPA fallback carries no explicit TTL', () => {
      const config = Object.values(synth().findResources('AWS::CloudFront::Distribution'))[0]
        .Properties.DistributionConfig;
      expect(config.CustomErrorResponses).toEqual([
        { ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' },
        { ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' },
      ]);
    });
  });

  describe('overrides', () => {
    test('responseHeadersPolicy attaches to the default behavior', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', { env: TEST_ENV });
      const bucket = new s3.Bucket(stack, 'OriginBucket');
      const policy = new cloudfront.ResponseHeadersPolicy(stack, 'Headers', {
        securityHeadersBehavior: {
          contentSecurityPolicy: { contentSecurityPolicy: "default-src 'none'", override: true },
        },
      });
      new WebsiteCloudFront(stack, 'Dist', {
        bucket,
        hostedZone: 'example.com',
        acmCertArn: CERT_ARN,
        responseHeadersPolicy: policy,
      });
      const template = Template.fromStack(stack);
      expect(defaultBehavior(template).ResponseHeadersPolicyId).toBeDefined();
      template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
        ResponseHeadersPolicyConfig: Match.objectLike({
          SecurityHeadersConfig: Match.objectLike({
            ContentSecurityPolicy: Match.objectLike({
              ContentSecurityPolicy: "default-src 'none'",
            }),
          }),
        }),
      });
    });

    test('priceClass and httpVersion reach the distribution', () => {
      synth({
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      }).hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          PriceClass: 'PriceClass_100',
          HttpVersion: 'http2and3',
        }),
      });
    });

    /**
     * Each value here is deliberately *not* CDK's default (see the defaults
     * block): CACHING_OPTIMIZED and `compress: true` are what an unwired prop
     * would produce anyway, so asserting those would prove nothing.
     */
    test('cachePolicy, allowedMethods and compress reach the default behavior', () => {
      const behavior = defaultBehavior(
        synth({
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          compress: false,
        }),
      );
      // The managed CACHING_DISABLED policy id.
      expect(behavior.CachePolicyId).toEqual('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
      expect(behavior.AllowedMethods).toEqual(['GET', 'HEAD', 'OPTIONS']);
      expect(behavior.Compress).toBe(false);
    });

    test('errorResponseTtl applies to every SPA fallback response', () => {
      const config = Object.values(
        synth({ errorResponseTtl: cdk.Duration.minutes(5) }).findResources(
          'AWS::CloudFront::Distribution',
        ),
      )[0].Properties.DistributionConfig;
      expect(config.CustomErrorResponses).toEqual([
        { ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html', ErrorCachingMinTTL: 300 },
        { ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html', ErrorCachingMinTTL: 300 },
      ]);
    });

    /**
     * `false` and `undefined` mean opposite things here, which is the whole
     * reason the prop is `string[] | false` rather than an optional array.
     */
    test('allowedCountries: false removes the geo restriction entirely', () => {
      const config = Object.values(
        synth({ allowedCountries: false }).findResources('AWS::CloudFront::Distribution'),
      )[0].Properties.DistributionConfig;
      expect(config.Restrictions).toBeUndefined();
    });

    test('allowedCountries: [] is rejected rather than silently allowing nothing', () => {
      expect(() => synth({ allowedCountries: [] })).toThrow();
    });

    /**
     * The only interaction these props introduce: `responseHeadersPolicy` and
     * `defaultBehaviorFunctionAssociations` both attach to the same default
     * behavior. They're independent fields, so this is a regression guard
     * against one clobbering the other rather than a suspected bug.
     */
    test('responseHeadersPolicy coexists with a function association', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'TestStack', { env: TEST_ENV });
      const bucket = new s3.Bucket(stack, 'OriginBucket');
      const policy = new cloudfront.ResponseHeadersPolicy(stack, 'Headers', {
        securityHeadersBehavior: {
          contentSecurityPolicy: { contentSecurityPolicy: "default-src 'none'", override: true },
        },
      });
      const fn = new cloudfront.Function(stack, 'Rewrite', {
        code: cloudfront.FunctionCode.fromInline('function handler(e) { return e.request; }'),
      });
      new WebsiteCloudFront(stack, 'Dist', {
        bucket,
        hostedZone: 'example.com',
        acmCertArn: CERT_ARN,
        responseHeadersPolicy: policy,
        defaultBehaviorFunctionAssociations: [
          { function: fn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      });

      const behavior = defaultBehavior(Template.fromStack(stack));
      expect(behavior.ResponseHeadersPolicyId).toBeDefined();
      // FunctionARN is an unresolved Fn::GetAtt at synth time.
      expect(behavior.FunctionAssociations).toEqual([
        { EventType: 'viewer-request', FunctionARN: expect.anything() },
      ]);
    });

    test('errorResponseTtl is ignored when spaFallback is off', () => {
      const config = Object.values(
        synth({ spaFallback: false, errorResponseTtl: cdk.Duration.minutes(5) }).findResources(
          'AWS::CloudFront::Distribution',
        ),
      )[0].Properties.DistributionConfig;
      expect(config.CustomErrorResponses).toBeUndefined();
    });
  });
});
