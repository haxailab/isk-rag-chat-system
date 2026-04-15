#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { IskRagChatSystemSimpleFrontendStack } from '../lib/isk-rag-chat-system-simple-frontend-stack';

const app = new cdk.App();

// 環境設定
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'ap-northeast-1'
};

// バックエンドスタックから取得した値（CDK Contextから動的に取得）
const BACKEND_OUTPUTS = {
  userPoolId: app.node.tryGetContext('userPoolId') || 'REPLACE_ME',
  userPoolClientId: app.node.tryGetContext('userPoolClientId') || 'REPLACE_ME',
  apiGatewayUrl: app.node.tryGetContext('apiGatewayUrl') || 'REPLACE_ME'
};

// Frontend Stack（独立デプロイ版）
const frontendStack = new IskRagChatSystemSimpleFrontendStack(app, 'IskRagChatSystemSimpleFrontend', {
  env,
  userPoolId: BACKEND_OUTPUTS.userPoolId,
  userPoolClientId: BACKEND_OUTPUTS.userPoolClientId,
  apiGatewayUrl: BACKEND_OUTPUTS.apiGatewayUrl
});

// タグ付け
cdk.Tags.of(app).add('Project', 'ISK-RAG-Chat-Simple');
cdk.Tags.of(app).add('Environment', 'Development');
cdk.Tags.of(app).add('Version', 'Simple-v1.0-Frontend');

app.synth();