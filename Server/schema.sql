-- =============================================================
-- Cloud-Based-POS-System — full schema
-- Run against a fresh Neon PostgreSQL database
-- =============================================================

-- ─── Role ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Role" (
    role_id   SERIAL PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE
);

-- ─── Company ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Company" (
    com_id   SERIAL PRIMARY KEY,
    com_name VARCHAR(255) NOT NULL UNIQUE,
    c_status BOOLEAN      NOT NULL DEFAULT TRUE,
    c_email  VARCHAR(255),
    reg_date DATE,
    location VARCHAR(255),
    phone    VARCHAR(50)
);

-- ─── Branch ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Branch" (
    "B_id"      SERIAL PRIMARY KEY,
    "B_name"    VARCHAR(255) NOT NULL,
    "B_email"   VARCHAR(255) UNIQUE,
    "B_conNo"   VARCHAR(50)  UNIQUE,
    "B_address" VARCHAR(255),
    com_id      INTEGER      NOT NULL REFERENCES "Company"(com_id),
    "B_status"  BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ─── User ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "User" (
    u_id        SERIAL PRIMARY KEY,
    u_fname     VARCHAR(100),
    u_lname     VARCHAR(100),
    u_email     VARCHAR(255) NOT NULL UNIQUE,
    u_pw        VARCHAR(255) NOT NULL,
    u_connumber VARCHAR(50),
    role_id     INTEGER REFERENCES "Role"(role_id),
    u_status    BOOLEAN NOT NULL DEFAULT TRUE,
    "B_id"      INTEGER REFERENCES "Branch"("B_id"),
    com_id      INTEGER REFERENCES "Company"(com_id)
);

-- ─── category ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "category" (
    cat_id   SERIAL PRIMARY KEY,
    cat_name VARCHAR(100) NOT NULL UNIQUE
);

-- ─── Product ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Product" (
    pro_id      SERIAL PRIMARY KEY,
    pro_name    VARCHAR(255) NOT NULL,
    pro_qty     NUMERIC(10,2),
    pro_price   NUMERIC(10,2),
    " pro_image" VARCHAR(500),
    "Com_id"    INTEGER REFERENCES "Company"(com_id),
    cat_id      INTEGER REFERENCES "category"(cat_id),
    add_ons     JSONB,
    stations    JSONB
);

-- ─── Branch_Product ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Branch_Product" (
    "Bpro_id"       SERIAL PRIMARY KEY,
    pro_name        VARCHAR(255),
    " pro_shortname" VARCHAR(100),
    " pro_image"     VARCHAR(500),
    " pro_des"       TEXT,
    pro_quantity    NUMERIC(10,2),
    " Pro_Price"     NUMERIC(10,2),
    "Cat_id"        INTEGER REFERENCES "category"(cat_id),
    pro_id          INTEGER REFERENCES "Product"(pro_id),
    "B_id"          INTEGER REFERENCES "Branch"("B_id")
);

-- ─── CUSTOMER ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CUSTOMER" (
    cust_id        SERIAL PRIMARY KEY,
    cust_name      VARCHAR(100) NOT NULL,
    cust_email     VARCHAR(100) UNIQUE,
    cust_phone     VARCHAR(30),
    cust_address   VARCHAR(255),
    loyalty_points INTEGER NOT NULL DEFAULT 0
);

-- ─── TABLES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TABLES" (
    table_id       SERIAL PRIMARY KEY,
    table_number   VARCHAR(20) NOT NULL,
    table_capacity INTEGER     NOT NULL CHECK (table_capacity > 0 AND table_capacity <= 50),
    table_status   VARCHAR(20) NOT NULL DEFAULT 'available'
                   CHECK (table_status IN ('available','occupied','reserved')),
    branch_id      INTEGER     NOT NULL REFERENCES "Branch"("B_id"),
    UNIQUE (table_number, branch_id)
);

-- ─── RESERVATION ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RESERVATION" (
    reserv_id   SERIAL PRIMARY KEY,
    table_id    INTEGER   NOT NULL REFERENCES "TABLES"(table_id),
    cust_id     INTEGER   REFERENCES "CUSTOMER"(cust_id),
    reserv_date TIMESTAMP NOT NULL
);

-- ─── ORDER ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ORDER" (
    or_id              SERIAL PRIMARY KEY,
    or_tax             NUMERIC(10,2) NOT NULL DEFAULT 0,
    or_totalcost       NUMERIC(10,2),
    "or_totalCostWtax" NUMERIC(10,2),
    or_status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (or_status IN ('pending','preparing','completed','cancelled')),
    or_type            VARCHAR(20)
                       CHECK (or_type IN ('dine-in','takeaway','delivery')),
    or_date            DATE    NOT NULL DEFAULT CURRENT_DATE,
    or_time            TIME    NOT NULL DEFAULT CURRENT_TIME,
    cust_id            INTEGER REFERENCES "CUSTOMER"(cust_id),
    u_id               INTEGER REFERENCES "User"(u_id),
    b_id               INTEGER REFERENCES "Branch"("B_id"),
    table_id           INTEGER REFERENCES "TABLES"(table_id)
);

-- ─── ORDER_ITEM ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ORDER_ITEM" (
    "orderItem_id" SERIAL PRIMARY KEY,
    "Bpro_id"      INTEGER       REFERENCES "Branch_Product"("Bpro_id"),
    pro_quantity   INTEGER,
    unit_price     NUMERIC(10,2),
    total_price    NUMERIC(10,2),
    order_id       INTEGER       REFERENCES "ORDER"(or_id)
);

-- ─── Payment ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Payment" (
    p_id        SERIAL PRIMARY KEY,
    pay_method  VARCHAR(20) NOT NULL
                CHECK (pay_method IN ('cash','card','mobile_pay','voucher','split')),
    pay_status  VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (pay_status IN ('pending','paid','failed','refunded','voided')),
    pay_date    DATE           NOT NULL,
    pay_amount  NUMERIC(10,2) NOT NULL,
    or_id       INTEGER        NOT NULL REFERENCES "ORDER"(or_id)
);

-- ─── Raw_Material ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Raw_Material" (
    rm_id        SERIAL PRIMARY KEY,
    rm_name      VARCHAR(120) NOT NULL,
    unit         VARCHAR(20)  NOT NULL,
    stock_qty    NUMERIC(10,3) NOT NULL DEFAULT 0,
    record_level NUMERIC(10,3) NOT NULL DEFAULT 0,
    "Com_id"     INTEGER REFERENCES "Company"(com_id),
    b_id         INTEGER REFERENCES "Branch"("B_id")
);

-- ─── RECIPE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RECIPE" (
    recipe_id       SERIAL PRIMARY KEY,
    quantity_req    NUMERIC(8,3)  NOT NULL,
    pro_id          INTEGER       NOT NULL REFERENCES "Product"(pro_id),
    "rawmaterial_ID" INTEGER      NOT NULL REFERENCES "Raw_Material"(rm_id),
    unit            VARCHAR(20),
    UNIQUE (pro_id, "rawmaterial_ID")
);

-- ─── SUPPLIER ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SUPPLIER" (
    sup_id      SERIAL PRIMARY KEY,
    sup_name    VARCHAR(120) NOT NULL,
    sup_email   VARCHAR(150) NOT NULL,
    sup_contact VARCHAR(30)  NOT NULL,
    sup_address VARCHAR(100),
    "Com_id"    INTEGER REFERENCES "Company"(com_id)
);

-- ─── purchase_order ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order (
    po_id         SERIAL PRIMARY KEY,
    sup_id        INTEGER NOT NULL REFERENCES "SUPPLIER"(sup_id),
    b_id          INTEGER NOT NULL REFERENCES "Branch"("B_id"),
    status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','received')),
    order_date    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    received_date TIMESTAMP
);

-- ─── purchase_item ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_item (
    pi_id      SERIAL PRIMARY KEY,
    qty        NUMERIC(10,3) NOT NULL,
    price      NUMERIC(10,2),
    unit_price NUMERIC(10,2) NOT NULL,
    po_id      INTEGER       NOT NULL REFERENCES purchase_order(po_id),
    rm_id      INTEGER       NOT NULL REFERENCES "Raw_Material"(rm_id)
);

-- ─── supplier_payment ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_payment (
    pay_id       SERIAL PRIMARY KEY,
    amount       NUMERIC(10,2) NOT NULL,
    payment_date DATE          NOT NULL,
    method       VARCHAR(30)   CHECK (method IN ('cash','card','bank_transfer','cheque','online')),
    sup_id       INTEGER       NOT NULL REFERENCES "SUPPLIER"(sup_id),
    po_id        INTEGER       NOT NULL REFERENCES purchase_order(po_id)
);

-- ─── TABLE_ASSIGNMENT ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TABLE_ASSIGNMENT" (
    assign_id     SERIAL PRIMARY KEY,
    table_id      INTEGER     NOT NULL REFERENCES "TABLES"(table_id),
    u_id          INTEGER     NOT NULL REFERENCES "User"(u_id),
    assigned_date DATE        NOT NULL,
    shift         VARCHAR(20) NOT NULL CHECK (shift IN ('morning','afternoon','evening')),
    notes         VARCHAR(225),
    created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (table_id, assigned_date, shift),
    UNIQUE (u_id, assigned_date, shift)
);

-- =============================================================
-- Seed: Role table (required for login to work)
-- =============================================================
INSERT INTO "Role" (role_id, role_name) VALUES
    (1, 'BRANCH_ADMIN'),
    (2, 'ADMIN'),
    (3, 'CASHIER'),
    (4, 'STAFF'),
    (5, 'MANAGER'),
    (6, 'SUPER_ADMIN'),
    (7, 'SUPERVISOR'),
    (8, 'WAITER'),
    (9, 'KITCHEN_STAFF')
ON CONFLICT (role_id) DO NOTHING;

-- Reset sequence so next auto-insert starts after 9
SELECT setval(pg_get_serial_sequence('"Role"', 'role_id'), 9, true);
