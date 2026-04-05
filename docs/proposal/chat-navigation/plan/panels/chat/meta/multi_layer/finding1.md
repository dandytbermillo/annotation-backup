 Yes, the helper-contract gap is addressed.

  Findings

  1. The specific fix I asked for is now implemented.

  - lib/chat/routing-log/memory-action-builder.ts:52 now documents memory_semantic
  - the returned defaults are now memory_semantic across families at:
      - lib/chat/routing-log/memory-action-builder.ts:88
      - lib/chat/routing-log/memory-action-builder.ts:103
      - lib/chat/routing-log/memory-action-builder.ts:120
      - lib/chat/routing-log/memory-action-builder.ts:130
      - lib/chat/routing-log/memory-action-builder.ts:147
      - lib/chat/routing-log/memory-action-builder.ts:174

  2. The affected tests were rebased to the new helper contract.

  - __tests__/unit/routing-log/memory-action-builder.test.ts:116 now expects memory_semantic
  - __tests__/unit/chat/note-manifest-memory.test.ts:238 now expects memory_semantic
  - __tests__/unit/chat/stage5-shadow-telemetry.test.ts:492 now expects memory_semantic
  - __tests__/unit/chat/phase5-panel-registry-coverage.test.ts:605 now expects memory_semantic

  3. The runtime remains semantic-only and the B1 hot paths are still gone.

  - dispatcher B1 lookup removal is still in lib/chat/routing-dispatcher.ts:1446
  - no B1 branch remains in the arbiter action builder at lib/chat/chat-routing-clarification-
    intercept.ts:176
  - visible provenance is semantic/bounded only in lib/chat/chat-navigation-context.tsx:390 and
    components/chat/ChatMessageList.tsx:36

  4. One intentional deviation from the original delete step still exists.

  - lib/chat/routing-log/memory-reader.ts:1 still exists as a type shell
  - that is safe, and consistent with the earlier pragmatic exception, but it is technically not
    “deleted entirely” as the older B3 text said

  Verification
  Passed:

  - npm run type-check
  - npx jest --runInBand __tests__/unit/chat/bounded-arbiter-escape.test.ts __tests__/integration/
    chat/selection-intent-arbitration-dispatcher.test.ts __tests__/unit/chat/note-manifest-
    memory.test.ts __tests__/unit/routing-log/memory-action-builder.test.ts __tests__/unit/chat/
    phase5-panel-registry-coverage.test.ts __tests__/unit/chat/stage5-shadow-telemetry.test.ts
    __tests__/unit/routing-log/memory-writer.test.ts

  Verdict

  - the plan fix I suggested is addressed
  - the codebase is now semantic-only in runtime and in helper contracts
  - the B3 slice is safely implemented
  - only remaining caveat: memory-reader.ts is retained as a type shell rather than fully deleted,
    which is a safe, intentional deviation rather than a blocker