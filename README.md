# Vekstkart

En enkel kartside utenfor `monday.com` for produkter som `Steinsopp`, med produktliste, søk og kartvisning.

## Start

```bash
ruby server.rb
```

Åpne deretter `http://127.0.0.1:3000`.

Hvis du vil bruke `monday.com` som produktkilde, kopierer du [`.env.example`](/Users/jim/Documents/New%20project/.env.example) til [`.env.local`](/Users/jim/Documents/New%20project/.env.local) eller eksporterer variablene i terminalen. Serveren leser automatisk `.env.local` ved oppstart.

## Deploy til Render

Prosjektet er klargjort for Render med [render.yaml](/Users/jim/Documents/New%20project/render.yaml), [Gemfile](/Users/jim/Documents/New%20project/Gemfile) og [`.ruby-version`](/Users/jim/Documents/New%20project/.ruby-version).

Fremgangsmåte:

1. Legg prosjektet i et GitHub-repo.
2. Gå til Render og velg `New` -> `Web Service`.
3. Koble til GitHub-repoet.
4. Render kan lese `render.yaml` automatisk, eller du kan bruke disse verdiene manuelt:
   - `Runtime`: Ruby
   - `Build Command`: `bundle install`
   - `Start Command`: `ruby server.rb`
5. Legg inn miljøvariablene i Render:
   - `MONDAY_API_TOKEN`
   - `MONDAY_BOARD_ID`
   - `BIND_ADDRESS=0.0.0.0`
   - `PRODUCT_SOURCE=monday`
   - `ARTSDATABANKEN_LIVE=1`
   - `DEFAULT_COUNTIES=Trøndelag`
   - `DEFAULT_COUNTY_IDS=50`
   - `MONDAY_API_VERSION=2025-04`
   - `MONDAY_PRODUCT_NAME_COLUMN_ID=dropdown_mm1jyaet`
   - `MONDAY_SCIENTIFIC_NAME_COLUMN_ID=latinsk_navn`
   - `MONDAY_TAXON_ID_COLUMN_ID=text_mm2a18m3`
6. Deploy tjenesten.

Når Render er ferdig, får du en URL som ligner:

```text
https://trondelag-sankeri-sankekart.onrender.com
```

Den URL-en kan legges inn i WordPress med en `Custom HTML`-blokk:

```html
<iframe
  src="https://DIN-RENDER-URL-HER"
  style="width:100%; height:900px; border:0; border-radius:18px;"
  title="Trøndelag Sankeri AS - Sankekart">
</iframe>
```

Merk: På Render Free er filsystemet ikke en trygg permanent database. Egne funn og ratinger som lagres i `data/*.json` bør etter hvert flyttes til monday eller en database for trygg drift.

## Hva prototypen gjør

- viser produkter i en egen liste
- lar deg søke på norsk navn, vitenskapelig navn og `TaxonId`
- tegner funn på kart
- viser live-data fra Artsdatabanken som standard
- har avhuking for å vise/skjule Artsdatabanken-funn og egne funn
- lar teamet registrere egne funn med rating og kommentar
- lar teamet vurdere Artsdatabanken-funn med rating og kommentar
- kan hente produkter fra `monday.com` når token og board er satt opp

## Monday-kobling

Backend-en i [server.rb](/Users/jim/Documents/New%20project/server.rb) prøver nå å hente produkter fra `monday.com` først hvis disse miljøvariablene er satt:

- `MONDAY_API_TOKEN`
- `MONDAY_BOARD_ID`
- `MONDAY_PRODUCT_NAME_COLUMN_ID`
- `MONDAY_SCIENTIFIC_NAME_COLUMN_ID`
- `MONDAY_TAXON_ID_COLUMN_ID`
- `MONDAY_CATEGORY_COLUMN_ID`

Hvis `monday` ikke er konfigurert, faller løsningen tilbake til [data/products.json](/Users/jim/Documents/New%20project/data/products.json).

For boardet ditt brukes `Råvare`-kolonnen som norsk søkenavn via `MONDAY_PRODUCT_NAME_COLUMN_ID=dropdown_mm1jyaet`. `📜 Latinsk navn ↗️` er koblet til `MONDAY_SCIENTIFIC_NAME_COLUMN_ID=latinsk_navn`, og `TaxonID` er koblet til `MONDAY_TAXON_ID_COLUMN_ID=text_mm2a18m3`.

Produkter leses via `items_page` og `next_items_page`, som monday anbefaler for paginering av board items: [Querying board items](https://developer.monday.com/api-reference/docs/querying-board-items). Kolonneverdier leses via `column_values`-feltene `id`, `text`, `type` og `value`: [Typed column values](https://developer.monday.com/api-reference/changelog/new-column-values-fields-and-typed-column-values).

## Hvor Artsdatabanken passer inn senere

Denne versjonen bruker prøvedata som trygg fallback, men serveren forsøker også å hente ekte data fra Artskart når du aktiverer `Prøv live-data fra Artsdatabanken`.

Du kan også starte serveren i live-modus fra terminal:

```bash
ARTSDATABANKEN_LIVE=1 ruby server.rb
```

Artsdatabanken dokumenterer dette her:

- [Artskart API](https://artsdatabanken.no/Pages/195884)
- [Observations](https://artsdatabanken.no/Pages/180954/Observations)
- [Dataformat og nedlasting i artskart](https://artsdatabanken.no/kart/artskart/dataformat-og-nedlasting-i-artskart)

Merk:
Implementasjonen bruker dokumenterte endepunkter fra Artsdatabanken, men selve query-parametrene for observations-endepunktet er delvis inferert fra kildene over. Det betyr at vi kan måtte justere én parameterform når du tester mot live-data.

## Neste anbefalte steg

1. Sette inn ekte `monday`-token, `board ID` og kolonne-ID-er.
2. Finjuster live-kallet mot Artskart om nødvendig.
3. Legg inn filtre på fylke, kommune og år.
