// context-os/templates/render-initial.js
const Handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

// Register helpers
Handlebars.registerHelper('default', (value, defaultValue) => value || defaultValue);
Handlebars.registerHelper('date', () => new Date().toISOString().split('T')[0]);
Handlebars.registerHelper('bulletList', (items) => {
  if (!items || !items.length) return '- Not specified';
  return items.map(item => `- ${item}`).join('\n');
});

// Cache compiled template
let compiledTemplate = null;

async function renderInitial(spec) {
  if (!compiledTemplate) {
    const templatePath = path.join(__dirname, 'initial.md.hbs');
    const source = await fs.readFile(templatePath, 'utf8');
    compiledTemplate = Handlebars.compile(source);
  }
  
  return compiledTemplate(spec);
}

module.exports = { renderInitial };