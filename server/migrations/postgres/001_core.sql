-- Target schema for nationwide multi-tenant deployment. Not applied to the current SQLite store.
-- Every business query must bind tenant_id; branch_id is mandatory for store activity.
CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE branches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,code)
);
CREATE TABLE users (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  display_name text NOT NULL,
  role_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id)
);
CREATE TABLE user_branch_grants (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  grant_code text NOT NULL,
  PRIMARY KEY (tenant_id,user_id,branch_id,grant_code),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sku_code text NOT NULL,
  name text NOT NULL,
  category_l1 text NOT NULL,
  category_l2 text,
  category_l3 text,
  serial_required boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('active','disabled')),
  retail_price_minor bigint NOT NULL DEFAULT 0 CHECK (retail_price_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,sku_code)
);
CREATE TABLE warehouses (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  name text NOT NULL,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE stock_balances (
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity bigint NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id,warehouse_id,product_id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,warehouse_id) REFERENCES warehouses(tenant_id,id),
  FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE serial_units (
  tenant_id uuid NOT NULL,
  serial_no text NOT NULL,
  product_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  warehouse_id uuid,
  status text NOT NULL CHECK (status IN ('in_stock','sold','returned','transferred','quarantine')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,serial_no),
  FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,warehouse_id) REFERENCES warehouses(tenant_id,id)
);
CREATE TABLE sales (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  business_no text NOT NULL,
  operator_id uuid NOT NULL,
  business_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('posted','part_returned','returned','reversed')),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id,id,business_at),
  UNIQUE (tenant_id,business_no,business_at),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,operator_id) REFERENCES users(tenant_id,id)
) PARTITION BY RANGE (business_at);
-- Monthly partitions are created ahead of time by migrations/operations.
CREATE TABLE sale_lines (
  tenant_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  sale_business_at timestamptz NOT NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  product_id uuid NOT NULL,
  serial_no text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  PRIMARY KEY (tenant_id,sale_id,sale_business_at,line_no),
  FOREIGN KEY (tenant_id,sale_id,sale_business_at) REFERENCES sales(tenant_id,id,business_at),
  FOREIGN KEY (tenant_id,product_id) REFERENCES products(tenant_id,id),
  FOREIGN KEY (tenant_id,serial_no) REFERENCES serial_units(tenant_id,serial_no)
);
CREATE TABLE ledger_entries (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  account_code text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit','credit')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  reversal_of uuid,
  PRIMARY KEY (tenant_id,id,occurred_at),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,operator_id) REFERENCES users(tenant_id,id)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE attendance (
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  user_id uuid NOT NULL,
  work_date date NOT NULL,
  check_in_at timestamptz NOT NULL,
  check_out_at timestamptz,
  PRIMARY KEY (tenant_id,branch_id,user_id,work_date),
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id),
  CHECK (check_out_at IS NULL OR check_out_at >= check_in_at)
);
CREATE TABLE audit_events (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  branch_id uuid,
  occurred_at timestamptz NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  before_hash text,
  after_hash text,
  request_id text,
  PRIMARY KEY (tenant_id,id,occurred_at),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES users(tenant_id,id)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_lines_serial_history ON sale_lines (tenant_id,serial_no) WHERE serial_no IS NOT NULL;
CREATE INDEX users_tenant_status ON users (tenant_id,status,role_code);
CREATE INDEX grants_branch_users ON user_branch_grants (tenant_id,branch_id,user_id);
CREATE INDEX attendance_branch_date ON attendance (tenant_id,branch_id,work_date);
CREATE INDEX sales_branch_date ON sales (tenant_id,branch_id,business_at DESC);
CREATE INDEX sales_operator_date ON sales (tenant_id,operator_id,business_at DESC);
CREATE INDEX ledger_branch_date ON ledger_entries (tenant_id,branch_id,occurred_at DESC);
CREATE INDEX audit_object_date ON audit_events (tenant_id,object_type,object_id,occurred_at DESC);
CREATE INDEX outbox_pending ON outbox_events (status,created_at) WHERE status IN ('pending','failed');


-- Application connections must SET LOCAL app.tenant_id inside every transaction.
-- The runtime database role must not be a superuser or have BYPASSRLS.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'branches','users','user_branch_grants','products','warehouses',
    'stock_balances','serial_units','sales','sale_lines','ledger_entries',
    'attendance','audit_events','outbox_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_scope ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END $$;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY own_tenant ON tenants USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
