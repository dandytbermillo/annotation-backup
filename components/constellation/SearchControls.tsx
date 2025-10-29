'use client';

import React from 'react';
import { ItemType } from '@/types/constellation';

interface SearchControlsProps {
  searchQuery: string;
  filterType: ItemType | 'all';
  onSearchChange: (query: string) => void;
  onFilterChange: (type: ItemType | 'all') => void;
}

export default function SearchControls({
  searchQuery,
  filterType,
  onSearchChange,
  onFilterChange,
}: SearchControlsProps) {
  return (
    <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-30 flex gap-3">
      {/* Search input */}
      <input
        type="text"
        placeholder="Search your data constellation..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-80 px-4 py-2 bg-slate-800/90 border border-slate-600/50 rounded-lg text-slate-200 text-sm outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 placeholder-slate-400"
      />
      
      {/* Type filter */}
      <select
        value={filterType}
        onChange={(e) => onFilterChange(e.target.value as ItemType | 'all')}
        className="px-3 py-2 bg-slate-800/90 border border-slate-600/50 rounded-lg text-slate-200 text-sm outline-none transition-all duration-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 cursor-pointer"
      >
        <option value="all">All Types</option>
        <option value="document">📄 Documents</option>
        <option value="note">📝 Notes</option>
        <option value="presentation">📊 Presentations</option>
        <option value="spreadsheet">📋 Spreadsheets</option>
        <option value="email">📧 Emails</option>
        <option value="media">🎬 Media</option>
        <option value="receipt">🧾 Receipts</option>
        <option value="chat">💬 Chats</option>
        <option value="event">📅 Events</option>
        <option value="folder">📁 Folders</option>
      </select>
      
      {/* Pan controls */}
      <div className="flex gap-1 bg-slate-800/90 p-1 rounded-lg border border-slate-600/50">
        <button className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded transition-all duration-200 text-sm">
          ↑
        </button>
        <button className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded transition-all duration-200 text-sm">
          ↓
        </button>
        <button className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded transition-all duration-200 text-sm">
          ←
        </button>
        <button className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 rounded transition-all duration-200 text-sm">
          →
        </button>
      </div>
    </div>
  );
} 