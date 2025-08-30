# Batching Method Flow Diagrams

## Main Batching Flow

```mermaid
graph TD
    A[User Edit] --> B[YJS Update Generated]
    B --> C{Is Online?}
    
    C -->|Yes| D[Enqueue Update]
    C -->|No| E[Queue to LocalStorage]
    
    D --> F{Check Flush Triggers}
    
    F -->|Size Exceeded| G[Flush: Size Trigger]
    F -->|Count Exceeded| H[Flush: Count Trigger]
    F -->|Within Limits| I[Reset Timer]
    
    I --> J[Debounce Wait]
    J --> K[Timeout Elapsed]
    K --> L[Flush: Timeout Trigger]
    
    G --> M[Coalesce Updates]
    H --> M
    L --> M
    
    M --> N[YJS Merge Updates]
    N --> O[Single Batch Write]
    O --> P[PostgreSQL]
    
    P --> Q[Update Metrics]
    Q --> R[Clear Queue]
    
    E --> S[Wait for Online]
    S --> T[Online Detected]
    T --> U[Process Offline Queue]
    U --> D
```

## Detailed Update Processing

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant YJS
    participant Batching
    participant Queue
    participant Timer
    participant API
    participant DB
    
    User->>UI: Edit Document
    UI->>YJS: Apply Changes
    YJS->>Batching: persist(update)
    
    Batching->>Queue: Enqueue Update
    Queue-->>Batching: Queue Stats
    
    alt Size/Count Exceeded
        Batching->>Batching: Trigger Immediate Flush
    else Within Limits
        Batching->>Timer: Reset Debounce Timer
        Timer-->>Timer: Wait (debounce + timeout)
        Timer->>Batching: Timeout Reached
    end
    
    Batching->>Queue: Get All Updates
    Queue-->>Batching: Update Array
    
    Batching->>YJS: mergeUpdates(array)
    YJS-->>Batching: Merged Update
    
    Batching->>API: POST /api/persistence
    API->>DB: INSERT/UPDATE
    DB-->>API: Success
    API-->>Batching: 200 OK
    
    Batching->>Queue: Clear Queue
    Batching->>Batching: Update Metrics
```

## Flush Decision Tree

```mermaid
graph TD
    A[New Update Arrives] --> B{Queue Empty?}
    
    B -->|Yes| C[Start New Queue]
    B -->|No| D[Add to Queue]
    
    C --> E[Set Timer]
    D --> F{Size Check}
    
    F -->|totalSize >= maxBytes| G[Flush: Size]
    F -->|totalSize < maxBytes| H{Count Check}
    
    H -->|count >= maxCount| I[Flush: Count]
    H -->|count < maxCount| J[Reset Timer]
    
    E --> K[Wait for Timer]
    J --> K
    
    K --> L{Timer Expired?}
    L -->|Yes| M[Flush: Timeout]
    L -->|No| N{New Update?}
    
    N -->|Yes| A
    N -->|No| K
    
    G --> O[Execute Flush]
    I --> O
    M --> O
    
    O --> P[Merge Updates]
    P --> Q[Persist to DB]
    Q --> R[Update Metrics]
    R --> S[Clear Queue]
```

## Offline Synchronization Flow

```mermaid
graph LR
    A[Offline Mode] --> B[Updates Generated]
    B --> C[Queue in LocalStorage]
    
    C --> D{Network Status}
    D -->|Still Offline| E[Continue Queueing]
    E --> C
    
    D -->|Online Detected| F[Load Queue from Storage]
    F --> G[Process Each Operation]
    
    G --> H{Operation Type}
    H -->|Create| I[POST Create]
    H -->|Update| J[POST Update]
    H -->|Delete| K[DELETE]
    
    I --> L{Success?}
    J --> L
    K --> L
    
    L -->|Yes| M[Remove from Queue]
    L -->|No| N{Retry Count}
    
    N -->|< 3| O[Exponential Backoff]
    N -->|>= 3| P[Mark Failed]
    
    O --> Q[Schedule Retry]
    Q --> G
    
    M --> R{More Operations?}
    R -->|Yes| G
    R -->|No| S[Clear LocalStorage]
    
    P --> T[Log Error]
    T --> R
```

## Metrics Collection Flow

```mermaid
graph TD
    A[Update Enqueued] --> B[totalUpdates++]
    
    C[Flush Triggered] --> D{Flush Reason}
    D -->|Timeout| E[flushReasons.timeout++]
    D -->|Size| F[flushReasons.size++]
    D -->|Count| G[flushReasons.count++]
    D -->|Manual| H[flushReasons.manual++]
    
    E --> I[Execute Flush]
    F --> I
    G --> I
    H --> I
    
    I --> J{Coalesce Enabled?}
    J -->|Yes| K[Merge Updates]
    J -->|No| L[Use Original]
    
    K --> M[Calculate Compression]
    M --> N[compressionRatio = original/merged]
    
    L --> O[compressionRatio = 1]
    
    N --> P[Persist to DB]
    O --> P
    
    P --> Q{Success?}
    Q -->|Yes| R[totalBatches++]
    Q -->|No| S[errors++]
    
    R --> T[Calculate Averages]
    T --> U[averageBatchSize = totalUpdates/totalBatches]
    U --> V[Update UI Metrics]
    
    S --> W[Log Error]
    W --> X[Re-queue Updates]
```

## Component Architecture

```mermaid
graph TB
    subgraph "Frontend Layer"
        A[React Components]
        B[YJS Documents]
        C[Batching Monitor UI]
    end
    
    subgraph "Batching Layer"
        D[BatchingPersistenceProvider]
        E[Document Queues]
        F[Debounce Timers]
        G[Metrics Collector]
    end
    
    subgraph "Persistence Layer"
        H[PostgresAPIAdapter]
        I[PostgresOfflineAdapter]
        J[LocalSyncQueue]
    end
    
    subgraph "Storage Layer"
        K[PostgreSQL Database]
        L[LocalStorage]
        M[IndexedDB Fallback]
    end
    
    A --> B
    B --> D
    C --> G
    
    D --> E
    D --> F
    D --> G
    
    E --> H
    H --> K
    
    I --> J
    J --> L
    
    H -.fallback.-> M
    I -.offline.-> J
```

## Performance Impact Visualization

```
Before Batching:
Time: 0s   1s   2s   3s   4s   5s
Writes: |W|W|W|W|W|W|W|W|W|W|W|W|W|W|W|
DB Load: ████████████████████████████████
Network: ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑

After Batching:
Time: 0s   1s   2s   3s   4s   5s
Writes: |     B     |     B     |
DB Load: ██          ██
Network: ↑           ↑

Legend:
W = Individual Write
B = Batched Write
█ = Database Load
↑ = Network Request
```

## State Machine Diagram

```mermaid
stateDiagram-v2
    [*] --> Idle
    
    Idle --> Queueing: Update Received
    
    Queueing --> Flushing: Trigger Met
    Queueing --> Queueing: Update Added
    
    Flushing --> Merging: Start Flush
    
    Merging --> Persisting: Updates Merged
    Merging --> Persisting: Merge Failed (Sequential)
    
    Persisting --> Success: Write Success
    Persisting --> Error: Write Failed
    
    Success --> Idle: Queue Cleared
    
    Error --> Retrying: Retry Logic
    Error --> Failed: Max Retries
    
    Retrying --> Persisting: Backoff Complete
    
    Failed --> Idle: Error Logged
    
    state Queueing {
        [*] --> Collecting
        Collecting --> SizeCheck
        SizeCheck --> CountCheck: Size OK
        SizeCheck --> TriggerFlush: Size Exceeded
        CountCheck --> TimerReset: Count OK
        CountCheck --> TriggerFlush: Count Exceeded
        TimerReset --> Collecting
        TriggerFlush --> [*]
    }
```

## Memory Management Flow

```mermaid
graph TD
    A[Update Created] --> B[Allocate Memory]
    B --> C[Add to Queue]
    
    C --> D{Memory Check}
    D -->|Below Threshold| E[Continue]
    D -->|Above Threshold| F[Force Flush]
    
    E --> G[Timer Active]
    F --> H[Immediate Flush]
    
    G --> I{Timer Expired?}
    I -->|No| J[Wait]
    I -->|Yes| K[Flush Queue]
    
    H --> L[Merge Updates]
    K --> L
    
    L --> M[Free Queue Memory]
    M --> N[Single Update in Memory]
    N --> O[Send to Database]
    O --> P[Free Update Memory]
    
    P --> Q[Garbage Collection]
    Q --> R[Memory Released]
    
    J --> G
```