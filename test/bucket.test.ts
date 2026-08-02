import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { WebsiteBucket, WebsiteBucketProps } from '../lib/modules/bucket';

const TEST_ENV = { account: '111122223333', region: 'us-east-1' };

function synth(props?: WebsiteBucketProps) {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', { env: TEST_ENV });
  new WebsiteBucket(stack, 'SiteBucket', props);
  return Template.fromStack(stack);
}

describe('WebsiteBucket', () => {
  /**
   * The props argument is additive: every default reproduces what 0.1.x
   * hardcoded. If this drifts, existing callers get a resource diff on an
   * upgrade they expected to be a no-op.
   */
  describe('defaults (0.1.x compatibility)', () => {
    test('omitting props is accepted and names the bucket from the id', () => {
      synth().hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'sitebucket',
      });
    });

    test('blocks public ACLs but not public policies', () => {
      synth().hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
        },
      });
    });

    test('sets no encryption and no TLS enforcement', () => {
      const template = synth();
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: Match.absent(),
      });
      template.resourceCountIs('AWS::S3::BucketPolicy', 0);
    });

    test('removal policy is DESTROY with no auto-delete', () => {
      const template = synth();
      template.hasResource('AWS::S3::Bucket', {
        DeletionPolicy: 'Delete',
        UpdateReplacePolicy: 'Delete',
      });
      template.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
    });
  });

  describe('overrides', () => {
    test('blockPublicAccess: BLOCK_ALL denies public policies too', () => {
      synth({ blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL }).hasResourceProperties(
        'AWS::S3::Bucket',
        {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
        },
      );
    });

    test('encryption: S3_MANAGED sets SSE-S3', () => {
      synth({ encryption: s3.BucketEncryption.S3_MANAGED }).hasResourceProperties(
        'AWS::S3::Bucket',
        {
          BucketEncryption: {
            ServerSideEncryptionConfiguration: [
              { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
            ],
          },
        },
      );
    });

    test('enforceSSL adds a policy denying non-TLS requests', () => {
      const template = synth({ enforceSSL: true });
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Deny',
              Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            }),
          ]),
        }),
      });
    });

    test('removalPolicy: RETAIN survives stack deletion', () => {
      synth({ removalPolicy: cdk.RemovalPolicy.RETAIN }).hasResource('AWS::S3::Bucket', {
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
      });
    });

    test('autoDeleteObjects provisions the emptying custom resource', () => {
      synth({
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      }).resourceCountIs('Custom::S3AutoDeleteObjects', 1);
    });

    test('an explicit bucketName overrides the id-derived default', () => {
      synth({ bucketName: 'my-explicit-name' }).hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'my-explicit-name',
      });
    });

    /**
     * S3 names are globally unique, so a caller deploying the same construct to
     * several accounts needs to opt out of the fixed name entirely.
     */
    test('bucketName: false lets CloudFormation generate the name', () => {
      synth({ bucketName: false }).hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.absent(),
      });
    });
  });
});
