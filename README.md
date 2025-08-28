# Dual-Mode Annotation System

A modern annotation system built with Next.js and TipTap that supports both offline single-user mode (Option A) and real-time collaborative editing (Option B). This application provides a canvas-based interface for creating and managing annotations with flexible deployment options.

## 🚀 Features

### Core Functionality
- **Dual-Mode Support**: Switch between offline single-user (Option A) and collaborative (Option B) modes
- **Canvas-based Interface**: Drag and drop panels with visual connections
- **Rich Text Editing**: TipTap editor with optional collaborative features
- **Branch-based Annotations**: Three types of annotations (note, explore, promote)
- **Offline-first Architecture**: Works without internet, syncs when connected

### Option A: Plain Offline Mode (Current Default)
- **PostgreSQL Persistence**: Direct database storage without CRDTs
- **Single-user Focus**: Optimized for individual use cases
- **Simpler Architecture**: No Yjs overhead when collaboration isn't needed
- **Electron Support**: Local PostgreSQL failover for desktop apps

### Option B: Real-time Collaboration Mode (Future)
- **YJS Integration**: Conflict-free collaborative editing
- **Real-time Sync**: Multiple users can edit simultaneously
- **Awareness Protocol**: User presence and cursor tracking
- **CRDT-based**: Automatic conflict resolution

## 🛠️ Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Editor**: TipTap (with optional YJS collaboration)
- **Styling**: Tailwind CSS, Radix UI
- **Storage (Option A)**: PostgreSQL with JSON/JSONB
- **Storage (Option B)**: YJS CRDTs, IndexedDB
- **State Management**: Map-based stores (Option A) or YJS CRDTs (Option B)

## 📦 Installation

### Prerequisites
- Node.js 18+ 
- PostgreSQL 14+ (for Option A)
- Docker (optional, for PostgreSQL)

### Setup Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/dandytbermillo/annotation.git
   cd annotation
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   pnpm install
   # or
   yarn install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` with your database credentials:
   ```env
   DATABASE_URL=postgresql://user:password@localhost:5432/annotation_db
   NEXT_PUBLIC_COLLAB_MODE=plain  # Use 'plain' for Option A or 'yjs' for Option B
   ```

4. **Setup PostgreSQL** (for Option A)
   
   Using Docker:
   ```bash
   docker compose up -d postgres
   ```
   
   Or install PostgreSQL locally and create database:
   ```sql
   CREATE DATABASE annotation_db;
   ```

5. **Run database migrations**
   ```bash
   npm run db:migrate
   # or manually apply migrations from migrations/ folder
   ```

6. **Run the development server**
   ```bash
   npm run dev
   # or
   pnpm dev
   # or
   yarn dev
   ```

7. **Open in browser**
   Open [http://localhost:3000](http://localhost:3000) to view the application.

## 🎯 Usage

### Creating Annotations
1. **Select text** in any editor panel
2. **Choose annotation type**: Note (blue), Explore (orange), or Promote (green)
3. **Add content** in the new branch panel
4. **Connect panels** by dragging between connection points

### Collaboration
- **Multiple users** can edit simultaneously
- **Real-time updates** across all connected clients
- **Cursor awareness** shows other users' positions
- **Conflict resolution** handled automatically by YJS

### Navigation
- **Drag panels** to reposition them on the canvas
- **Zoom controls** for better overview
- **Minimap** for quick navigation
- **Notes explorer** for managing multiple documents

## 🏗️ Architecture

### Dual-Mode Design
The system supports two operational modes:

#### Option A: Plain Offline Mode (Current Default)
```
User Input → TipTap Editor → PlainOfflineProvider → PostgreSQL
                              ↓
                        Map-based State Store
```
- Direct PostgreSQL persistence
- No CRDT overhead
- Simpler data flow
- Single-user optimized

#### Option B: Collaborative Mode (Future)
```
User Input → TipTap Editor → YJS Document → Persistence Layer
                                ↓
                         Other Connected Users
```
- YJS CRDT synchronization
- Real-time collaboration
- Conflict-free updates
- Multi-user awareness

### Storage Layers by Mode

#### Option A Storage:
1. **PostgreSQL**: Primary storage for all data
2. **Memory**: Runtime state in Map structures
3. **LocalStorage**: User preferences only

#### Option B Storage:
1. **YJS Documents**: Real-time collaborative state
2. **IndexedDB**: Binary document snapshots
3. **PostgreSQL**: Long-term persistence
4. **Memory**: Runtime application state

### Platform Support
- **Web Mode**: API-based PostgreSQL access
- **Electron Mode**: Direct PostgreSQL with failover
- **Migration Ready**: Easy switching between modes

## 📁 Project Structure

```
annotation/
├── app/                    # Next.js app directory
├── components/            # React components
│   ├── canvas/           # Canvas-related components
│   ├── ui/               # Reusable UI components
│   └── ...
├── lib/                   # Utility libraries
│   ├── adapters/         # Storage adapters
│   ├── sync/             # Synchronization logic
│   └── ...
├── hooks/                 # Custom React hooks
├── types/                 # TypeScript type definitions
└── docs/                  # Documentation
```

## 🔧 Configuration

### Environment Variables
See `.env.example` for a complete list. Key variables:

```env
# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/annotation_db

# Collaboration Mode
NEXT_PUBLIC_COLLAB_MODE=plain  # 'plain' or 'yjs'

# Option B Only: WebSocket server for collaboration
NEXT_PUBLIC_WS_URL=wss://your-server.com

# Option B Only: WebRTC signaling server
NEXT_PUBLIC_WEBRTC_SIGNALING=wss://signaling.example.com
```

### Mode Configuration
The system uses a mode switcher to toggle between:
- **Option A (Plain Mode)**: PostgreSQL-backed single-user mode
- **Option B (YJS Mode)**: Real-time collaborative mode with CRDTs

To switch modes:
1. Set `NEXT_PUBLIC_COLLAB_MODE` in `.env.local`
2. Restart the development server
3. Clear browser cache if switching from Option B to Option A

## 🚀 Deployment

### Vercel (Recommended)
1. Push to GitHub
2. Connect repository to Vercel
3. Deploy automatically

### Docker
```bash
# Build the image
docker build -t annotation-system .

# Run the container
docker run -p 3000:3000 annotation-system
```

### Static Export
```bash
npm run build
npm run export
```

## 🔄 Migration Guide

### To Database (PostgreSQL/MySQL)
1. Implement `DatabasePersistenceAdapter`
2. Export YJS binary data
3. Import to database tables
4. Update provider configuration

### To Electron
1. Replace web adapter with `ElectronPersistenceAdapter`
2. Add SQLite dependency
3. Package with electron-builder
4. Enable file system features

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📝 License

This project is private and proprietary.

## 🐛 Issues & Support

For issues and support, please create an issue in the GitHub repository.

## 🙏 Acknowledgments

- **YJS**: For the amazing CRDT implementation
- **TipTap**: For the excellent rich text editor
- **Radix UI**: For accessible UI components
- **Next.js**: For the robust React framework

---

**Built with ❤️ for collaborative annotation and knowledge management.** 