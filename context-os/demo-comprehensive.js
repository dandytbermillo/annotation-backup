/**
 * Comprehensive Demo of Intelligent Content Generation
 * Shows how the system generates different suggestions based on document context
 */

const LLMFillIntegration = require('./bridge/llm-fill-integration');
const fs = require('fs');

async function runDemo() {
  const integration = new LLMFillIntegration({ debug: false, maxSuggestions: 3 });
  
  console.log('🎯 Intelligent Content Generation Demo\n');
  console.log('This demo shows how the system generates context-aware suggestions\n');
  
  // Demo 1: Calculator Feature
  console.log('=' .repeat(60));
  console.log('📊 DEMO 1: Simple Calculator Feature');
  console.log('=' .repeat(60));
  
  const calculatorDoc = fs.readFileSync('./test-calculator-example.md', 'utf8');
  
  console.log('\n📄 Document Summary: Calculator with blue buttons and background image\n');
  
  const calcRequest = {
    fieldName: ['acceptanceCriteria', 'problem', 'goals'],
    documentContent: calculatorDoc,
    featureSlug: 'calculator',
    batch: true
  };
  
  const calcResponse = await integration.processRequest(calcRequest);
  const calcResults = calcResponse.result;
  
  Object.entries(calcResults).forEach(([field, result]) => {
    const displayName = integration.getFieldDisplayName(field);
    console.log(`🔹 ${displayName}:`);
    result.suggestions.forEach((suggestion, i) => {
      console.log(`  ${i + 1}. ${suggestion}`);
    });
    console.log();
  });
  
  // Demo 2: E-commerce Feature
  console.log('=' .repeat(60));
  console.log('🛒 DEMO 2: E-commerce Shopping Cart Enhancement');
  console.log('=' .repeat(60));
  
  const ecommerceDoc = fs.readFileSync('./test-ecommerce-example.md', 'utf8');
  
  console.log('\n📄 Document Summary: Shopping cart improvements for e-commerce platform\n');
  
  const ecomRequest = {
    fieldName: ['acceptanceCriteria', 'stakeholders', 'successMetrics'],
    documentContent: ecommerceDoc,
    featureSlug: 'ecommerce',
    batch: true
  };
  
  const ecomResponse = await integration.processRequest(ecomRequest);
  const ecomResults = ecomResponse.result;
  
  Object.entries(ecomResults).forEach(([field, result]) => {
    const displayName = integration.getFieldDisplayName(field);
    console.log(`🔹 ${displayName}:`);
    result.suggestions.forEach((suggestion, i) => {
      console.log(`  ${i + 1}. ${suggestion}`);
    });
    console.log();
  });
  
  // Demo 3: Show difference in approach
  console.log('=' .repeat(60));
  console.log('🔬 DEMO 3: Context Comparison');
  console.log('=' .repeat(60));
  
  console.log('\n📊 Same field, different contexts:\n');
  
  console.log('🧮 Calculator - Acceptance Criteria:');
  calcResults.acceptanceCriteria.suggestions.forEach((suggestion, i) => {
    console.log(`  ${i + 1}. ${suggestion}`);
  });
  
  console.log('\n🛒 E-commerce - Acceptance Criteria:');
  ecomResults.acceptanceCriteria.suggestions.forEach((suggestion, i) => {
    console.log(`  ${i + 1}. ${suggestion}`);
  });
  
  console.log('\n💡 Notice how the suggestions are tailored to each specific context!');
  
  // Demo 4: Confidence scoring
  console.log('\n' + '=' .repeat(60));
  console.log('🎯 DEMO 4: Confidence Scoring');
  console.log('=' .repeat(60));
  
  const calcConfidenceReq = {
    fieldName: 'implementationTasks',
    documentContent: calculatorDoc,
    featureSlug: 'calculator',
    confidence: true
  };
  
  const ecomConfidenceReq = {
    fieldName: 'implementationTasks',
    documentContent: ecommerceDoc,
    featureSlug: 'ecommerce',
    confidence: true
  };
  
  const calcConfidenceRes = await integration.processRequest(calcConfidenceReq);
  const ecomConfidenceRes = await integration.processRequest(ecomConfidenceReq);
  
  const calcConfidence = calcConfidenceRes.result;
  const ecomConfidence = ecomConfidenceRes.result;
  
  console.log(`\n🧮 Calculator Implementation Tasks (Confidence: ${Math.round(calcConfidence.confidence * 100)}%):`);
  calcConfidence.suggestions.slice(0, 3).forEach((task, i) => {
    console.log(`  ${i + 1}. ${task}`);
  });
  
  console.log(`\n🛒 E-commerce Implementation Tasks (Confidence: ${Math.round(ecomConfidence.confidence * 100)}%):`);
  ecomConfidence.suggestions.slice(0, 3).forEach((task, i) => {
    console.log(`  ${i + 1}. ${task}`);
  });
  
  console.log('\n🎉 Demo Complete! The system successfully generates context-aware suggestions.');
  console.log('\n🔑 Key Benefits:');
  console.log('  ✅ Domain-specific suggestions (not generic templates)');
  console.log('  ✅ Technology stack awareness');
  console.log('  ✅ User type and stakeholder detection');
  console.log('  ✅ Business context understanding');
  console.log('  ✅ Confidence scoring for reliability');
  console.log('\n📚 Ready for integration with Context-OS LLM Fill feature!');
}

runDemo().catch(console.error);