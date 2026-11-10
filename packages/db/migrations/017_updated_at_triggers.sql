-- MIGRATION 017 - updated_at triggers --------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.table_schema, c.table_name
           FROM information_schema.columns c
           JOIN information_schema.tables t USING (table_schema, table_name)
           WHERE c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
             AND c.table_schema IN ('core','iam','crm','catalog','pricing','inventory','sales',
                                    'procurement','logistics','payments','delivery','notify','finance')
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %I.%I
                    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()',
                   r.table_name, r.table_schema, r.table_name);
  END LOOP;
END $$;
