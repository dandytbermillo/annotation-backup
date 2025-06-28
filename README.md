# YJS-Based Collaborative Annotation System

A modern, real-time collaborative annotation system built with Next.js, YJS, and TipTap. This application provides a canvas-based interface for creating and managing annotations with real-time collaboration capabilities.

## 🚀 Features

### Core Functionality
- **Real-time Collaboration**: Multiple users can edit simultaneously using YJS CRDTs
- **Canvas-based Interface**: Drag and drop panels with visual connections
- **Rich Text Editing**: TipTap editor with collaborative cursors and awareness
- **Branch-based Annotations**: Three types of annotations (note, explore, promote)
- **Offline-first Architecture**: Works without internet, syncs when connected

### Advanced Features
- **YJS Integration**: Conflict-free collaborative editing
- **IndexedDB Persistence**: Client-side data storage with snapshots
- **Awareness Protocol**: Real-time user presence and cursor tracking
- **Migration-ready**: Easily adaptable to database or Electron
- **Performance Optimized**: Lazy loading and memory management

## 🛠️ Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Collaboration**: YJS, TipTap Editor
- **Styling**: Tailwind CSS, Radix UI
- **Storage**: LocalStorage, IndexedDB
- **State Management**: YJS CRDTs, React Context

## 📦 Installation

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

3. **Run the development server**
   ```bash
   npm run dev
   # or
   pnpm dev
   # or
   yarn dev
   ```

4. **Open in browser**
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

### Storage Layers
1. **LocalStorage**: Basic metadata and user preferences
2. **IndexedDB**: Binary document data and snapshots
3. **YJS Documents**: Real-time collaborative state
4. **Memory**: Runtime application state

### Collaboration Flow
```
User Input → TipTap Editor → YJS Document → Persistence Layer
                                ↓
                         Other Connected Users
```

### Migration Paths
- **Database Migration**: PostgreSQL, MySQL, MongoDB
- **Electron App**: Desktop application with SQLite
- **Cloud Sync**: Hybrid local-first with server backup

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
Create a `.env.local` file for configuration:

```env
# Enable enhanced provider (optional)
NEXT_PUBLIC_USE_ENHANCED_PROVIDER=false

# WebSocket server for collaboration (optional)
NEXT_PUBLIC_WS_URL=wss://your-server.com

# WebRTC signaling server (optional)
NEXT_PUBLIC_WEBRTC_SIGNALING=wss://signaling.example.com
```

### Provider Configuration
The system uses a provider switcher that can toggle between:
- **Standard Provider**: Basic YJS with localStorage
- **Enhanced Provider**: Advanced features with IndexedDB

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