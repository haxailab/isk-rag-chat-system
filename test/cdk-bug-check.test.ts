/**
 * CDK Bug Condition Exploration Tests
 *
 * These tests inspect CDK source files directly to detect bug conditions.
 * Tests are written so they PASS when bugs are ABSENT (expected behavior).
 * On unfixed code, tests will FAIL because bugs ARE present — this is the expected outcome.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10,
 *   1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17, 1.18, 1.19, 1.20, 1.21, 1.22,
 *   1.23, 1.24, 1.25, 1.26**
 */

import * as fs from 'fs';
import * as path from 'path';

// Helper: read source file content
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf-8');
}

// Source file paths
const FULL_STACK = 'lib/isk-rag-chat-system-full-stack.ts';
const MAIN_STACK = 'lib/isk-rag-chat-system-stack.ts';
const SIMPLE_STACK = 'lib/isk-rag-chat-system-simple-stack.ts';
const BASIC_STACK = 'lib/isk-rag-chat-system-stack-basic.ts';
const MINIMAL_STACK = 'lib/isk-rag-chat-system-stack-minimal.ts';
const FRONTEND_STACK = 'lib/isk-rag-chat-system-frontend-stack.ts';
const SIMPLE_FRONTEND_STACK = 'lib/isk-rag-chat-system-simple-frontend-stack.ts';
const BIN_MAIN = 'bin/isk-rag-chat-system.ts';
const BIN_FRONTEND_ONLY = 'bin/isk-rag-chat-system-frontend-only.ts';

// All stack source files
const ALL_STACK_FILES = [
  FULL_STACK, MAIN_STACK, SIMPLE_STACK, BASIC_STACK, MINIMAL_STACK,
];

const ALL_API_STACK_FILES = [
  MAIN_STACK, SIMPLE_STACK, BASIC_STACK, MINIMAL_STACK,
];

// ============================================================
// P0 — Deploy failures
// ============================================================
describe('P0: Deploy failures', () => {

  // 1.1 — full-stack uses getAttString('KnowledgeBaseId') but custom resource only returns IndexName
  test('1.1 full-stack should not reference KnowledgeBaseId from custom resource that only returns IndexName', () => {
    const src = readSource(FULL_STACK);
    // The custom resource Lambda only returns {"IndexName": index_name}
    // Using getAttString('KnowledgeBaseId') will yield empty string
    const usesKnowledgeBaseIdFromCustomResource = src.includes("getAttString('KnowledgeBaseId')");
    expect(usesKnowledgeBaseIdFromCustomResource).toBe(false);
  });

  // 1.2 — full-stack uses fromRestApiId() then calls api.root.addResource()
  test('1.2 full-stack should not use fromRestApiId with root.addResource', () => {
    const src = readSource(FULL_STACK);
    const usesFromRestApiId = src.includes('RestApi.fromRestApiId(');
    const usesRootAddResource = src.includes('.root.addResource(');
    // Both patterns together cause deploy failure
    expect(usesFromRestApiId && usesRootAddResource).toBe(false);
  });

  // 1.3 — full-stack has placeholder authorizer ID
  test('1.3 full-stack should not have placeholder authorizer ID', () => {
    const src = readSource(FULL_STACK);
    const hasPlaceholderAuthorizerId = src.includes("'existing-authorizer-id'");
    expect(hasPlaceholderAuthorizerId).toBe(false);
  });

  // 1.4 — basic-stack and minimal-stack both export class named IskRagChatSystemStack
  test('1.4 basic-stack and minimal-stack should not export the same class name', () => {
    const basicSrc = readSource(BASIC_STACK);
    const minimalSrc = readSource(MINIMAL_STACK);
    // Check if both export a class named exactly "IskRagChatSystemStack"
    const basicExportsName = /export\s+class\s+IskRagChatSystemStack\s/.test(basicSrc);
    const minimalExportsName = /export\s+class\s+IskRagChatSystemStack\s/.test(minimalSrc);
    expect(basicExportsName && minimalExportsName).toBe(false);
  });
});

// ============================================================
// P1 — Security vulnerabilities
// ============================================================
describe('P1: Security vulnerabilities', () => {

  // 1.5 — Hardcoded account ID in source files
  test('1.5 source files should not contain hardcoded AWS account ID', () => {
    const filesToCheck = [
      ...ALL_STACK_FILES, FRONTEND_STACK, SIMPLE_FRONTEND_STACK,
      BIN_MAIN, BIN_FRONTEND_ONLY,
    ];
    const hardcodedAccountId = '144828520862';
    const filesWithHardcodedId: string[] = [];
    for (const f of filesToCheck) {
      const src = readSource(f);
      if (src.includes(hardcodedAccountId)) {
        filesWithHardcodedId.push(f);
      }
    }
    expect(filesWithHardcodedId).toEqual([]);
  });

  // 1.6 — Access keys CSV exists in repository
  test('1.6 repository should not contain access keys CSV file', () => {
    const csvPath = path.join(__dirname, '..', 'claude-code-user_accessKeys.csv');
    const exists = fs.existsSync(csvPath);
    expect(exists).toBe(false);
  });

  // 1.7 — main-stack has unauthenticated test endpoints with Lambda integration
  test('1.7 main-stack should not have unauthenticated test endpoints', () => {
    const src = readSource(MAIN_STACK);
    const unauthEndpoints = [
      "'test-chat'",
      "'test-simple'",
      "'test-file-upload'",
      "'test-enhanced-chat'",
      "'generate-document'",
    ];
    const foundEndpoints = unauthEndpoints.filter(ep => src.includes(ep));
    expect(foundEndpoints).toEqual([]);
  });

  // 1.8 — simple-stack, minimal-stack, basic-stack have unauthenticated test-chat
  test('1.8 other stacks should not have unauthenticated test-chat endpoints', () => {
    const stacksToCheck = [SIMPLE_STACK, MINIMAL_STACK, BASIC_STACK];
    const stacksWithTestChat: string[] = [];
    for (const f of stacksToCheck) {
      const src = readSource(f);
      if (src.includes("'test-chat'")) {
        stacksWithTestChat.push(f);
      }
    }
    expect(stacksWithTestChat).toEqual([]);
  });

  // 1.9 — IAM policies with resources: ['*'] for bedrock/textract/comprehend
  test('1.9 IAM policies should not use wildcard resources for bedrock/textract/comprehend', () => {
    const stacksWithWildcard: string[] = [];
    for (const f of ALL_STACK_FILES) {
      const src = readSource(f);
      // Check for bedrock/textract/comprehend actions paired with resources: ['*']
      // Textract/Comprehend do not support resource-level permissions, so we only check
      // that wildcard resources without a "do not support resource-level permissions" comment exist
      const hasBedrockActions = /bedrock:InvokeModel|bedrock-agent:Retrieve|textract:|comprehend:/.test(src);
      // Find all resources: ['*'] that are NOT preceded by the Textract/Comprehend comment
      const lines = src.split('\n');
      let hasUncommentedWildcard = false;
      for (let i = 0; i < lines.length; i++) {
        if (/resources:\s*\[\s*'\*'\s*\]/.test(lines[i])) {
          // Check if the previous line has the Textract/Comprehend comment
          const prevLine = i > 0 ? lines[i - 1] : '';
          if (!prevLine.includes('do not support resource-level permissions')) {
            hasUncommentedWildcard = true;
            break;
          }
        }
      }
      if (hasBedrockActions && hasUncommentedWildcard) {
        stacksWithWildcard.push(f);
      }
    }
    expect(stacksWithWildcard).toEqual([]);
  });

  // 1.10 — CORS allowOrigins: ['*'] or Cors.ALL_ORIGINS
  test('1.10 API Gateway should not use wildcard CORS origins', () => {
    const stacksWithWildcardCors: string[] = [];
    for (const f of ALL_API_STACK_FILES) {
      const src = readSource(f);
      if (src.includes('Cors.ALL_ORIGINS') || /allowOrigins:\s*\[\s*'\*'\s*\]/.test(src)) {
        stacksWithWildcardCors.push(f);
      }
    }
    expect(stacksWithWildcardCors).toEqual([]);
  });

  // 1.11 — dataTraceEnabled: true in deploy options
  test('1.11 API Gateway should not have dataTraceEnabled set to true', () => {
    const stacksWithDataTrace: string[] = [];
    for (const f of ALL_API_STACK_FILES) {
      const src = readSource(f);
      if (src.includes('dataTraceEnabled: true')) {
        stacksWithDataTrace.push(f);
      }
    }
    expect(stacksWithDataTrace).toEqual([]);
  });

  // 1.12 — AmazonBedrockFullAccess managed policy in basic-stack
  test('1.12 basic-stack should not use AmazonBedrockFullAccess managed policy', () => {
    const src = readSource(BASIC_STACK);
    const hasFullAccess = src.includes('AmazonBedrockFullAccess');
    const hasAossWildcard = /aoss:\*/.test(src) || /actions:\s*\[\s*'aoss:\*'\s*\]/.test(src) || src.includes("'aoss:*'");
    expect(hasFullAccess || hasAossWildcard).toBe(false);
  });
});

// ============================================================
// P2 — Resource configuration issues
// ============================================================
describe('P2: Resource configuration issues', () => {

  // 1.13 — CloudWatch alarms without alarmActions in simple-stack
  test('1.13 CloudWatch alarms should have alarmActions configured', () => {
    const src = readSource(SIMPLE_STACK);
    // Count alarm definitions vs alarmActions references
    const alarmMatches = src.match(/new cloudwatch\.Alarm\(/g);
    const alarmActionsMatches = src.match(/alarmActions/g);
    const alarmCount = alarmMatches ? alarmMatches.length : 0;
    // If there are alarms, there should be alarmActions
    if (alarmCount > 0) {
      expect(alarmActionsMatches).not.toBeNull();
      expect(alarmActionsMatches!.length).toBeGreaterThanOrEqual(1);
    }
  });

  // 1.14 — SNS Topic without subscriptions
  test('1.14 SNS Topic should have subscriptions configured', () => {
    const src = readSource(SIMPLE_STACK);
    const hasSNSTopic = src.includes('new sns.Topic(');
    if (hasSNSTopic) {
      const hasSubscription = src.includes('addSubscription') || src.includes('new sns.Subscription') || src.includes('sns_subscriptions');
      expect(hasSubscription).toBe(true);
    }
  });

  // 1.15 — analysisReportFunction memorySize: 3008
  test('1.15 analysisReportFunction should not have excessive memory (>2048MB)', () => {
    const src = readSource(SIMPLE_STACK);
    const memoryMatch = src.match(/analysisReportFunction[\s\S]*?memorySize:\s*(\d+)/);
    // Also check by looking for memorySize: 3008 near AnalysisReportFunction
    const hasExcessiveMemory = src.includes('memorySize: 3008');
    expect(hasExcessiveMemory).toBe(false);
  });

  // 1.16 — analysisReportFunction timeout: Duration.minutes(8)
  test('1.16 analysisReportFunction should not have excessive timeout (>5 min)', () => {
    const src = readSource(SIMPLE_STACK);
    const hasExcessiveTimeout = src.includes('Duration.minutes(8)');
    expect(hasExcessiveTimeout).toBe(false);
  });

  // 1.17 — Lambda functions without DLQ
  test('1.17 Lambda functions should have Dead Letter Queue configured', () => {
    const stacksWithoutDLQ: string[] = [];
    for (const f of ALL_API_STACK_FILES) {
      const src = readSource(f);
      const lambdaCount = (src.match(/new lambda\.Function\(/g) || []).length;
      if (lambdaCount > 0) {
        const hasDLQ = src.includes('deadLetterQueue') || src.includes('deadLetterQueueEnabled');
        if (!hasDLQ) {
          stacksWithoutDLQ.push(f);
        }
      }
    }
    expect(stacksWithoutDLQ).toEqual([]);
  });

  // 1.18 — Lambda functions without reservedConcurrency
  test('1.18 Lambda functions should have reservedConcurrency configured', () => {
    const stacksWithoutReserved: string[] = [];
    for (const f of ALL_API_STACK_FILES) {
      const src = readSource(f);
      const lambdaCount = (src.match(/new lambda\.Function\(/g) || []).length;
      if (lambdaCount > 0) {
        const hasReserved = src.includes('reservedConcurrentExecutions');
        if (!hasReserved) {
          stacksWithoutReserved.push(f);
        }
      }
    }
    expect(stacksWithoutReserved).toEqual([]);
  });

  // 1.19 — S3 CORS allowedOrigins: ['*']
  test('1.19 S3 bucket CORS should not use wildcard origins', () => {
    const src = readSource(SIMPLE_STACK);
    // Check for S3 CORS with wildcard origins
    const corsSection = src.match(/cors:\s*\[\{[\s\S]*?\}\]/);
    if (corsSection) {
      const hasWildcardOrigin = /allowedOrigins:\s*\[\s*'\*'\s*\]/.test(corsSection[0]);
      expect(hasWildcardOrigin).toBe(false);
    }
  });

  // 1.20 — API Gateway without throttling config
  test('1.20 API Gateway should have throttling configured', () => {
    const stacksWithoutThrottling: string[] = [];
    for (const f of ALL_API_STACK_FILES) {
      const src = readSource(f);
      if (src.includes('new apigateway.RestApi(')) {
        const hasThrottling = src.includes('throttlingRateLimit') || src.includes('throttlingBurstLimit');
        if (!hasThrottling) {
          stacksWithoutThrottling.push(f);
        }
      }
    }
    expect(stacksWithoutThrottling).toEqual([]);
  });

  // 1.21 — Multiple Lambda functions sharing single IAM role in simple-stack
  test('1.21 Lambda functions should not share a single IAM role', () => {
    const src = readSource(SIMPLE_STACK);
    // Count Lambda functions and IAM roles
    const lambdaCount = (src.match(/new lambda\.Function\(/g) || []).length;
    const roleCount = (src.match(/new iam\.Role\([\s\S]*?assumedBy:\s*new iam\.ServicePrincipal\('lambda\.amazonaws\.com'\)/g) || []).length;
    // If there are multiple Lambda functions, there should be multiple roles
    if (lambdaCount > 1) {
      expect(roleCount).toBeGreaterThanOrEqual(lambdaCount);
    }
  });
});

// ============================================================
// P3 — Best practices violations
// ============================================================
describe('P3: Best practices violations', () => {

  // 1.22 — LOG_LEVEL: 'DEBUG' in Lambda environment
  test('1.22 Lambda functions should not use DEBUG log level', () => {
    const stacksWithDebug: string[] = [];
    for (const f of ALL_API_STACK_FILES) {
      const src = readSource(f);
      if (src.includes("LOG_LEVEL: 'DEBUG'") || src.includes('LOG_LEVEL: "DEBUG"')) {
        stacksWithDebug.push(f);
      }
    }
    expect(stacksWithDebug).toEqual([]);
  });

  // 1.23 — react.development.js in frontend stacks
  test('1.23 frontend stacks should not use React development builds', () => {
    const frontendFiles = [FRONTEND_STACK, SIMPLE_FRONTEND_STACK];
    const stacksWithDevReact: string[] = [];
    for (const f of frontendFiles) {
      const src = readSource(f);
      if (src.includes('react.development.js') || src.includes('react-dom.development.js')) {
        stacksWithDevReact.push(f);
      }
    }
    expect(stacksWithDevReact).toEqual([]);
  });

  // 1.24 — Missing standard tags in main entry point
  test('1.24 main entry point should have standard tags', () => {
    const src = readSource(BIN_MAIN);
    const hasProjectTag = src.includes("Tags.of") && src.includes("'Project'");
    const hasEnvironmentTag = src.includes("Tags.of") && src.includes("'Environment'");
    expect(hasProjectTag && hasEnvironmentTag).toBe(true);
  });

  // 1.25 — Missing request validator on API Gateway
  test('1.25 API Gateway should have request validators configured', () => {
    const stacksWithoutValidator: string[] = [];
    for (const f of ALL_API_STACK_FILES) {
      const src = readSource(f);
      if (src.includes('new apigateway.RestApi(')) {
        const hasValidator = src.includes('requestValidator') || src.includes('RequestValidator');
        if (!hasValidator) {
          stacksWithoutValidator.push(f);
        }
      }
    }
    expect(stacksWithoutValidator).toEqual([]);
  });

  // 1.26 — WAF ARN commented out
  test('1.26 WAF should not be commented out in frontend configuration', () => {
    const binSrc = readSource(BIN_MAIN);
    const frontendSrc = readSource(FRONTEND_STACK);
    // Check for commented-out WAF references
    const wafCommentedInBin = /\/\/\s*webAclArn/.test(binSrc);
    const wafCommentedInFrontend = /\/\/\s*.*webAclId/.test(frontendSrc) || /\/\/\s*.*webAclArn/.test(frontendSrc);
    expect(wafCommentedInBin || wafCommentedInFrontend).toBe(false);
  });
});
