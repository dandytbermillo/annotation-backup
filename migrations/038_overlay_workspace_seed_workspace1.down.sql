-- Remove seeded "Workspace 1" snapshot

BEGIN;

DELETE FROM workspaces WHERE name = 'Workspace 1';

COMMIT;
