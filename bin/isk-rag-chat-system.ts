#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { IskRagChatSystemStack } from '../lib/isk-rag-chat-system-stack';
import { IskRagChatSystemFrontendStack } from '../lib/isk-rag-chat-system-frontend-stack';
import { IskRagChatSystemWafStack } from '../lib/isk-rag-chat-system-waf-stack';

const app = new cdk.App();

// 環境設定
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'ap-northeast-1' // 東京リージョン固定
};

// ISKのIP範囲（例：実際のIPに置き換えてください）
const iskAllowedIpRanges = [
  '203.0.113.0/24', // ISK社のIPレンジ（例）
  '198.51.100.0/24' // VPNのIPレンジ（例）
];

// WAF Stack（CloudFrontより先に作成する必要があるためus-east-1に）
const wafStack = new IskRagChatSystemWafStack(app, 'IskRagChatSystemWaf', {
  env: { ...env, region: 'us-east-1' }, // CloudFront用WAFはus-east-1が必須
  allowedIpRanges: iskAllowedIpRanges
});

// Backend Stack（認証・API・RAG）
const backendStack = new IskRagChatSystemStack(app, 'IskRagChatSystemBackend', {
  env,
  allowedIpRanges: iskAllowedIpRanges
});

// Frontend Stack（CloudFront + S3）- WAFなしでまず動作確認
const frontendStack = new IskRagChatSystemFrontendStack(app, 'IskRagChatSystemFrontend', {
  env, // 同じリージョン（ap-northeast-1）を使用
  crossRegionReferences: true, // クロスリージョン参照を有効化
  // webAclArn: wafStack.webAclArn, // TODO: SSMパラメータ競合解消後に有効化
  userPoolId: backendStack.userPool.userPoolId,
  userPoolClientId: backendStack.userPoolClient.userPoolClientId,
  apiGatewayUrl: backendStack.apiGatewayUrl
});

// スタック間依存関係
frontendStack.addDependency(backendStack);
frontendStack.addDependency(wafStack);

// 標準タグの追加
cdk.Tags.of(app).add('Project', 'ISK-RAG-Chat');
cdk.Tags.of(app).add('Environment', 'Development');
cdk.Tags.of(app).add('Owner', 'ISK');