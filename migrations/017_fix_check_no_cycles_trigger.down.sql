-- Revert to original check_no_cycles function (with the bug)
CREATE OR REPLACE FUNCTION check_no_cycles() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM items WHERE id = NEW.parent_id
      UNION ALL
      SELECT i.id, i.parent_id FROM items i 
      JOIN ancestors a ON i.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id LIMIT 1;
    
    IF FOUND THEN 
      RAISE EXCEPTION 'Circular reference detected: Cannot move item into its own subtree';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;