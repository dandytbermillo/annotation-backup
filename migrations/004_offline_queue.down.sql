-- Drop offline queue table and related objects
DROP TRIGGER IF EXISTS offline_queue_updated_at_trigger ON offline_queue;
DROP FUNCTION IF EXISTS update_offline_queue_updated_at();
DROP TABLE IF EXISTS offline_queue;
DROP TYPE IF EXISTS offline_operation_status;