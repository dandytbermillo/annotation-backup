 Found the inconsistency. Current DB state vs the screenshots don't match — one source is stale.          
                                                                                                           
  What the DB shows right now                                           
                                                                                                           
  panel_id: 9add1baf-fab5-4ef4-a34c-b6869ca1cf59                                                           
  title: "Links Panel aaa"         ← three a's                                                             
  instance_label: "A"              ← rename drift, unchanged                                               
  last updated: 2026-04-13 01:26:12                                                                        
                                                                                                           
  The DB title is "Links Panel aaa" (three a's). instance_label is still 'A' — the same rename-handler bug 
  from earlier.                                                                                            
                                                                                                           
  What each UI surface shows

  ┌────────────────────────────────────┬────────────────────┬──────────────────────────────────────────┐   
  │              Surface               │  What it displays  │               Matches DB?                │
  ├────────────────────────────────────┼────────────────────┼──────────────────────────────────────────┤   
  │ Dashboard tile (Image 39,          │ LINKS PANEL AAA    │ ✓ matches Links Panel aaa (with CSS      │
  │ top-right)                         │                    │ uppercase)                               │
  ├────────────────────────────────────┼────────────────────┼──────────────────────────────────────────┤   
  │ Drawer title bar (Image 39, right  │ Links Panel aa     │ ✗ two a's only                           │
  │ side)                              │                    │                                          │   
  ├────────────────────────────────────┼────────────────────┼──────────────────────────────────────────┤   
  │ Clarifier option (Image 38)        │ Links Panel aa     │ ✗ two a's only                           │
  ├────────────────────────────────────┼────────────────────┼──────────────────────────────────────────┤   
  │ User's input                       │ open links panel   │ matches DB title                         │   
  │                                    │ aaa                │                                          │
  └────────────────────────────────────┴────────────────────┴──────────────────────────────────────────┘   
                  
  Two UI surfaces disagree with the DB.                                                                    
   
  Two separate drifts, not one                                                                             
                  
  Drift 1 — Rename did not fully propagate to all UI caches.                                               
  - DB: Links Panel aaa
  - Dashboard tile: reads fresh from DB → shows AAA ✓                                                      
  - Drawer title bar: cached / stale → shows aa ✗    
  - Clarifier: uses the dispatcher's visibleWidgets context which reads from a cached UI state, not fresh  
  DB → shows aa ✗                                                                                        
                                                                                                           
  So the rename updated the DB and the tile re-rendered, but the drawer title bar and the dispatcher's
  widget-snapshot both hold stale titles.                                                                  
                  
  Drift 2 — instance_label still not updated (the pre-existing rename handler bug).                        
  - After rename, title = 'Links Panel aaa' but instance_label = 'A'
  - Same single-letter-constraint + rename-handler issue as before                                         
  - The rename handler at app/api/dashboard/panels/[panelId]/route.ts:102 only writes title / position /
  size / z-index / visibility / config, never instance_label                                               
                                                                                                           
  Why this produces the screenshots                                                                        
                                                                                                           
  For open links panel aaa:
  - detectHintScope admits to Phase 5 (open + panel)                                                       
  - Phase 5 returns navigation candidates                                                                  
  - Stage 5 near-tie among A/B/C/D navigation seeds OR learned rows
  - Falls to clarification or bounded-LLM selection                                                        
  - Clarifier reads visibleWidgets from the dispatcher's context → stale snapshot shows Links Panel aa (two
   a's) because the dispatcher's uiContext wasn't invalidated on rename                                    
  - User sees clarifier options showing Links Panel aa as option #1 even though:                           
    - User typed aaa (three a's)                                                                           
    - DB actually stores aaa (three a's)                                                                   
    - Dashboard tile correctly shows AAA                                                                   
                                                                                                           
  The clarifier's stale snapshot is why the user's input shape doesn't match any option label exactly.     
                                                                                                           
  Confirming "stale snapshot" hypothesis                                                                   
                                                                                                           
  The two UI surfaces that are stale (drawer title bar + clarifier) share a common source: they both depend
   on the in-memory panel state that the React frontend holds. The dashboard tile re-fetches from the
  server API on render.                                                                                    
                  
  When a rename happens via the API endpoint:                                                              
  1. Server writes the new title to workspace_panels ✓
  2. API response returns success                                                                          
  3. Client-side panel state may or may not refresh — depends on how the rename handler invalidates caches
  4. The dispatcher reads from ctx.uiContext.dashboard.visibleWidgets which is sourced from the same client
   cache                                                                                                   
  5. If the cache isn't invalidated, the dispatcher + drawer title bar both see stale aa                   
  6. But the dashboard tile component that re-reads from the API shows fresh aaa                           
                                                                                                           
  To confirm, I'd want to look at the rename-handler UI code path (components/dashboard/DashboardView.tsx  
  around line 1292 where the PATCH is sent) and check whether it updates the client-side state after the   
  server response.                                                                                         
                                                                                                           
  Three distinct bugs now visible                                                                          
   
  #: 1                                                                                                     
  Bug: Client state not invalidated after rename                                                        
  Location: Rename handler in DashboardView.tsx:~1292 or its caller                                        
  Effect: Drawer title bar + dispatcher's visibleWidgets stale. NEW finding from these screenshots.     
  ────────────────────────────────────────                                                                 
  #: 2                                                                                                     
  Bug: instance_label not updated with title                                                            
  Location: Server API allowlist in app/api/dashboard/panels/[panelId]/route.ts:102                        
  Effect: Duplicate-family resolution broken for renamed panels. Known from earlier.                       
  ────────────────────────────────────────
  #: 3                                                                                                     
  Bug: Title-match in state-info registry is exact-string
  Location: state-info-resolvers.ts:244-247                                                                
  Effect: is links panel a open? returns "not visible" for renamed panels. Known from earlier.

  Bug 1 is a separate UI sync bug from bugs 2/3. Fixing the server-side rename handler (bug 2) won't fix   
  bug 1 because bug 1 is client-side cache invalidation.
                                                                                                           
  Direct answer to your question

  After the rename from Links Panel aaa → Links Panel aa:                                                  
   
  If you're saying the DB rename was intended to produce aa but the DB ended up at aaa, then the rename    
  operation didn't persist to the server — only the client's optimistic UI updated, which explains why the
  drawer title and clarifier reflect the intended new name but the dashboard tile (which reads from server)
   shows the old one.

  If instead the rename sequence was different (e.g., aa → aaa was the latest actual change), then the     
  client cache wasn't invalidated after the server commit, so the drawer and dispatcher still see the
  pre-rename snapshot while the dashboard tile reflects fresh DB state.                                    
                  
  Either way, the fix is at the rename-handler layer: ensure the server commit completes AND the client    
  state is invalidated/re-fetched. Want me to investigate the exact rename-handler flow in
  DashboardView.tsx:~1292 to identify which of the two scenarios is happening?       