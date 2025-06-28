export const initialData = {
  main: {
    title: "AI in Healthcare Research",
    type: "main",
    content: `
      <p>The integration of <span class="annotation note bg-gradient-to-r from-blue-50 to-blue-200 px-1.5 py-0.5 rounded cursor-pointer font-semibold border-b-2 border-blue-500 text-blue-800" data-branch="ai-integration">artificial intelligence in healthcare systems</span> represents a paradigm shift in medical practice. Recent studies have shown that <span class="annotation explore bg-gradient-to-r from-orange-50 to-orange-200 px-1.5 py-0.5 rounded cursor-pointer font-semibold border-b-2 border-orange-500 text-orange-800" data-branch="diagnostic-accuracy">AI diagnostic tools can achieve 94% accuracy</span> in certain medical imaging tasks.</p>
      
      <p>However, the implementation faces significant challenges. <span class="annotation promote bg-gradient-to-r from-green-50 to-green-200 px-1.5 py-0.5 rounded cursor-pointer font-semibold border-b-2 border-green-500 text-green-800" data-branch="ethical-concerns">Ethical considerations around patient privacy and algorithmic bias</span> remain paramount concerns for healthcare institutions.</p>
      
      <p>The economic impact is substantial, with <span class="annotation note bg-gradient-to-r from-blue-50 to-blue-200 px-1.5 py-0.5 rounded cursor-pointer font-semibold border-b-2 border-blue-500 text-blue-800" data-branch="cost-savings">projected cost savings of $150 billion annually</span> by 2026 through improved efficiency and reduced diagnostic errors.</p>
    `,
    branches: ["ai-integration", "diagnostic-accuracy", "ethical-concerns", "cost-savings"],
    position: { x: 2000, y: 1500 },
    isEditable: false,
  },
  "ai-integration": {
    title: "AI Integration Analysis",
    type: "note",
    originalText: "artificial intelligence in healthcare systems",
    content: `<p>The integration requires careful consideration of existing infrastructure, staff training, and regulatory compliance. Key factors include interoperability with current EMR systems, data standardization protocols, and the establishment of clear governance frameworks.</p>

<p>A phased implementation approach is recommended, starting with pilot programs in controlled environments before full-scale deployment.</p>`,
    branches: [],
    parentId: "main",
    position: { x: 2900, y: 1200 },
    isEditable: true,
  },
  "diagnostic-accuracy": {
    title: "Diagnostic Accuracy Deep Dive",
    type: "explore",
    originalText: "AI diagnostic tools can achieve 94% accuracy",
    content: `<p>This 94% accuracy rate is particularly impressive when compared to traditional diagnostic methods. The study analyzed performance across radiology, pathology, and dermatology. However, accuracy varies significantly by medical specialty and image quality.</p>

<p>Further research needed on edge cases and rare conditions where AI may struggle with limited training data.</p>`,
    branches: [],
    parentId: "main",
    position: { x: 2900, y: 1850 },
    isEditable: true,
  },
  "ethical-concerns": {
    title: "Critical Ethical Framework",
    type: "promote",
    originalText: "Ethical considerations around patient privacy and algorithmic bias",
    content: `<p><strong>CRITICAL:</strong> These ethical frameworks should be mandatory industry standards. Privacy-preserving AI techniques like federated learning and differential privacy must be implemented.</p>

<p>Algorithmic bias testing should be continuous, not one-time. Recommend immediate policy adoption.</p>`,
    branches: [],
    parentId: "main",
    position: { x: 2900, y: 2500 },
    isEditable: true,
  },
  "cost-savings": {
    title: "Economic Impact Analysis",
    type: "note",
    originalText: "projected cost savings of $150 billion annually",
    content: `<p>This $150B projection breaks down as: $60B from reduced diagnostic errors, $45B from improved efficiency, $30B from preventive care improvements, and $15B from administrative automation.</p>

<p>Timeline assumes 60% adoption rate by 2026.</p>`,
    branches: [],
    parentId: "main",
    position: { x: 2900, y: 3150 },
    isEditable: true,
  },
}
