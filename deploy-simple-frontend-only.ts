#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as aws from 'aws-sdk';
import { IskRagChatSystemSimpleFrontendStack } from './lib/isk-rag-chat-system-simple-frontend-stack';

async function main() {
  const app = new cdk.App();

  // 環境設定
  const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-northeast-1'
  };

  // CloudFormation から Backend スタックの出力値を取得
  const cloudformation = new aws.CloudFormation({ region: 'ap-northeast-1' });

  try {
    const backendStack = await cloudformation.describeStacks({
      StackName: 'IskRagChatSystemSimpleBackend'
    }).promise();

    const outputs = backendStack.Stacks?.[0]?.Outputs || [];

    const userPoolId = outputs.find(o => o.OutputKey === 'UserPoolId')?.OutputValue || '';
    const userPoolClientId = outputs.find(o => o.OutputKey === 'UserPoolClientId')?.OutputValue || '';
    const apiGatewayUrl = outputs.find(o => o.OutputKey === 'ApiGatewayUrl')?.OutputValue || '';

    if (!userPoolId || !userPoolClientId || !apiGatewayUrl) {
      throw new Error('Backend stack outputs not found. Please deploy backend stack first.');
    }

    // Frontend Stack
    const frontendStack = new IskRagChatSystemSimpleFrontendStack(app, 'IskRagChatSystemSimpleFrontend', {
      env,
      userPoolId,
      userPoolClientId,
      apiGatewayUrl
    });

    console.log('Backend outputs found:');
    console.log('- UserPoolId:', userPoolId);
    console.log('- UserPoolClientId:', userPoolClientId);
    console.log('- ApiGatewayUrl:', apiGatewayUrl);

    app.synth();
  } catch (error) {
    console.error('Error getting backend stack outputs:', error);
    process.exit(1);
  }
}

main().catch(console.error);