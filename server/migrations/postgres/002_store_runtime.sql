-- Executable compatibility runtime; 001_core.sql remains a future normalized-domain draft.
CREATE TABLE IF NOT EXISTS erp_tenants(id uuid PRIMARY KEY,code text NOT NULL UNIQUE,name text NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN('active','disabled')));
CREATE TABLE IF NOT EXISTS erp_branches(tenant_id uuid NOT NULL REFERENCES erp_tenants(id),id uuid NOT NULL,code text NOT NULL,name text NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN('active','disabled')),PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,code));
CREATE TABLE IF NOT EXISTS erp_metadata(tenant_id uuid NOT NULL,branch_id uuid NOT NULL,key text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(tenant_id,branch_id,key),FOREIGN KEY(tenant_id,branch_id) REFERENCES erp_branches(tenant_id,id));
CREATE TABLE IF NOT EXISTS erp_records(tenant_id uuid NOT NULL,branch_id uuid NOT NULL,collection text NOT NULL,record_key text NOT NULL,rank numeric NOT NULL,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,branch_id,collection,record_key),FOREIGN KEY(tenant_id,branch_id) REFERENCES erp_branches(tenant_id,id));
CREATE INDEX IF NOT EXISTS erp_records_order ON erp_records(tenant_id,branch_id,collection,rank);
CREATE INDEX IF NOT EXISTS erp_records_date ON erp_records(tenant_id,branch_id,collection,(data->>'createdAt'),record_key);
CREATE INDEX IF NOT EXISTS erp_records_source ON erp_records(tenant_id,branch_id,collection,(data->>'sourceId'));
CREATE INDEX IF NOT EXISTS erp_records_operator ON erp_records(tenant_id,branch_id,collection,(data->>'operatorId'),(data->>'createdAt'));
CREATE INDEX IF NOT EXISTS erp_records_salesperson ON erp_records(tenant_id,branch_id,collection,(data->>'salespersonId'),(data->>'createdAt'));
CREATE INDEX IF NOT EXISTS erp_records_customer ON erp_records(tenant_id,branch_id,collection,(data->>'phone'));
CREATE TABLE IF NOT EXISTS erp_shared_records(tenant_id uuid NOT NULL REFERENCES erp_tenants(id),collection text NOT NULL,record_key text NOT NULL,rank numeric NOT NULL,data jsonb NOT NULL,PRIMARY KEY(tenant_id,collection,record_key));
CREATE INDEX IF NOT EXISTS erp_shared_order ON erp_shared_records(tenant_id,collection,rank);
CREATE INDEX IF NOT EXISTS erp_shared_owner ON erp_shared_records(tenant_id) WHERE collection='users' AND data->>'roleCode'='owner';
CREATE INDEX IF NOT EXISTS erp_shared_membership ON erp_shared_records USING gin((data->'branchIds')) WHERE collection='users';
CREATE TABLE IF NOT EXISTS erp_serial_units(tenant_id uuid NOT NULL,branch_id uuid NOT NULL,serial_no text NOT NULL,inventory_key text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(tenant_id,serial_no),FOREIGN KEY(tenant_id,branch_id) REFERENCES erp_branches(tenant_id,id));
CREATE INDEX IF NOT EXISTS erp_serial_stock ON erp_serial_units(tenant_id,branch_id,inventory_key);
CREATE INDEX IF NOT EXISTS erp_serial_tail ON erp_serial_units(tenant_id,branch_id,(right(serial_no,4)));
CREATE TABLE IF NOT EXISTS erp_files(tenant_id uuid NOT NULL REFERENCES erp_tenants(id),sha256 text NOT NULL,content bytea NOT NULL,PRIMARY KEY(tenant_id,sha256));
CREATE TABLE IF NOT EXISTS erp_credentials(tenant_id uuid NOT NULL REFERENCES erp_tenants(id),user_id text NOT NULL,username text NOT NULL,salt text NOT NULL,password_hash text NOT NULL,failures integer NOT NULL DEFAULT 0,locked_until bigint NOT NULL DEFAULT 0,PRIMARY KEY(tenant_id,user_id),UNIQUE(tenant_id,username));
-- Opaque hashed tokens must be resolved before trusted tenant context can be established.
CREATE TABLE IF NOT EXISTS erp_sessions(token_hash text PRIMARY KEY,tenant_id uuid NOT NULL,branch_id uuid NOT NULL,user_id text NOT NULL,expires_at bigint NOT NULL,FOREIGN KEY(tenant_id,branch_id) REFERENCES erp_branches(tenant_id,id));
CREATE INDEX IF NOT EXISTS erp_sessions_user ON erp_sessions(tenant_id,user_id);
CREATE INDEX IF NOT EXISTS erp_sessions_expiry ON erp_sessions(expires_at);
CREATE TABLE IF NOT EXISTS erp_outbox(id bigserial PRIMARY KEY,tenant_id uuid NOT NULL,branch_id uuid NOT NULL,event jsonb NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sent','failed')),attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,FOREIGN KEY(tenant_id,branch_id) REFERENCES erp_branches(tenant_id,id));
CREATE INDEX IF NOT EXISTS erp_outbox_pending ON erp_outbox(next_at,id) WHERE status IN('pending','failed');
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['erp_metadata','erp_records','erp_serial_units','erp_outbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='branch_scope') THEN
   EXECUTE format('CREATE POLICY branch_scope ON %I USING (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid AND branch_id=NULLIF(current_setting(''app.branch_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid AND branch_id=NULLIF(current_setting(''app.branch_id'',true),'''')::uuid)',t);
  END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['erp_shared_records','erp_files','erp_credentials','erp_branches'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='tenant_scope') THEN
   EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION erp_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.collection='operationLogs' THEN RAISE EXCEPTION 'Audit events are append only'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS erp_audit_protection ON erp_records;
CREATE TRIGGER erp_audit_protection BEFORE UPDATE OR DELETE ON erp_records FOR EACH ROW EXECUTE FUNCTION erp_audit_immutable();
