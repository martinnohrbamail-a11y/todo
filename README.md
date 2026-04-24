# To-Do UI for `noresult_matches` (NeonDB)

En enkel app for arbeidsflyten du beskrev:

1. Hente neste gruppe med lik `noresult_id` som ikke er behandlet.
2. Markere enkeltlinjer eller alle som behandlet.
3. Klikke **Fullfør** for å oppdatere NeonDB.
4. Automatisk hente neste gruppe.
5. Bytte mellom faner for å se **ubehandlede** og **behandlede** søkeord.

## Faner i UI

- **Arbeidsfane (ikke behandlet)**
  - Viser aktiv gruppe for behandling.
  - Viser også full liste over alle ubehandlede søkeord.
- **Ferdig behandlet**
  - Viser full liste over alle ferdigbehandlede søkeord.

## API

- `GET /api/next-group`: Henter neste ubehandlede gruppe (`noresult_id`).
- `POST /api/mark-complete`: Oppdaterer valgte rader til `behandlet = TRUE`.
- `GET /api/items?behandlet=true|false`: Henter full liste for valgt status.
- `POST /api/ai-score`: AI-vurderer rader og returnerer `elnummer`, `score` og kort `begrunnelse`.
- `GET /api/schema-check`: Verifiserer at nødvendige kolonner finnes med riktige datatyper.

## Forventet tabell

Appen forventer en tabell `noresult_matches` med minst disse feltene:

- `id` (integer, unik)
- `noresult_id` (kan være integer eller tekst)
- `term` (tekst)
- `elnummer` (tekst)
- `behandlet` (boolean, default false)
- `ai_score` (integer, nullable)
- `ai_begrunnelse` (text, nullable)
- `ai_updated_at` (timestamptz, nullable)

Eksempel SQL:

```sql
CREATE TABLE noresult_matches (
  id serial PRIMARY KEY,
  noresult_id integer NOT NULL,
  term text,
  elnummer text,
  behandlet boolean DEFAULT FALSE,
  ai_score integer,
  ai_begrunnelse text,
  ai_updated_at timestamptz
);
```

## Oppsett

```bash
cp .env.example .env
# sett DATABASE_URL til Neon connection string
# sett OPENAI_API_KEY for AI-vurdering
npm install
npm start
```

Appen kjører på `http://localhost:3000`.


## Feilsøking ved "Klarte ikke hente neste gruppe"

Hvis du har opprettet databasen på nytt, sjekk at:

- `DATABASE_URL` peker til riktig database.
- `TABLE_NAME` peker til riktig tabell (default `public.noresult_matches`).
- Tabellen har kolonnene: `id`, `noresult_id`, `term`, `elnummer`, `behandlet`, `matched_longtekst`, `longtekst_marked`.
- For lagring av AI-resultater: `ai_score`, `ai_begrunnelse`, `ai_updated_at`.

API-feil returnerer nå også `detail` og `code` fra Postgres for enklere feilsøking.

Du kan også kjøre:

```bash
curl http://localhost:3000/api/schema-check
```

Hvis `behandlet` mangler, opprett den med:

```sql
ALTER TABLE public.noresult_matches
ADD COLUMN IF NOT EXISTS behandlet boolean NOT NULL DEFAULT false;
```

For AI-lagring:

```sql
ALTER TABLE public.noresult_matches
ADD COLUMN IF NOT EXISTS ai_score integer,
ADD COLUMN IF NOT EXISTS ai_begrunnelse text,
ADD COLUMN IF NOT EXISTS ai_updated_at timestamptz;
```

## AI-vurdering (Copilot / OpenAI)

Arbeidsfanen har en knapp **AI-score aktiv gruppe** som sender aktiv gruppe til backend.  
Backend kaller valgfri AI-provider med streng vurderingslogikk, lagrer resultatene i tabellen, og returnerer:

- Elnummer
- Score (0-100)
- Begrunnelse (kort)

Miljøvariabler:

- `AI_PROVIDER` (`openai` eller `copilot`, default `openai`)
- `OPENAI_API_KEY` (påkrevd når `AI_PROVIDER=openai`)
- `OPENAI_MODEL` (valgfri, default `gpt-4.1-mini`)
- `COPILOT_API_KEY` eller `GITHUB_TOKEN` (påkrevd når `AI_PROVIDER=copilot`)
- `COPILOT_MODEL` (valgfri, default `gpt-4o-mini`)
- `COPILOT_BASE_URL` (valgfri, default `https://models.inference.ai.azure.com`)
