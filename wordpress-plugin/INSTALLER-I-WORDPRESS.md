# Installer Sankekart i WordPress

Pluginfilen du skal laste opp er:

`trondelag-sankeri-sankekart.zip`

## 1. Last opp plugin

1. Gå til WordPress admin.
2. Gå til `Utvidelser` -> `Legg til ny`.
3. Trykk `Last opp utvidelse`.
4. Velg `trondelag-sankeri-sankekart.zip`.
5. Trykk `Installer nå`.
6. Trykk `Aktiver`.

## 2. Legg inn monday-innstillinger

1. Gå til `Innstillinger` -> `Sankekart`.
2. Legg inn:
   - `monday_api_token`
   - `monday_board_id`: `5089248322`
3. Kontroller at disse står slik:
   - `product_name_column_id`: `dropdown_mm1jyaet`
   - `scientific_name_column_id`: `latinsk_navn`
   - `taxon_id_column_id`: `text_mm2a18m3`
   - `default_counties`: `Trøndelag`
   - `default_county_ids`: `50`
   - `artsdatabanken_live`: `1`
4. Trykk `Lagre innstillinger`.

## 3. Vis kartet på en side

1. Lag en ny WordPress-side, for eksempel `Sankekart`.
2. Legg inn en `Shortcode`-blokk.
3. Lim inn:

```text
[sankekart]
```

4. Publiser siden.

## Viktig

Denne pluginen lagrer egne funn og vurderinger i WordPress-databasen som WordPress options.
Monday-tokenet lagres i WordPress admin, ikke i JavaScript/frontend.
