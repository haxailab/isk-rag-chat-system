#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { IskRagChatSystemSimpleStack } from '../lib/isk-rag-chat-system-simple-stack';
import { IskRagChatSystemSimpleFrontendStack } from '../lib/isk-rag-chat-system-simple-frontend-stack';

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

// Backend Stack（認証・API・Claude直接呼び出し）
const backendStack = new IskRagChatSystemSimpleStack(app, 'IskRagChatSystemBackend', {
  env,
  allowedIpRanges: iskAllowedIpRanges
});

// Frontend Stack（CloudFront + S3）- シンプル版はap-northeast-1に配置
const frontendStack = new IskRagChatSystemSimpleFrontendStack(app, 'IskRagChatSystemFrontend', {
  env,
  userPoolId: backendStack.userPool.userPoolId,
  userPoolClientId: backendStack.userPoolClient.userPoolClientId,
  apiGatewayUrl: backendStack.apiGatewayUrl
});

// スタック間依存関係
frontendStack.addDependency(backendStack);

// タグ付け
cdk.Tags.of(app).add('Project', 'ISK-RAG-Chat-Simple');
cdk.Tags.of(app).add('Environment', 'Development');
cdk.Tags.of(app).add('Version', 'Simple-v1.0');

app.synth();