const path = require("path");
const express = require("express");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const tableNameInput = process.env.TABLE_NAME || "noresult_matches";
const allowedName = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/;

if (!allowedName.test(tableNameInput)) {
  throw new Error(
    "Ugyldig TABLE_NAME. Tillatt format er f.eks 'noresult_matches' eller 'public.noresult_matches'."
  );
}

const tableRef = tableNameInput
  .split(".")
  .map((part) => `"${part}"`)
  .join(".");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : false,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function dbError(error, fallbackMessage) {
  return {
    error: fallbackMessage,
    detail: error.message,
    code: error.code,
  };
}

async function ensureAiColumnsExist() {
  await pool.query(
    `
    ALTER TABLE ${tableRef}
    ADD COLUMN IF NOT EXISTS ai_score integer,
    ADD COLUMN IF NOT EXISTS ai_begrunnelse text,
    ADD COLUMN IF NOT EXISTS ai_updated_at timestamptz
    `
  );
}

async function scoreRowsWithAI(rows) {
  const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
  const isCopilot = provider === "copilot";
  const apiKey = isCopilot
    ? process.env.COPILOT_API_KEY || process.env.GITHUB_TOKEN
    : process.env.OPENAI_API_KEY;
  const model = isCopilot
    ? process.env.COPILOT_MODEL || "gpt-4o-mini"
    : process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const baseUrl = isCopilot
    ? process.env.COPILOT_BASE_URL || "https://models.inference.ai.azure.com"
    : "https://api.openai.com";

  if (!apiKey) {
    throw new Error(
      isCopilot
        ? "COPILOT_API_KEY (eller GITHUB_TOKEN) mangler i miljøvariabler"
        : "OPENAI_API_KEY mangler i miljøvariabler"
    );
  }

  const instructions = `
Du skal analysere en tabell rad for rad.
Felter per rad:
- term
- elnummer
- longtekst_marked

Vurder hvor godt longtekst_marked matcher det brukeren leter etter i term.
Vær streng. Ved usikkerhet: trekk score ned.
Hvis ord matcher, men produkttype er feil: svært lav score eller 0.
Bedre for lav enn for høy score.

Scoringsregler:
- 100: svært tydelig og direkte match
- 80-99: veldig god match med liten usikkerhet
- 50-79: delvis relevant
- 1-49: svak match
- 0: feil produkt

Returner KUN gyldig JSON på format:
{
  "results": [
    { "elnummer": "...", "score": 0-100, "begrunnelse": "kort og konkret" }
  ]
}

Hold samme rekkefølge som input.
`;

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: instructions },
        {
          role: "user",
          content: JSON.stringify({ rows }),
        },
      ],
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload?.error?.message || "Ukjent AI-feil";
    throw new Error(`AI-feil (${provider}): ${detail}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Tomt svar fra AI-provider (${provider})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_error) {
    throw new Error(`Klarte ikke parse JSON fra AI-provider (${provider})`);
  }

  const results = Array.isArray(parsed.results) ? parsed.results : [];
  return results.map((item, index) => ({
    rowId: String(rows[index]?.id ?? ""),
    elnummer: String(item.elnummer ?? rows[index]?.elnummer ?? ""),
    score: Math.max(0, Math.min(100, Number(item.score) || 0)),
    begrunnelse: String(item.begrunnelse ?? ""),
  }));
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, table: tableNameInput });
  } catch (error) {
    res.status(500).json(dbError(error, "Database unavailable"));
  }
});

app.get("/api/schema-check", async (_req, res) => {
  try {
    const [schemaPart, tablePart] = tableNameInput.includes(".")
      ? tableNameInput.split(".")
      : ["public", tableNameInput];

    const columnsResult = await pool.query(
      `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
      `,
      [schemaPart, tablePart]
    );

    const actualColumns = new Map(
      columnsResult.rows.map((row) => [row.column_name, row.data_type])
    );

    const required = [
      { name: "id", types: ["integer", "bigint", "uuid"] },
      { name: "noresult_id", types: ["integer", "bigint", "text", "character varying"] },
      { name: "term", types: ["text", "character varying"] },
      { name: "elnummer", types: ["text", "character varying"] },
      { name: "longtekst_marked", types: ["text", "character varying"] },
      { name: "behandlet", types: ["boolean"] },
      { name: "ai_score", types: ["integer"] },
      { name: "ai_begrunnelse", types: ["text", "character varying"] },
      { name: "ai_updated_at", types: ["timestamp with time zone"] },
    ];

    const checks = required.map((col) => {
      const actualType = actualColumns.get(col.name);
      return {
        column: col.name,
        exists: Boolean(actualType),
        type: actualType || null,
        expectedTypes: col.types,
        typeOk: actualType ? col.types.includes(actualType) : false,
      };
    });

    const ok = checks.every((check) => check.exists && check.typeOk);
    return res.json({
      ok,
      table: tableNameInput,
      checks,
    });
  } catch (error) {
    return res.status(500).json(dbError(error, "Klarte ikke kjøre schema-check"));
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
        ai_score,
        ai_begrunnelse,
        COALESCE(behandlet, FALSE) AS behandlet
      FROM ${tableRef}
      WHERE COALESCE(behandlet, FALSE) = $1
      ORDER BY noresult_id, id
      `,
      [behandlet]
    );

    res.json({ items: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json(dbError(error, "Klarte ikke hente liste"));
  }
});

app.get("/api/next-group", async (_req, res) => {
  try {
    const nextGroupResult = await pool.query(
      `
      SELECT noresult_id
      FROM ${tableRef}
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
        ai_score,
        ai_begrunnelse,
        COALESCE(behandlet, FALSE) AS behandlet
      FROM ${tableRef}
      WHERE noresult_id = $1
      ORDER BY id
      `,
      [noresult_id]
    );

    return res.json({ done: false, noresult_id, items: rowsResult.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json(dbError(error, "Klarte ikke hente neste gruppe"));
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
      UPDATE ${tableRef}
      SET behandlet = TRUE
      WHERE noresult_id = $1
      AND id = ANY($2::int[])
      `,
      [noresult_id, rowIds]
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json(dbError(error, "Klarte ikke oppdatere status"));
  }
});

app.post("/api/ai-score", async (req, res) => {
  const rows = req.body?.rows;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "Mangler rows for AI-vurdering" });
  }

  if (rows.length > 200) {
    return res.status(400).json({ error: "Maks 200 rader per AI-kall" });
  }

  try {
    await ensureAiColumnsExist();

    const normalizedRows = rows.map((row) => ({
      id: String(row.id ?? ""),
      term: String(row.term ?? ""),
      elnummer: String(row.elnummer ?? ""),
      longtekst_marked: String(row.longtekst_marked ?? ""),
    }));

    const results = await scoreRowsWithAI(normalizedRows);
    await Promise.all(
      results
        .filter((row) => row.rowId)
        .map((row) =>
          pool.query(
            `
            UPDATE ${tableRef}
            SET ai_score = $1,
                ai_begrunnelse = $2,
                ai_updated_at = NOW()
            WHERE id = $3::int
            `,
            [row.score, row.begrunnelse, row.rowId]
          )
        )
    );

    return res.json({ results });
  } catch (error) {
    console.error(error);
    return res.status(500).json(dbError(error, "Klarte ikke kjøre AI-vurdering"));
  }
});

app.listen(port, () => {
  console.log(`Server kjører på http://localhost:${port}`);
  console.log(`Bruker tabell: ${tableNameInput}`);
});
