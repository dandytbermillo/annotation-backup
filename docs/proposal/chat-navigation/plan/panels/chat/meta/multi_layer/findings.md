 Let me restate the diagnosis properly.
                                                                                                              
  Corrected diagnosis      

  The screenshot proves three distinct bugs, not one:                                                             
   
  Bug 1 — Dedupe miss. The curated seed (target_name: 'links panel h', lowercase) and the T17 synthetic           
  (target_name: 'Links Panel H', title-case) have different candidateIdentity strings because identity uses raw
  target_name at routing-dispatcher.ts:2479. They're logically the same candidate but survive dedupe as two       
  separate entries. Fix: canonicalize target_name to lowercase in candidateIdentity for state_info candidates.

  Bug 2 — Question-policy leak. Option 1 ("Links Panel F, open_panel 98%") is a navigation candidate that should  
  not appear in a clarifier for an explicit is <panel> open? question. The clarifier pool builder at
  routing-dispatcher.ts:3448-3451 filters by executorKindFor(action_type) and allows both 'navigation' and        
  'state_info_registry'. For an explicit state-info question, navigation candidates should be suppressed from the
  clarifier. Fix: when isStateInfoQuestion(ctx.trimmedInput) is true, filter the clarifier pool to
  state_info_registry only.

  Bug 3 — Clarifier label not live-bound. Option 2 shows lowercase "Is links panel h op..." (from the seed's raw  
  target_name) while option 3 shows title-case "Is Links Panel H..." (from T17's live title). Per the plan's
  clarifier contract, labels should come from live current widget titles, not raw seed target_name. This is a plan
   violation in the presentation layer at routing-dispatcher.ts:3472-3473 where the label is built from
  slots?.target_name.

  Corrected fix direction

  Not "disable T17" — instead:                                                                                    
   
  1. Canonicalize state_info dedupe — lowercase targetName in candidateIdentity for action_type === 'state_info'  
  so the curated seed and synthetic collapse into one entry. Prefer the curated seed (first in pool) since it has
  all MemoryLookupResult fields.                                                                                  
  2. Suppress navigation candidates from state-info clarifiers — when isStateInfoQuestion(ctx.trimmedInput) is
  true, filter the clarifier-ready pool at :3448-3451 to state_info_registry kind only. This removes "Links Panel 
  F (open_panel 98%)" from the options.
  3. Live-bind clarifier labels for state_info pills — at :3472-3473, resolve target_name against installedWidgets
   to get the current live title instead of displaying the raw seed string.                                       
  4. Then evaluate whether T17 can retire once pre-seed coverage is confirmed complete. T17 becomes redundant if
  every installed widget gets seeded at creation time. But T17 is not the root cause — dedupe and policy are.     
                  
  Want me to proceed with fixes 1 and 2 first? Those are the two that directly unblock the "strong winner instead 
  of clarifier" outcome. Fix 3 is a presentation cleanup. Fix 4 is a future architectural decision.