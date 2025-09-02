#!/usr/bin/env node

// Test UUID coercion logic independently
const { v5: uuidv5, validate: validateUuid } = require('uuid');

const ID_NAMESPACE = '7b6f9e76-0e6f-4a61-8c8b-0c5e583f2b1a';
const coerceEntityId = (id) => (validateUuid(id) ? id : uuidv5(id, ID_NAMESPACE));

console.log('UUID Coercion Test Results:');
console.log('===========================\n');

// Test cases
const testCases = [
  { input: 'note-1755925277292', desc: 'Original problematic slug' },
  { input: 'test-note', desc: 'Simple slug' },
  { input: '550e8400-e29b-41d4-a716-446655440000', desc: 'Valid UUID' },
  { input: 'branch-9a4b2235-cbc8-45f2-a507-031f00d5f1ad', desc: 'Branch slug' },
  { input: '21745e66-9d67-50ee-b443-cffa38dab7e9', desc: 'FK violation UUID' }
];

testCases.forEach(test => {
  const result = coerceEntityId(test.input);
  const wasCoerced = result !== test.input;
  console.log(`Input:  ${test.input}`);
  console.log(`Output: ${result}`);
  console.log(`Status: ${wasCoerced ? 'COERCED to UUID' : 'KEPT as UUID'}`);
  console.log(`Desc:   ${test.desc}`);
  console.log('---');
});

console.log('\nConsistency Test:');
console.log('Same slug should always produce same UUID:');
const slug = 'test-note-123';
const uuid1 = coerceEntityId(slug);
const uuid2 = coerceEntityId(slug);
console.log(`First call:  ${uuid1}`);
console.log(`Second call: ${uuid2}`);
console.log(`Consistent:  ${uuid1 === uuid2 ? '✅ YES' : '❌ NO'}`);

console.log('\nAll tests completed!');