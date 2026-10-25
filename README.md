# TDE 2.0 Survey Coverage — static web build

This folder is a complete, serverless version of the TDE 2.0 biodiversity dashboard.
It is plain HTML, CSS and JavaScript over data files: no R, no Python, nothing to
install. Open `index.html` through any static web host and it works.

```
tde_static/
  index.html            the page
  app.js                all dashboard logic (a direct port of app/server.R; sections are named after the R code)
  styles.css            styling (light + dark theme)
  leaflet.css           Leaflet's stylesheet (bundled so no CDN stylesheet is needed)
  smooth-zoom.js        fractional wheel zoom, ported from the Shiny app
  data/                 compact JSON / GeoJSON the page reads (about 15 MB loaded up front, rest on demand)
  download/             the hand-off pack: same content, full resolution, open formats (see below)
  tools/export_web.R    regenerates data/ and download/ from the R project's data/ folder
  README.md             this file
```

## Put it on a link

Any static host works. The page only needs `fetch()` access to its own `data/` folder
and two scripts from public CDNs (Leaflet 1.9.4, Plotly 2.35.2).

**Netlify Drop (fastest, no account for the first deploy)**
1. Go to https://app.netlify.com/drop
2. Drag this whole folder onto the page.
3. You get a `*.netlify.app` URL in about 30 seconds. Create a free account to keep it and to redeploy later.

**GitHub Pages (best long-term home: code and data under version control)**
1. Create a repository, copy this folder's contents into its root, commit, push.
2. Repository → Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
3. The site appears at `https://<org>.github.io/<repo>/` within a minute or two.
   `observations.csv` is 44 MB; GitHub warns above 50 MB per file, so it is fine as is.

**Cloudflare Pages**: same as Netlify (drag and drop or connect the repo), but it caps
files at 25 MB. Remove or gzip `download/csv/observations.csv` first, or keep the pack
out of that deployment and share it separately.

Free hosting is public: anyone with the URL can open the site and fetch the data files.

## Updating the data

The site is a view over the R build's outputs. After a new `Rscript build/00_build_data.R`
(or `10_update_new_sources.R`) in the R project:

```
Rscript tools/export_web.R  <path to tde_dashboard>  <this folder>  <this folder>/download
```

That rewrites `data/` and `download/`. Redeploy the folder. Requires R with `sf`,
`dplyr`, `tidyr`, `stringr`, `jsonlite`, `readr`.

## How the page computes things

Everything is recomputed in the browser from the record level, exactly as the Shiny
app did in `server.R`:

- `data/observations.json` holds every record as columnar arrays (dictionary-encoded
  species, common names, sites, projects, methods). `data/obs_cell.json` links record
  index → cell index (many-to-many: ecoregion grids overlap).
- Switching a source or taxon group off builds a record mask; cell metrics (records,
  species, field-tier records, expected species found) are summed over the links that
  pass the mask. Colour modes, the headline, every table and chart derive from that.
- `data/cell_expected.json` is the centroid-rule expected list: species → array of cell
  indices (323,888 pairs). The page inverts it at load.
- Expert ranges, collar tracks and the per-record attribute details are fetched only
  when first needed (`ranges.geojson`, `telemetry.geojson`, `attrs/<ECO>.json`).

Definitions (survey cell, with data, field-surveyed, species rank rules, expected
species, curves) are written out on the page's **About** tab.

### Behaviour carried over from the Shiny app on purpose

These match the original so the two agree number for number. They are worth knowing
when re-implementing elsewhere:

- "Records" in the headline, cell and ecoregion views count record-to-cell links, so a
  record in an overlap zone between two ecoregion grids is counted once in each cell.
  83,905 records become 77,828 links inside the grid (10,580 records fall outside any cell).
- The species accumulation curve's dashed "expected (n)" line counts all expected species
  for the chosen group and ignores the sidebar's taxon-group filter; the "expected found"
  stat beside it respects the filter. With everything on they can differ by one.
- Six partner records are classed `Other` (hedgehog and red fox rows whose source group
  field did not say "mammal"). They are excluded by the group filter and never shown.
- Ranger sightings count everywhere except the Sites table and the field-surveyed flag.
- Telemetry never counts as a record, species or site.

### Known differences from the Shiny app

- Basemap tiles load from Esri / OpenStreetMap when the page is hosted normally. Inside
  the Claude artifact viewer external tiles are blocked, so the map shows country
  outlines instead (the "None" basemap look).
- Tables are a small built-in component rather than DataTables: filter box, sortable
  headers, paging. Clicking a species row in any species table opens that species in
  the finder (new; the Shiny version did not do this).
- The country outline comes from Natural Earth 50 m via `world-atlas` (the R build
  skipped it because `rnaturalearth` was not installed there).

## The hand-off pack (`download/`)

For loading straight into QGIS / ArcGIS / PostGIS or any pipeline.

| File | What it is |
|---|---|
| `tde_reference.gpkg` | One GeoPackage: `grid_cells` (6,563 cells with every summary column), `ecoregions` (12, ~200 m simplified), `protected_areas` (133), `wetland_registry` (622 points), `species_ranges` (254, ~500 m), `telemetry_segments` (335 lines), `observations` (83,905 points, attributes column dropped; join to the CSV on `obs_id`). WGS84. |
| `geojson/*.geojson` | The same six layers as GeoJSON (6 dp). |
| `csv/observations.csv` | Unified record table; `attrs` is a JSON string of the source-specific fields. Schema below. |
| `csv/obs_cell.csv` | Record → cell links (`obs_id`, `cell_id`, `code`, `is_sample`). |
| `csv/cell_expected.csv` | Expert-range species × cell with both rules: `centroid` (strict, used by the dashboard) and `touch` (any overlap). |
| `csv/cell_species.csv`, `csv/cell_summary.csv`, `csv/cell_pa.csv`, `csv/cell_wetlands.csv` | Per-cell species lists and one-row-per-cell summaries. |
| `csv/eco_summary.csv`, `csv/eco_species.csv`, `csv/eco_saturation.csv` | Ecoregion totals, species lists with expected/recorded flags, accumulation curves. |
| `csv/sites.csv`, `csv/revisit.csv` | Survey sites (all sources except ranger) and field sites ranked inside survey cells. |
| `csv/species.csv` | Species lookup: group, common name, record and source counts, has expert range, IUCN. |
| `csv/telemetry_fixes.csv`, `csv/telemetry_collars.csv` | Kept GPS fixes with segment ids, and the 32 collars. |
| `csv/wetland_registry.csv`, `csv/bird_crosswalk.csv` | Registry attributes; bird common → scientific name crosswalk (rows marked `supplement` were added by hand and should be checked by a birder). |
| `BUILD_NOTES.md` | The R project's README: every data-cleaning decision the build encodes. |

### `observations.csv` schema

| column | description |
|---|---|
| `obs_id` | unique, source-prefixed (`NCW_`, `BSP_`/`BAU_`, `WET_`, `RSG_`, `RGR_`) |
| `source` / `source_label` | `ncw`, `birds`, `wetlands`, `partner`, `ranger` |
| `tier` | `field` (survey data), `internal` (NCW database, ranger app), `compiled` (partner bibliography) |
| `project`, `season` | programme and season / zone / mission |
| `site_id`, `site_name` | survey site key where the source has one |
| `taxon_group` | Birds, Mammals, Reptiles, Amphibians, Invertebrates, Fish (6 rows `Other`) |
| `species`, `rank`, `species_raw` | cleaned binomial; rank = species / subspecies / genus / unidentified / unparsed (partner also family / order / class / phylum) |
| `common_name` | where supplied |
| `date`, `year` | may be empty (most NCW rows, all wetland rows) |
| `method` | survey method where known |
| `lat`, `lon` | WGS84 |
| `count` | individuals; carried but never displayed |
| `attrs` | JSON string of all source-specific fields |

Species lists and richness use `rank` in (`species`, `subspecies`) only.
