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
  // webAclArn: wafStack.webAclArn, // 一時的にWAFを無効化
  userPoolId: 'ap-northeast-1_zG065zZXu', // 実際の値を直接指定
  userPoolClientId: '320evpoao9264eh5ounfq8c313', // 実際の値を直接指定
  apiGatewayUrl: 'https://s54esmcz1j.execute-api.ap-northeast-1.amazonaws.com/prod/' // 実際の値を直接指定
});

// スタック間依存関係
frontendStack.addDependency(backendStack);
frontendStack.addDependency(wafStack);