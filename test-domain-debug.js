const IntelligentContentGenerator = require('./context-os/agents/intelligent-content-generator');
const fs = require('fs');

const generator = new IntelligentContentGenerator({ debug: true });
const content = fs.readFileSync('./context-os/test-ecommerce-example.md', 'utf8');

console.log('Testing domain detection...\n');
const analysis = generator.analyzeDocument(content);
console.log('\nFinal domain:', analysis.domain);