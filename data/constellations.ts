import { Constellation, ConstellationItem } from '@/types/constellation';

// Sample folder structures with nested content
const createProjectFolder = (): ConstellationItem => ({
  id: 'project_folder',
  title: '🗂️ My Projects',
  type: 'folder',
  importance: 5,
  angle: 45,
  distance: 100, 
  isFolder: true,
  icon: '📁',
  content: 'A collection of my current and past projects',
  tags: ['projects', 'development', 'portfolio'],
  children: [
    {
      id: 'web_project',
      title: 'Portfolio Website',
      type: 'document',
      importance: 4,
      angle: 0,
      distance: 60,
      icon: '🌐',
      content: 'My personal portfolio showcasing recent work',
      tags: ['web', 'portfolio', 'react'],
      parentId: 'project_folder'
    },
    {
      id: 'mobile_app',
      title: 'Task Manager App',
      type: 'document', 
      importance: 5,
      angle: 120,
      distance: 70,
      icon: '📱',
      content: 'Mobile productivity app with sync features',
      tags: ['mobile', 'productivity', 'flutter'],
      parentId: 'project_folder'
    },
    {
      id: 'ai_experiment',
      title: 'AI Chat Bot',
      type: 'document',
      importance: 3,
      angle: 240,
      distance: 55,
      icon: '🤖',
      content: 'Experimental chatbot using natural language processing',
      tags: ['ai', 'nlp', 'python'],
      parentId: 'project_folder'
    }
  ]
});

const createDocumentsFolder = (): ConstellationItem => ({
  id: 'documents_folder',
  title: '📋 Important Documents',
  type: 'folder',
  importance: 5,
  angle: 180,
  distance: 95,
  isFolder: true,
  icon: '📂',
  content: 'Critical documents and legal papers',
  tags: ['documents', 'legal', 'important'],
  children: [
    {
      id: 'passport',
      title: 'Passport Scan',
      type: 'document',
      importance: 5,
      angle: 0,
      distance: 50,
      icon: '📘',
      content: 'Digital copy of passport for travel',
      tags: ['travel', 'identity', 'legal'],
      parentId: 'documents_folder'
    },
    {
      id: 'contracts',
      title: 'Work Contracts',
      type: 'document',
      importance: 4,
      angle: 90,
      distance: 65,
      icon: '📝',
      content: 'Employment agreements and contracts',
      tags: ['work', 'legal', 'contracts'],
      parentId: 'documents_folder'
    },
    {
      id: 'insurance',
      title: 'Insurance Policies',
      type: 'document',
      importance: 4,
      angle: 180,
      distance: 70,
      icon: '🛡️',
      content: 'Health and auto insurance documentation',
      tags: ['insurance', 'health', 'auto'],
      parentId: 'documents_folder'
    },
    {
      id: 'certificates',
      title: 'Certificates',
      type: 'document',
      importance: 3,
      angle: 270,
      distance: 55,
      icon: '🏆',
      content: 'Professional certifications and achievements',
      tags: ['education', 'certificates', 'achievements'],
      parentId: 'documents_folder'
    }
  ]
});

const createPhotosFolder = (): ConstellationItem => ({
  id: 'photos_folder',
  title: '📸 Photo Collection',
  type: 'folder',
  importance: 4,
  angle: 300,
  distance: 85,
  isFolder: true,
  icon: '🖼️',
  content: 'Personal photo memories and albums',
  tags: ['photos', 'memories', 'family'],
  children: [
    {
      id: 'vacation_2023',
      title: '🏖️ Summer Vacation 2023',
      type: 'media',
      importance: 4,
      angle: 30,
      distance: 60,
      icon: '🌅',
      content: 'Beautiful memories from our summer trip',
      tags: ['vacation', '2023', 'travel', 'family'],
      parentId: 'photos_folder'
    },
    {
      id: 'family_events',
      title: '👨‍👩‍👧‍👦 Family Events',
      type: 'media',
      importance: 5,
      angle: 150,
      distance: 65,
      icon: '🎉',
      content: 'Birthday parties, holidays, and celebrations',
      tags: ['family', 'celebrations', 'memories'],
      parentId: 'photos_folder'
    },
    {
      id: 'work_events',
      title: '💼 Work Events',
      type: 'media',
      importance: 2,
      angle: 270,
      distance: 50,
      icon: '🤝',
      content: 'Team building and corporate events',
      tags: ['work', 'team', 'corporate'],
      parentId: 'photos_folder'
    }
  ]
});

// Exact copy from the original improved-constellation.html
export const initialConstellations: Constellation[] = [
  {
    id: 'work',
    name: 'Work Projects',
    icon: '💼',
    color: '#3b82f6',
    centerX: 100,
    centerY: 200,
    items: [
      { id: 'w1', title: 'Q4 Business Report', type: 'document', importance: 5, angle: 0, distance: 60 },
      { id: 'w2', title: 'Team Meeting Notes', type: 'note', importance: 3, angle: 60, distance: 80 },
      { id: 'w3', title: 'Project Proposal', type: 'document', importance: 4, angle: 120, distance: 70 },
      { id: 'w4', title: 'Client Presentation', type: 'presentation', importance: 5, angle: 180, distance: 90 },
      { id: 'w5', title: 'Budget Analysis', type: 'spreadsheet', importance: 4, angle: 240, distance: 75 },
      { id: 'w6', title: 'Team Email Thread', type: 'email', importance: 2, angle: 300, distance: 85 }
    ]
  },
  {
    id: 'personal',
    name: 'Personal Life',
    icon: '🏠',
    color: '#10b981',
    centerX: 1000,
    centerY: 200,
    items: [
      { id: 'p1', title: 'Family Photos', type: 'media', importance: 4, angle: 0, distance: 70 },
      { id: 'p2', title: 'Grocery List', type: 'note', importance: 2, angle: 72, distance: 50 },
      { id: 'p3', title: 'Vacation Planning', type: 'document', importance: 3, angle: 144, distance: 80 },
      { id: 'p4', title: 'Health Records', type: 'document', importance: 5, angle: 216, distance: 90 },
      { id: 'p5', title: 'Home Insurance', type: 'document', importance: 3, angle: 288, distance: 65 },
      // Add sample folders to personal constellation
      createProjectFolder(),
      createDocumentsFolder(),
      createPhotosFolder()
    ]
  },
  {
    id: 'finance',
    name: 'Financial Data',
    icon: '💰',
    color: '#f59e0b',
    centerX: 550,
    centerY: 400,
    items: [
      { id: 'f1', title: 'Bank Statements', type: 'document', importance: 4, angle: 0, distance: 85 },
      { id: 'f2', title: 'Investment Portfolio', type: 'spreadsheet', importance: 5, angle: 90, distance: 75 },
      { id: 'f3', title: 'Tax Documents', type: 'document', importance: 5, angle: 180, distance: 95 },
      { id: 'f4', title: 'Expense Receipts', type: 'receipt', importance: 3, angle: 270, distance: 60 },
      // Add a finance folder
      {
        id: 'finance_folder',
        title: '💳 Credit Cards',
        type: 'folder',
        importance: 4,
        angle: 135,
        distance: 80,
        isFolder: true,
        icon: '📁',
        content: 'Credit card statements and rewards tracking',
        tags: ['credit', 'cards', 'statements'],
        children: [
          {
            id: 'visa_statement',
            title: 'Visa Statement',
            type: 'document',
            importance: 3,
            angle: 0,
            distance: 40,
            icon: '💳',
            content: 'Monthly Visa credit card statement',
            tags: ['visa', 'statement', 'monthly'],
            parentId: 'finance_folder'
          },
          {
            id: 'rewards_summary',
            title: 'Rewards Summary',
            type: 'document',
            importance: 2,
            angle: 180,
            distance: 45,
            icon: '🎁',
            content: 'Credit card rewards and cashback summary',
            tags: ['rewards', 'cashback', 'benefits'],
            parentId: 'finance_folder'
          }
        ]
      }
    ]
  },
  {
    id: 'learning',
    name: 'Learning & Development',
    icon: '📚',
    color: '#8b5cf6',
    centerX: -100,
    centerY: 500,
    items: [
      { id: 'l1', title: 'Course Materials', type: 'document', importance: 4, angle: 0, distance: 70 },
      { id: 'l2', title: 'Study Notes', type: 'note', importance: 3, angle: 60, distance: 55 },
      { id: 'l3', title: 'Research Papers', type: 'document', importance: 5, angle: 120, distance: 85 },
      { id: 'l4', title: 'Video Lectures', type: 'media', importance: 3, angle: 180, distance: 75 },
      { id: 'l5', title: 'Progress Tracker', type: 'spreadsheet', importance: 2, angle: 240, distance: 45 },
      { id: 'l6', title: 'Certificate Archive', type: 'document', importance: 4, angle: 300, distance: 80 },
      // Add a deeply nested philosophy folder structure
      {
        id: 'philosophy_folder',
        title: '🧠 Philosophy',
        type: 'folder',
        importance: 5,
        angle: 270,
        distance: 90,
        isFolder: true,
        isRootFolder: true,
        icon: '📁',
        content: 'Philosophical works and thoughts',
        tags: ['philosophy', 'thinking', 'knowledge'],
        children: [
          {
            id: 'ancient_philosophy',
            title: '🏛️ Ancient Philosophy',
            type: 'folder',
            importance: 4,
            angle: 0,
            distance: 60,
            isFolder: true,
            icon: '📂',
            parentId: 'philosophy_folder',
            children: [
              {
                id: 'plato_works',
                title: '📜 Plato\'s Works',
                type: 'folder',
            importance: 4,
            angle: 45,
            distance: 50,
                isFolder: true,
                icon: '📁',
                parentId: 'ancient_philosophy',
                children: [
                  {
                    id: 'republic',
                    title: 'The Republic',
                    type: 'document',
                    importance: 5,
                    angle: 0,
                    distance: 40,
                    icon: '📖',
                    parentId: 'plato_works'
                  },
                  {
                    id: 'symposium',
                    title: 'Symposium',
                    type: 'document',
                    importance: 4,
                    angle: 180,
                    distance: 40,
                    icon: '📖',
                    parentId: 'plato_works'
                  }
                ]
          },
          {
                id: 'aristotle_works',
                title: '📚 Aristotle\'s Works',
            type: 'document',
                importance: 4,
            angle: 135,
                distance: 50,
                icon: '📖',
                parentId: 'ancient_philosophy'
              }
            ]
          },
          {
            id: 'modern_philosophy',
            title: '🏢 Modern Philosophy',
            type: 'folder',
            importance: 4,
            angle: 180,
            distance: 60,
            isFolder: true,
            icon: '📂',
            parentId: 'philosophy_folder',
            children: [
          {
                id: 'descartes',
                title: 'Descartes',
            type: 'document',
                importance: 4,
                angle: 90,
            distance: 45,
                icon: '📄',
                parentId: 'modern_philosophy'
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'communication',
    name: 'Communications',
    icon: '💬',
    color: '#ef4444',
    centerX: 1200,
    centerY: 500,
    items: [
      { id: 'c1', title: 'Important Emails', type: 'email', importance: 4, angle: 0, distance: 80 },
      { id: 'c2', title: 'Chat Archives', type: 'chat', importance: 2, angle: 72, distance: 60 },
      { id: 'c3', title: 'Meeting Recordings', type: 'media', importance: 3, angle: 144, distance: 70 },
      { id: 'c4', title: 'Contact List', type: 'document', importance: 3, angle: 216, distance: 65 },
      { id: 'c5', title: 'Calendar Events', type: 'event', importance: 4, angle: 288, distance: 75 }
    ]
  }
];

// Cross-constellation connections - exact copy from original
export const crossConstellationConnections: Array<[string, string]> = [
  ['w1', 'f1'], // Business report connects to bank statements
  ['w3', 'l1'], // Project proposal connects to course materials
  ['p3', 'f2'], // Vacation planning connects to investment portfolio
  ['l3', 'w4'], // Research papers connect to client presentation
  ['c1', 'w2'], // Important emails connect to team meeting notes
  // Add connections to folder contents
  ['project_folder', 'w3'], // Projects folder connects to work proposal
  ['documents_folder', 'p4'], // Documents folder connects to health records
  ['photos_folder', 'p1'], // Photos folder connects to family photos
  ['finance_folder', 'f1'], // Finance folder connects to bank statements
  ['philosophy_folder', 'l1'] // Philosophy folder connects to course materials
]; 