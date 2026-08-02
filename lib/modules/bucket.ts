import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface WebsiteBucketProps {
  /**
   * Explicit bucket name. S3 names are globally unique, so a fixed name can
   * collide with another account's bucket and fail the deploy. Pass `false` to
   * let CloudFormation generate a name derived from the stack and logical id.
   *
   * `false` trades one failure mode for another: the generated name follows the
   * construct path, so renaming the construct id (via `stackPrefix`/`envType` on
   * `StaticWebsite`) changes the logical id and CloudFormation *replaces* the
   * bucket — discarding its contents under the default `removalPolicy: DESTROY`.
   *
   * The default is only lowercased, not sanitized: an id containing `_` or other
   * characters S3 disallows fails at synth. Ids must already be legal S3 names.
   * @default the construct id, lowercased
   */
  readonly bucketName?: string | false;
  /**
   * @default BlockPublicAccess.BLOCK_ACLS — blocks public ACLs but still allows
   * a public *bucket policy*. Pass `BLOCK_ALL` to deny both; with CloudFront
   * OAC nothing needs public access.
   */
  readonly blockPublicAccess?: s3.BlockPublicAccess;
  /** @default none — objects are stored unencrypted unless the account sets a default. */
  readonly encryption?: s3.BucketEncryption;
  /** Deny non-TLS requests via a bucket policy condition. @default false */
  readonly enforceSSL?: boolean;
  /**
   * @default RemovalPolicy.DESTROY — suitable for redeployable site assets. Use
   * `RETAIN` for anything you cannot reproduce from CI.
   */
  readonly removalPolicy?: cdk.RemovalPolicy;
  /** Empty the bucket on delete. Requires `removalPolicy: DESTROY`. @default false */
  readonly autoDeleteObjects?: boolean;
}

export class WebsiteBucket extends Construct {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: WebsiteBucketProps = {}) {
    super(scope, id);

    // Every default below reproduces the pre-0.2.0 hardcoded behavior, so
    // existing callers that pass no props synthesize an unchanged template.
    const bucketName = props.bucketName ?? id.toLowerCase();

    this.bucket = new s3.Bucket(this, id, {
      bucketName: bucketName === false ? undefined : bucketName,
      publicReadAccess: false,
      blockPublicAccess: props.blockPublicAccess ?? s3.BlockPublicAccess.BLOCK_ACLS,
      encryption: props.encryption,
      enforceSSL: props.enforceSSL,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.autoDeleteObjects,
    });
  }
}
