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

## Forventet tabell

Appen forventer en tabell `noresult_matches` med minst disse feltene:

- `id` (integer, unik)
- `noresult_id` (kan være integer eller tekst)
- `term` (tekst)
- `elnummer` (tekst)
- `behandlet` (boolean, default false)

Eksempel SQL:

```sql
CREATE TABLE noresult_matches (
  id serial PRIMARY KEY,
  noresult_id integer NOT NULL,
  term text,
  elnummer text,
  behandlet boolean DEFAULT FALSE
);
```

## Oppsett

```bash
cp .env.example .env
# sett DATABASE_URL til Neon connection string
npm install
npm start
```

Appen kjører på `http://localhost:3000`.


## Feilsøking ved "Klarte ikke hente neste gruppe"

Hvis du har opprettet databasen på nytt, sjekk at:

- `DATABASE_URL` peker til riktig database.
- `TABLE_NAME` peker til riktig tabell (default `public.noresult_matches`).
- Tabellen har kolonnene: `id`, `noresult_id`, `term`, `elnummer`, `behandlet`, `matched_longtekst`, `longtekst_marked`.

API-feil returnerer nå også `detail` og `code` fra Postgres for enklere feilsøking.
