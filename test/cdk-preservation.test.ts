/**
 * CDK Preservation Property Tests
 *
 * These tests verify existing behaviors that MUST NOT change during bug fixes.
 * All tests should PASS on the current unfixed code (establishing a baseline).
 * After fixes are applied, re-running these tests confirms no regressions.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**
 */

import * as fs from 'fs';
import * as path from 'path';

// Helper: read source file content
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf-8');
}

// Source file paths
const MAIN_STACK = 'lib/isk-rag-chat-system-stack.ts';
const SIMPLE_STACK = 'lib/isk-rag-chat-system-simple-stack.ts';
const FRONTEND_STACK = 'lib/isk-rag-chat-system-frontend-stack.ts';
const SIMPLE_FRONTEND_STACK = 'lib/isk-rag-chat-system-simple-frontend-stack.ts';
const WAF_STACK = 'lib/isk-rag-chat-system-waf-stack.ts';

// ============================================================
// 3.1 Authenticated endpoints use Cognito Authorizer
// ============================================================
describe('3.1 Preservation: Authenticated endpoints use Cognito Authorizer', () => {

  test('main-stack: /chat endpoint uses Cognito authorization', () => {
    const src = readSource(MAIN_STACK);
    // The chat resource should have authorizer + COGNITO auth type
    expect(src).toContain("chatResource.addMethod('POST'");
    expect(src).toContain('authorizationType: apigateway.AuthorizationType.COGNITO');
  });

  test('main-stack: /file-upload (or /upload) endpoint uses Cognito authorization', () => {
    const src = readSource(MAIN_STACK);
    expect(src).toContain("fileUploadResource.addMethod('POST'");
    // Verify authorizer is used on file-upload
    const fileUploadSection = src.slice(
      src.indexOf("fileUploadResource.addMethod"),
      src.indexOf("fileUploadResource.addMethod") + 300
    );
    expect(fileUploadSection).toContain('authorizer');
    expect(fileUploadSection).toContain('AuthorizationType.COGNITO');
  });

  test('main-stack: /enhanced-chat endpoint uses Cognito authorization', () => {
    const src = readSource(MAIN_STACK);
    expect(src).toContain("enhancedChatResource.addMethod('POST'");
    const section = src.slice(
      src.indexOf("enhancedChatResource.addMethod"),
      src.indexOf("enhancedChatResource.addMethod") + 300
    );
    expect(section).toContain('authorizer');
    expect(section).toContain('AuthorizationType.COGNITO');
  });

  test('main-stack: /session endpoint uses Cognito authorization', () => {
    const src = readSource(MAIN_STACK);
    // Session resource has GET and DELETE with authorizer
    const sessionGetIdx = src.indexOf("sessionResource.addMethod('GET'");
    expect(sessionGetIdx).toBeGreaterThan(-1);
    const sessionGetSection = src.slice(sessionGetIdx, sessionGetIdx + 300);
    expect(sessionGetSection).toContain('authorizer');
  });

  test('main-stack: /access-log endpoint uses Cognito authorization', () => {
    const src = readSource(MAIN_STACK);
    expect(src).toContain("accessLogResource.addMethod('GET'");
    const section = src.slice(
      src.indexOf("accessLogResource.addMethod"),
      src.indexOf("accessLogResource.addMethod") + 300
    );
    expect(section).toContain('authorizer');
    expect(section).toContain('AuthorizationType.COGNITO');
  });

  test('simple-stack: /chat endpoint uses Cognito authorization', () => {
    const src = readSource(SIMPLE_STACK);
    expect(src).toContain("chatResource.addMethod('POST'");
    const chatIdx = src.indexOf("chatResource.addMethod('POST'");
    const section = src.slice(chatIdx, chatIdx + 300);
    expect(section).toContain('authorizer');
    expect(section).toContain('AuthorizationType.COGNITO');
  });

  test('simple-stack: /upload endpoint uses Cognito authorization', () => {
    const src = readSource(SIMPLE_STACK);
    expect(src).toContain("uploadResource.addMethod('POST'");
    const idx = src.indexOf("uploadResource.addMethod('POST'");
    const section = src.slice(idx, idx + 300);
    expect(section).toContain('authorizer');
    expect(section).toContain('AuthorizationType.COGNITO');
  });

  test('simple-stack: /analyze endpoint uses Cognito authorization', () => {
    const src = readSource(SIMPLE_STACK);
    expect(src).toContain("analyzeResource.addMethod('POST'");
    const idx = src.indexOf("analyzeResource.addMethod('POST'");
    const section = src.slice(idx, idx + 300);
    expect(section).toContain('authorizer');
    expect(section).toContain('AuthorizationType.COGNITO');
  });

  test('main-stack: CognitoUserPoolsAuthorizer is created', () => {
    const src = readSource(MAIN_STACK);
    expect(src).toContain('new apigateway.CognitoUserPoolsAuthorizer(');
    expect(src).toContain('cognitoUserPools: [this.userPool]');
  });

  test('simple-stack: CognitoUserPoolsAuthorizer is created', () => {
    const src = readSource(SIMPLE_STACK);
    expect(src).toContain('new apigateway.CognitoUserPoolsAuthorizer(');
    expect(src).toContain('cognitoUserPools: [this.userPool]');
  });
});


// ============================================================
// 3.2 Health check endpoint exists without authentication
// ============================================================
describe('3.2 Preservation: Health check endpoint exists without authentication', () => {

  test('main-stack: /health endpoint exists with MockIntegration', () => {
    const src = readSource(MAIN_STACK);
    expect(src).toContain("api.root.addResource('health'");
    expect(src).toContain('new apigateway.MockIntegration(');
  });

  test('main-stack: /health returns 200 status code', () => {
    const src = readSource(MAIN_STACK);
    // Find the health endpoint section and verify 200 response
    const healthIdx = src.indexOf("api.root.addResource('health'");
    expect(healthIdx).toBeGreaterThan(-1);
    const healthSection = src.slice(healthIdx, healthIdx + 800);
    expect(healthSection).toContain("statusCode: '200'");
    expect(healthSection).toContain('"status": "healthy"');
  });

  test('main-stack: /health does NOT use Cognito authorization', () => {
    const src = readSource(MAIN_STACK);
    const healthIdx = src.indexOf("api.root.addResource('health'");
    const healthSection = src.slice(healthIdx, healthIdx + 800);
    // Health endpoint should NOT have authorizer
    expect(healthSection).not.toContain('authorizer');
    expect(healthSection).not.toContain('AuthorizationType.COGNITO');
  });

  test('simple-stack: /health endpoint exists with MockIntegration', () => {
    const src = readSource(SIMPLE_STACK);
    expect(src).toContain("api.root.addResource('health'");
    expect(src).toContain('new apigateway.MockIntegration(');
  });

  test('simple-stack: /health returns 200 status code', () => {
    const src = readSource(SIMPLE_STACK);
    const healthIdx = src.indexOf("api.root.addResource('health'");
    expect(healthIdx).toBeGreaterThan(-1);
    const healthSection = src.slice(healthIdx, healthIdx + 800);
    expect(healthSection).toContain("statusCode: '200'");
    expect(healthSection).toContain('"status": "healthy"');
  });
});

// ============================================================
// 3.3 Lambda functions use Claude Sonnet 4 model
// ============================================================
describe('3.3 Preservation: Lambda functions use Claude Sonnet 4 model', () => {

  test('main-stack: Lambda functions reference Claude Sonnet 4 model via CLAUDE_MODEL_ID', () => {
    const src = readSource(MAIN_STACK);
    // Check that CLAUDE_MODEL_ID env var references claude-sonnet
    expect(src).toContain('CLAUDE_MODEL_ID');
    const modelMatches = src.match(/CLAUDE_MODEL_ID:\s*'([^']+)'/g);
    expect(modelMatches).not.toBeNull();
    // All model references should contain claude-sonnet or anthropic.claude-sonnet
    for (const match of modelMatches!) {
      const value = match.replace(/CLAUDE_MODEL_ID:\s*'/, '').replace(/'$/, '');
      expect(value).toMatch(/claude-sonnet/i);
    }
  });

  test('simple-stack: Lambda functions reference Knowledge Base for RAG', () => {
    const src = readSource(SIMPLE_STACK);
    // chatFunction and analysisReportFunction should have KNOWLEDGE_BASE_ID
    expect(src).toContain('KNOWLEDGE_BASE_ID');
  });
});

// ============================================================
// 3.4 Lambda functions reference Knowledge Base ID
// ============================================================
describe('3.4 Preservation: Lambda functions reference Knowledge Base ID', () => {

  test('main-stack: KNOWLEDGE_BASE_ID environment variable is set on Lambda functions', () => {
    const src = readSource(MAIN_STACK);
    const kbMatches = src.match(/KNOWLEDGE_BASE_ID:\s*'[^']+'/g);
    expect(kbMatches).not.toBeNull();
    expect(kbMatches!.length).toBeGreaterThanOrEqual(1);
  });

  test('simple-stack: KNOWLEDGE_BASE_ID environment variable is set on Lambda functions', () => {
    const src = readSource(SIMPLE_STACK);
    const kbMatches = src.match(/KNOWLEDGE_BASE_ID:\s*'[^']+'/g);
    expect(kbMatches).not.toBeNull();
    expect(kbMatches!.length).toBeGreaterThanOrEqual(1);
  });
});


// ============================================================
// 3.5 S3 temp bucket has lifecycle rules for auto-deletion
// ============================================================
describe('3.5 Preservation: S3 temp bucket has lifecycle rules', () => {

  test('main-stack: temp files bucket has lifecycle rule with expiration', () => {
    const src = readSource(MAIN_STACK);
    expect(src).toContain('lifecycleRules');
    expect(src).toContain('expiration: Duration.days(');
  });

  test('simple-stack: temp files bucket has 7-day lifecycle rule', () => {
    const src = readSource(SIMPLE_STACK);
    expect(src).toContain('lifecycleRules');
    expect(src).toContain('expiration: Duration.days(7)');
    expect(src).toContain('DeleteTempFilesAfter7Days');
  });
});

// ============================================================
// 3.6 CloudFront distribution configuration
// ============================================================
describe('3.6 Preservation: CloudFront distribution has HTTPS redirect, SPA routing, cache optimization', () => {

  test('frontend-stack: HTTPS redirect is configured', () => {
    const src = readSource(FRONTEND_STACK);
    expect(src).toContain('ViewerProtocolPolicy.REDIRECT_TO_HTTPS');
  });

  test('frontend-stack: SPA routing with 403 → index.html', () => {
    const src = readSource(FRONTEND_STACK);
    expect(src).toContain('httpStatus: 403');
    expect(src).toContain("responsePagePath: '/index.html'");
    expect(src).toContain('responseHttpStatus: 200');
  });

  test('frontend-stack: SPA routing with 404 → index.html', () => {
    const src = readSource(FRONTEND_STACK);
    expect(src).toContain('httpStatus: 404');
    // Both 403 and 404 redirect to index.html with 200
    const errorResponses = src.match(/httpStatus:\s*404[\s\S]*?responsePagePath:\s*'\/index\.html'/);
    expect(errorResponses).not.toBeNull();
  });

  test('frontend-stack: cache optimization is configured', () => {
    const src = readSource(FRONTEND_STACK);
    expect(src).toContain('CachePolicy.CACHING_OPTIMIZED');
    expect(src).toContain('compress: true');
  });

  test('simple-frontend-stack: HTTPS redirect is configured', () => {
    const src = readSource(SIMPLE_FRONTEND_STACK);
    expect(src).toContain('ViewerProtocolPolicy.REDIRECT_TO_HTTPS');
  });

  test('simple-frontend-stack: SPA routing with 403/404 → index.html', () => {
    const src = readSource(SIMPLE_FRONTEND_STACK);
    expect(src).toContain('httpStatus: 403');
    expect(src).toContain('httpStatus: 404');
    expect(src).toContain("responsePagePath: '/index.html'");
  });

  test('simple-frontend-stack: cache optimization is configured', () => {
    const src = readSource(SIMPLE_FRONTEND_STACK);
    expect(src).toContain('CachePolicy.CACHING_OPTIMIZED');
    expect(src).toContain('compress: true');
  });
});

// ============================================================
// 3.7 Cognito User Pool configuration
// ============================================================
describe('3.7 Preservation: Cognito User Pool has email/username sign-in, password policy, account recovery', () => {

  test('main-stack: email sign-in is enabled', () => {
    const src = readSource(MAIN_STACK);
    expect(src).toContain('signInAliases');
    expect(src).toContain('email: true');
  });

  test('main-stack: username sign-in is enabled', () => {
    const src = readSource(MAIN_STACK);
    expect(src).toContain('username: true');
  });

  test('main-stack: password policy is configured', () => {
    const src = readSource(MAIN_STACK);
    expect(src).toContain('passwordPolicy');
    expect(src).toContain('minLength: 8');
    expect(src).toContain('requireLowercase: true');
    expect(src).toContain('requireUppercase: true');
    expect(src).toContain('requireDigits: true');
  });

  test('main-stack: account recovery via email is configured', () => {
    const src = readSource(MAIN_STACK);
    expect(src).toContain('AccountRecovery.EMAIL_ONLY');
  });

  test('simple-stack: email and username sign-in is enabled', () => {
    const src = readSource(SIMPLE_STACK);
    expect(src).toContain('signInAliases');
    expect(src).toContain('email: true');
    expect(src).toContain('username: true');
  });

  test('simple-stack: password policy is configured', () => {
    const src = readSource(SIMPLE_STACK);
    expect(src).toContain('passwordPolicy');
    expect(src).toContain('minLength: 8');
    expect(src).toContain('requireLowercase: true');
    expect(src).toContain('requireUppercase: true');
    expect(src).toContain('requireDigits: true');
    expect(src).toContain('requireSymbols: true');
  });

  test('simple-stack: account recovery via email is configured', () => {
    const src = readSource(SIMPLE_STACK);
    expect(src).toContain('AccountRecovery.EMAIL_ONLY');
  });
});


// ============================================================
// 3.8 WAF stack has IP allowlist and AWS managed rules
// ============================================================
describe('3.8 Preservation: WAF stack has IP allowlist and AWS managed rules', () => {

  test('WAF stack: IP set for allowed IPs is created', () => {
    const src = readSource(WAF_STACK);
    expect(src).toContain("new wafv2.CfnIPSet(");
    expect(src).toContain("'AllowedIPSetV4'");
    expect(src).toContain("ipAddressVersion: 'IPV4'");
  });

  test('WAF stack: IP allowlist rule exists', () => {
    const src = readSource(WAF_STACK);
    expect(src).toContain("name: 'AllowISKIPs'");
    expect(src).toContain('ipSetReferenceStatement');
    expect(src).toContain('action: { allow: {} }');
  });

  test('WAF stack: AWS managed common rule set is configured', () => {
    const src = readSource(WAF_STACK);
    expect(src).toContain("name: 'AWSManagedRulesCommonRuleSet'");
    expect(src).toContain("vendorName: 'AWS'");
  });

  test('WAF stack: AWS managed known bad inputs rule set is configured', () => {
    const src = readSource(WAF_STACK);
    expect(src).toContain("name: 'AWSManagedRulesKnownBadInputsRuleSet'");
  });

  test('WAF stack: default action is block', () => {
    const src = readSource(WAF_STACK);
    expect(src).toContain('defaultAction: { block: {} }');
  });

  test('WAF stack: scope is CLOUDFRONT', () => {
    const src = readSource(WAF_STACK);
    expect(src).toContain("scope: 'CLOUDFRONT'");
  });
});

// ============================================================
// 3.9 DynamoDB table has PAY_PER_REQUEST, TTL, RETAIN removal policy
// ============================================================
describe('3.9 Preservation: DynamoDB table has PAY_PER_REQUEST, TTL, RETAIN removal policy', () => {

  test('main-stack: DynamoDB access log table uses PAY_PER_REQUEST billing', () => {
    const src = readSource(MAIN_STACK);
    expect(src).toContain('new dynamodb.Table(');
    expect(src).toContain('BillingMode.PAY_PER_REQUEST');
  });

  test('main-stack: DynamoDB table has TTL attribute configured', () => {
    const src = readSource(MAIN_STACK);
    expect(src).toContain("timeToLiveAttribute: 'ttl'");
  });

  test('main-stack: DynamoDB table has RETAIN removal policy', () => {
    const src = readSource(MAIN_STACK);
    // Find the DynamoDB table section and verify RETAIN
    const dynamoIdx = src.indexOf('new dynamodb.Table(');
    expect(dynamoIdx).toBeGreaterThan(-1);
    const dynamoSection = src.slice(dynamoIdx, dynamoIdx + 500);
    expect(dynamoSection).toContain('RemovalPolicy.RETAIN');
  });
});

// ============================================================
// 3.10 API Gateway Gateway Response has CORS headers for 401/403
// ============================================================
describe('3.10 Preservation: API Gateway Gateway Response has CORS headers for 401/403', () => {

  test('simple-stack: Gateway Response for 401 (UNAUTHORIZED) exists with CORS headers', () => {
    const src = readSource(SIMPLE_STACK);
    expect(src).toContain("api.addGatewayResponse('UnauthorizedResponse'");
    expect(src).toContain('ResponseType.UNAUTHORIZED');
    // Verify CORS headers in the 401 response
    const unauthorizedIdx = src.indexOf("api.addGatewayResponse('UnauthorizedResponse'");
    const section = src.slice(unauthorizedIdx, unauthorizedIdx + 500);
    expect(section).toContain('Access-Control-Allow-Origin');
    expect(section).toContain('Access-Control-Allow-Headers');
    expect(section).toContain('Access-Control-Allow-Methods');
  });

  test('simple-stack: Gateway Response for 403 (ACCESS_DENIED) exists with CORS headers', () => {
    const src = readSource(SIMPLE_STACK);
    expect(src).toContain("api.addGatewayResponse('ForbiddenResponse'");
    expect(src).toContain('ResponseType.ACCESS_DENIED');
    // Verify CORS headers in the 403 response
    const forbiddenIdx = src.indexOf("api.addGatewayResponse('ForbiddenResponse'");
    const section = src.slice(forbiddenIdx, forbiddenIdx + 500);
    expect(section).toContain('Access-Control-Allow-Origin');
    expect(section).toContain('Access-Control-Allow-Headers');
    expect(section).toContain('Access-Control-Allow-Methods');
  });

  test('simple-stack: Gateway Response 401 has statusCode 401', () => {
    const src = readSource(SIMPLE_STACK);
    const unauthorizedIdx = src.indexOf("api.addGatewayResponse('UnauthorizedResponse'");
    const section = src.slice(unauthorizedIdx, unauthorizedIdx + 500);
    expect(section).toContain("statusCode: '401'");
  });

  test('simple-stack: Gateway Response 403 has statusCode 403', () => {
    const src = readSource(SIMPLE_STACK);
    const forbiddenIdx = src.indexOf("api.addGatewayResponse('ForbiddenResponse'");
    const section = src.slice(forbiddenIdx, forbiddenIdx + 500);
    expect(section).toContain("statusCode: '403'");
  });
});
