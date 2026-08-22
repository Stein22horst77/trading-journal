const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(express.json({ limit: "8mb" })); // room for base64 chart screenshots

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. On Railway, add a Postgres service and reference its DATABASE_URL variable.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /railway\.app|proxy\.rlwy\.net/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
});

// Optional password gate: set APP_PASSWORD in Railway variables.
app.use((req, res, next) => {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return next();
  if (req.headers["x-app-password"] === pw) return next();
  if (req.path.startsWith("/api")) return res.status(401).json({ error: "Wrong or missing password" });
  next();
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trades (
      id SERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      asset_type TEXT NOT NULL DEFAULT 'stock',
      style TEXT NOT NULL DEFAULT 'swing',
      direction TEXT NOT NULL DEFAULT 'long',
      entry_date TIMESTAMPTZ NOT NULL,
      exit_date TIMESTAMPTZ,
      entry_price NUMERIC NOT NULL,
      exit_price NUMERIC,
      quantity NUMERIC NOT NULL,
      fees NUMERIC NOT NULL DEFAULT 0,
      risk NUMERIC,
      setup TEXT,
      notes TEXT,
      starred BOOLEAN NOT NULL DEFAULT false,
      chart_image TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // Migrations for databases created by the earlier version
  await pool.query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk NUMERIC`);
  await pool.query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS chart_image TEXT`);
  await pool.query(`ALTER TABLE trades ALTER COLUMN entry_date TYPE TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE trades ALTER COLUMN exit_date TYPE TIMESTAMPTZ`);
}

function enrich(t) {
  let pnl = null, r = null;
  if (t.exit_price != null) {
    const dir = t.direction === "short" ? -1 : 1;
    pnl = (Number(t.exit_price) - Number(t.entry_price)) * Number(t.quantity) * dir - Number(t.fees);
    if (t.risk && Number(t.risk) > 0) r = pnl / Number(t.risk);
  }
  return { ...t, pnl, r };
}

const FIELDS = ["symbol","asset_type","style","direction","entry_date","exit_date",
  "entry_price","exit_price","quantity","fees","risk","setup","notes","starred","chart_image"];

function values(b) {
  return [
    String(b.symbol || "").trim().toUpperCase(),
    b.asset_type || "stock", b.style || "swing", b.direction || "long",
    b.entry_date, b.exit_date || null,
    b.entry_price, b.exit_price ?? null,
    b.quantity, b.fees || 0, b.risk || null,
    b.setup ? String(b.setup).trim().toLowerCase() : null,
    b.notes || null,
    b.starred === true,
    b.chart_image || null,
  ];
}

function validate(b) {
  if (!b.symbol || !b.entry_date || b.entry_price == null || b.quantity == null)
    return "symbol, entry date, entry price and quantity are required";
  if (b.exit_price != null && !b.exit_date) return "an exit price needs an exit date";
  if (b.chart_image && !/^data:image\/(png|jpe?g|webp);base64,/.test(b.chart_image))
    return "chart_image must be a png/jpeg/webp data URL";
  return null;
}

// List: everything except the (potentially large) images; has_image flags them.
app.get("/api/trades", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, symbol, asset_type, style, direction, entry_date, exit_date,
              entry_price, exit_price, quantity, fees, risk, setup, notes, starred,
              (chart_image IS NOT NULL) AS has_image, created_at
       FROM trades ORDER BY entry_date DESC, id DESC`
    );
    res.json(rows.map(enrich));
  } catch (e) { next(e); }
});

// Single trade including its screenshot
app.get("/api/trades/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM trades WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Trade not found" });
    res.json(enrich(rows[0]));
  } catch (e) { next(e); }
});

app.post("/api/trades", async (req, res, next) => {
  try {
    const err = validate(req.body);
    if (err) return res.status(400).json({ error: err });
    const { rows } = await pool.query(
      `INSERT INTO trades (${FIELDS.join(",")}) VALUES (${FIELDS.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
      values(req.body)
    );
    res.status(201).json(enrich(rows[0]));
  } catch (e) { next(e); }
});

app.put("/api/trades/:id", async (req, res, next) => {
  try {
    const err = validate(req.body);
    if (err) return res.status(400).json({ error: err });
    const sets = FIELDS.map((f, i) => `${f}=$${i + 1}`).join(",");
    const { rows } = await pool.query(
      `UPDATE trades SET ${sets} WHERE id=$${FIELDS.length + 1} RETURNING *`,
      [...values(req.body), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Trade not found" });
    res.json(enrich(rows[0]));
  } catch (e) { next(e); }
});

// Small partial updates (star toggle, attach/remove screenshot)
app.patch("/api/trades/:id", async (req, res, next) => {
  try {
    const allowed = ["starred", "chart_image", "notes", "setup"];
    const sets = [], vals = [];
    for (const k of allowed) {
      if (k in req.body) { vals.push(req.body[k]); sets.push(`${k}=$${vals.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE trades SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: "Trade not found" });
    res.json(enrich(rows[0]));
  } catch (e) { next(e); }
});

app.delete("/api/trades/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM trades WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.use(express.static(path.join(__dirname, "public")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error: " + err.message });
});

const PORT = process.env.PORT || 3000;
init()
  .then(() => app.listen(PORT, () => console.log(`Trading journal running on port ${PORT}`)))
  .catch(err => { console.error("Database init failed:", err); process.exit(1); });
