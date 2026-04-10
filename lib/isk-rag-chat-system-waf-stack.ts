import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

interface IskRagChatSystemWafStackProps extends cdk.StackProps {
  allowedIpRanges: string[];
}

export class IskRagChatSystemWafStack extends cdk.Stack {
  public readonly webAclArn: string;
  public readonly webAclId: string;

  constructor(scope: Construct, id: string, props: IskRagChatSystemWafStackProps) {
    super(scope, id, props);

    // IP許可リスト
    const ipSetV4 = new wafv2.CfnIPSet(this, 'AllowedIPSetV4', {
      name: 'isk-allowed-ips-v4',
      scope: 'CLOUDFRONT',
      ipAddressVersion: 'IPV4',
      addresses: props.allowedIpRanges,
      description: 'ISK company allowed IP address list'
    });

    // WAF Web ACL
    const webAcl = new wafv2.CfnWebACL(this, 'WebACL', {
      name: 'isk-rag-chat-waf',
      scope: 'CLOUDFRONT',
      defaultAction: { block: {} }, // デフォルトはブロック
      description: 'WAF for ISK RAG Chat System',
      rules: [
        {
          name: 'AllowISKIPs',
          priority: 1,
          action: { allow: {} },
          statement: {
            ipSetReferenceStatement: {
              arn: ipSetV4.attrArn
            }
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AllowISKIPs'
          }
        },
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
              excludedRules: []
            }
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSet'
          }
        },
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 3,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
              excludedRules: []
            }
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesKnownBadInputsRuleSet'
          }
        }
      ],
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'iskRagChatWAF'
      }
    });

    // WebACLがIPSetに依存することを明示的に設定
    webAcl.addDependency(ipSetV4);

    this.webAclArn = webAcl.attrArn;
    this.webAclId = webAcl.attrId;

    // Outputs
    new cdk.CfnOutput(this, 'WebAclId', {
      value: webAcl.attrId,
      description: 'WAF Web ACL ID'
    });

    new cdk.CfnOutput(this, 'WebAclArn', {
      value: this.webAclArn,
      description: 'WAF Web ACL ARN'
    });

    new cdk.CfnOutput(this, 'AllowedIPs', {
      value: props.allowedIpRanges.join(', '),
      description: '許可されたIPアドレス範囲'
    });
  }
}