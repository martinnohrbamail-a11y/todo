const path = require("path");
const express = require("express");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : false,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Database unavailable" });
  }
});

app.get("/api/items", async (req, res) => {
  const behandlet = req.query.behandlet === "true";

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        noresult_id,
        term,
        elnummer,
        matched_longtekst,
        longtekst_marked,
        COALESCE(behandlet, FALSE) AS behandlet
      FROM noresult_matches
      WHERE COALESCE(behandlet, FALSE) = $1
      ORDER BY noresult_id, id
      `,
      [behandlet]
    );

    res.json({ items: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Klarte ikke hente liste" });
  }
});

app.get("/api/next-group", async (_req, res) => {
  try {
    const nextGroupResult = await pool.query(
      `
      SELECT noresult_id
      FROM noresult_matches
      WHERE COALESCE(behandlet, FALSE) = FALSE
      GROUP BY noresult_id
      ORDER BY MIN(noresult_id)
      LIMIT 1
      `
    );

    if (nextGroupResult.rows.length === 0) {
      return res.json({ done: true, noresult_id: null, items: [] });
    }

    const { noresult_id } = nextGroupResult.rows[0];
    const rowsResult = await pool.query(
      `
      SELECT
        id,
        noresult_id,
        term,
        elnummer,
        matched_longtekst,
        longtekst_marked,
        COALESCE(behandlet, FALSE) AS behandlet
      FROM noresult_matches
      WHERE noresult_id = $1
      ORDER BY id
      `,
      [noresult_id]
    );

    return res.json({ done: false, noresult_id, items: rowsResult.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Klarte ikke hente neste gruppe" });
  }
});

app.post("/api/mark-complete", async (req, res) => {
  const { noresult_id, rowIds } = req.body;

  if (!noresult_id || !Array.isArray(rowIds) || rowIds.length === 0) {
    return res.status(400).json({ error: "Mangler noresult_id eller valgte rader" });
  }

  try {
    await pool.query(
      `
      UPDATE noresult_matches
      SET behandlet = TRUE
      WHERE noresult_id = $1
      AND id = ANY($2::int[])
      `,
      [noresult_id, rowIds]
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Klarte ikke oppdatere status" });
  }
});

app.listen(port, () => {
  console.log(`Server kjører på http://localhost:${port}`);
});
