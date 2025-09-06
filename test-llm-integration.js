/**
 * Test script for LLM Fill Integration
 */

const LLMFillIntegration = require('./context-os/bridge/llm-fill-integration');

async function testIntegration() {
  const integration = new LLMFillIntegration({ debug: false });
  
  console.log('🧪 Testing LLM Fill Integration\n');
  
  // Test 1: Single field generation
  console.log('Test 1: Acceptance Criteria for Calculator');
  const request1 = {
    fieldName: 'acceptanceCriteria',
    documentPath: './context-os/test-calculator-example.md',
    featureSlug: 'calculator',
    confidence: true
  };
  
  const result1 = await integration.processRequest(request1);
  console.log('✅ Result:', result1.result.suggestions);
  console.log(`🎯 Confidence: ${Math.round(result1.result.confidence * 100)}%\n`);
  
  // Test 2: Batch generation
  console.log('Test 2: Batch generation for Calculator');
  const request2 = {
    fieldName: ['acceptanceCriteria', 'problem', 'goals'],
    documentPath: './context-os/test-calculator-example.md',
    featureSlug: 'calculator',
    batch: true
  };
  
  const result2 = await integration.processRequest(request2);
  console.log('✅ Batch Results:');
  Object.entries(result2.result).forEach(([field, data]) => {
    console.log(`  📌 ${field}:`);
    if (data.suggestions) {
      data.suggestions.slice(0, 2).forEach((suggestion, index) => {
        console.log(`    ${index + 1}. ${suggestion}`);
      });
    }
  });
  
  // Test 3: Field information
  console.log('\nTest 3: Available Fields');
  const fieldInfo = integration.getFieldInfo();
  fieldInfo.slice(0, 3).forEach(field => {
    console.log(`  📋 ${field.displayName}: ${field.description}`);
  });
  
  console.log('\n🎉 All tests completed successfully!');
}

testIntegration().catch(console.error);