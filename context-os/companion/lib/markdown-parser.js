class MarkdownSectionParser {
  extractSections(content) {
    const sections = [];
    const lines = content.split('\n');
    let inCodeBlock = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      
      if (!inCodeBlock) {
        const match = line.match(/^(#{1,6})\s+(.+)/);
        if (match) {
          sections.push({
            level: match[1].length,
            title: match[2].trim(),
            line: i,
            raw: line
          });
        }
      }
    }
    
    return sections;
  }

  replaceSection(content, sectionName, newContent) {
    const codeBlocks = [];
    const placeholder = '___CODE_BLOCK___';
    
    // Protect code blocks
    let protectedContent = content.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `${placeholder}${codeBlocks.length - 1}___`;
    });
    
    // Build regex for section
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRegex = new RegExp(
      `(^|\\n)(#{1,6}\\s*${escaped}.*?\\n)([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`,
      'i'
    );
    
    if (!sectionRegex.test(protectedContent)) {
      throw new Error(`Section not found: ${sectionName}`);
    }
    
    // Replace section content
    protectedContent = protectedContent.replace(sectionRegex, (match, prefix, header, oldContent) => {
      return `${prefix}${header}${newContent}\n`;
    });
    
    // Restore code blocks
    codeBlocks.forEach((block, i) => {
      protectedContent = protectedContent.replace(`${placeholder}${i}___`, block);
    });
    
    return protectedContent;
  }

  getSection(content, sectionName) {
    const sections = this.extractSections(content);
    const section = sections.find(s => 
      s.title.toLowerCase() === sectionName.toLowerCase()
    );
    
    if (!section) return null;
    
    const lines = content.split('\n');
    const start = section.line + 1;
    
    // Find next section at same or higher level
    let end = lines.length;
    for (let i = start; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s/);
      if (match && match[1].length <= section.level) {
        end = i;
        break;
      }
    }
    
    return lines.slice(start, end).join('\n').trim();
  }

  validateStructure(content) {
    const sections = this.extractSections(content);
    const duplicates = [];
    const seen = new Set();
    
    for (const section of sections) {
      const key = `${section.level}:${section.title}`;
      if (seen.has(key)) {
        duplicates.push(section.title);
      }
      seen.add(key);
    }
    
    return {
      valid: duplicates.length === 0,
      sections: sections.map(s => s.title),
      duplicates
    };
  }
}

module.exports = MarkdownSectionParser;