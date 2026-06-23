import { Duration, NestedStack, NestedStackProps, Stack } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
} from "aws-cdk-lib/aws-s3";
import { RestApi } from "aws-cdk-lib/aws-apigateway";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

export interface IPublicDispositionsEdgeStackProps extends NestedStackProps {
  publicApi: RestApi;
  assetsBucketName: string;
  wafRateLimitPerFiveMinutes: number;
  logicalIdPrefix: string;
}

export class PublicDispositionsEdgeStack extends NestedStack {
  public readonly assetsBucket: Bucket;
  public readonly distribution: Distribution;
  public readonly publicApiWebAcl: wafv2.CfnWebACL;

  constructor(
    scope: Construct,
    id: string,
    props: IPublicDispositionsEdgeStackProps,
  ) {
    super(scope, id, props);

    const {
      publicApi,
      assetsBucketName,
      wafRateLimitPerFiveMinutes,
      logicalIdPrefix,
    } = props;

    this.assetsBucket = new Bucket(
      this,
      `${logicalIdPrefix}-PublicDispoAssets`,
      {
        bucketName: assetsBucketName,
        encryption: BucketEncryption.S3_MANAGED,
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        versioned: true,
      },
    );

    const apiOrigin = new HttpOrigin(
      `${publicApi.restApiId}.execute-api.${Stack.of(this).region}.${Stack.of(this).urlSuffix}`,
      {
        originPath: `/${publicApi.deploymentStage.stageName}`,
      },
    );

    this.distribution = new Distribution(
      this,
      `${logicalIdPrefix}-PublicDispoDistribution`,
      {
        defaultRootObject: "index.html",
        defaultBehavior: {
          origin: S3BucketOrigin.withOriginAccessControl(this.assetsBucket),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        additionalBehaviors: {
          "public/dispo/*": {
            origin: apiOrigin,
            allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
            cachePolicy: CachePolicy.CACHING_DISABLED,
            originRequestPolicy:
              OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          },
        },
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: Duration.minutes(1),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: Duration.minutes(1),
          },
        ],
      },
    );

    this.publicApiWebAcl = new wafv2.CfnWebACL(
      this,
      `${logicalIdPrefix}-PublicDispoApiWebAcl`,
      {
        name: `${logicalIdPrefix}-public-dispo-api-web-acl`,
        scope: "REGIONAL",
        defaultAction: { allow: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${logicalIdPrefix}-public-dispo-api-web-acl`,
          sampledRequestsEnabled: true,
        },
        rules: [
          {
            name: "AWSManagedCommonRuleSet",
            priority: 0,
            statement: {
              managedRuleGroupStatement: {
                vendorName: "AWS",
                name: "AWSManagedRulesCommonRuleSet",
              },
            },
            overrideAction: { none: {} },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${logicalIdPrefix}-managed-common`,
              sampledRequestsEnabled: true,
            },
          },
          {
            name: "RateLimitByIp",
            priority: 1,
            statement: {
              rateBasedStatement: {
                aggregateKeyType: "IP",
                limit: wafRateLimitPerFiveMinutes,
              },
            },
            action: { block: {} },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: `${logicalIdPrefix}-rate-limit`,
              sampledRequestsEnabled: true,
            },
          },
        ],
      },
    );

    new wafv2.CfnWebACLAssociation(
      this,
      `${logicalIdPrefix}-ExternalPublicApiWebAclAssoc`,
      {
        resourceArn: `arn:aws:apigateway:${Stack.of(this).region}::/restapis/${publicApi.restApiId}/stages/${publicApi.deploymentStage.stageName}`,
        webAclArn: this.publicApiWebAcl.attrArn,
      },
    );
  }
}
