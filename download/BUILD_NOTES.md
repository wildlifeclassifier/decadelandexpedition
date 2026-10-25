# TDE 2.0 — Biodiversity Dashboard

Data build and (forthcoming) Shiny app for the ecoregion / grid-cell survey dashboard.

## Layout

```
tde_dashboard/
  build/
    config.R                 <- edit paths / rules here
    00_build_data.R          <- Rscript build/00_build_data.R   (from project root)
    R/00_utils.R             helpers: species names, groups, coords, IUCN, schema
    R/01_geometry.R          grid, ecoregions, protected areas, wetland registry, ranges
    R/02_sources.R           NCW, birds (spring + autumn), wetlands (xlsx), partner
    R/03_link.R              obs->cell, expected species, cell/eco tables, curves, sites
    crosswalk/bird_names_supplement.csv   spring-only bird names -> scientific (review)
  data/                      app-ready outputs (rds + reference.gpkg)
  qa/                        build_log.txt + issue tables
  app/                       Shiny app (next step)
```

## Running the build locally

Requires R >= 4.3 with `sf`, `dplyr`, `tidyr`, `stringr`, `purrr`, `readr`,
`readxl`, `jsonlite`, `tibble`, `rvest`, `units`. Takes ~2 min.

1. Edit `build/config.R`: set `raw_dir` and fix any file names (e.g. your grid
   file is `12 ecosystem_grids.shp` with a space; the canonical layer used here
   is `ecosystem_grids_ided.gpkg`).
2. From the project root: `Rscript build/00_build_data.R`
3. Read `qa/build_log.txt` and the CSVs in `qa/`.

If you have a previously built `data/` folder but not the original survey raw
files, `Rscript build/10_update_new_sources.R` integrates just the two newer
raw files (ranger sightings + telemetry) into the existing outputs and rebuilds
every observation-derived table; a later full rebuild gives the same result.
Its log goes to `qa/update_log.txt`.

## Unified observation schema (`data/observations.rds`)

| column | description |
|---|---|
| `obs_id` | unique, source-prefixed (`NCW_`, `BSP_`/`BAU_`, `WET_`, `RSG_`, `RGR_`) |
| `source` / `source_label` | `ncw`, `birds`, `wetlands`, `partner`, `ranger` |
| `tier` | `field` (survey data), `internal` (NCW database), `compiled` (partner bibliography) |
| `project`, `season` | programme and season / zone / mission |
| `site_id`, `site_name` | survey site key where the source has one |
| `taxon_group` | Birds, Mammals, Reptiles, Amphibians, Invertebrates, Fish |
| `species`, `rank`, `species_raw` | cleaned binomial; rank = species / subspecies / genus / unidentified / unparsed |
| `common_name` | where supplied |
| `date`, `year` | NA allowed (96% of NCW, all wetland rows) |
| `method` | survey method where known |
| `lat`, `lon` | WGS84 |
| `count` | retained, never displayed |
| `attrs` | JSON string of all source-specific fields |

Species lists and richness use `rank %in% c("species","subspecies")` only.

Link tables: `obs_cell` (many-to-many, because ecoregion grids overlap),
`cell_expected` (expert range x cell, `centroid` = strict rule, `touch` = any overlap),
`cell_pa`, `cell_wetlands`.

## Decisions encoded in the build

- Plants dropped everywhere (NCW Plantae; wetland Flora sheets used only for site coordinates;
  ranger `Plants` category rows dropped).
- Ranger sightings (`ranger_observations_raw.rds`, the NCW app snapshot) enter as their own
  source with tier `internal`: they are real field sightings but opportunistic, so they never
  flip a cell to "field-surveyed" and are excluded from the survey-site / revisit tables.
  Exact duplicates are collapsed and the ~4 rows already present in the NCW internal extract
  (species + coordinates + date) are dropped. The derived `lon`/`lat` columns are used; the
  typed `LATITUDE`/`LONGITUDE` text fields in that snapshot are unreliable.
- GPS telemetry (`wildlife_raw.rds`) is a **display-only** layer: fixes are never added to the
  observation table and never count as records, species, or sites. Only the higher-quality
  collars are kept, using the same chain as the standalone N-vs-S cluster script: PDOP <= 8,
  deployment trim, sign-of-life dead-tail trim, then the 6 longest-duration collars per
  species x cluster with >= 100 live fixes (plus the single qualifying Nubian ibex collar),
  segmented at > 20 km jumps / > 12 h gaps. Species are mapped to the dashboard binomials
  (Oryx leucoryx, Gazella marica, Gazella arabica, Capra nubiana). Tune in `cfg$telemetry`.
- Partner `MOVEBANK` (telemetry) and `GBIF` rows dropped; `BIBLIOG` kept as tier `compiled`
  and excluded from revisit-site ranking.
- NCW exact duplicates (species + coordinates + date + count) collapsed.
- Bird common names resolved via the autumn file first, then `crosswalk/bird_names_supplement.csv`.
  The same crosswalk repairs NCW bird rows that carry English names.
- Wetland survey sites are linked to the registry by nearest point within 2 km
  (`cfg$wetland_match_km`); unmatched sites are kept as observations and listed in `qa/`.
- Wetland workbook species names had "lc" replaced by "Least Concern" inside words in the
  source files (e.g. *Dryops suLeast Concernipennis*); this is reversed.
- Expected species per cell use the centroid rule by default; touch-any is stored alongside.
- Geometry is simplified for display (ecoregions / PAs ~200 m, ranges ~500 m). Full-resolution
  copies are never needed by the app.

## Things to review in `qa/`

- `ncw_unparsed_names.csv`, `wetland_unparsed_names.csv` — a handful of names that could not
  be parsed (mostly numbered morphospecies).
- `wetland_sites_off_registry.csv` — 11 survey sites > 2 km from any registry wetland
  (W323 is 70 km off; likely a coordinate error).
- `wetland_sites_no_coords.csv`, `wetland_registry_no_coords.csv`.
- `data/bird_crosswalk.csv` — the supplement rows (`xw_source = supplement`) are my
  additions and should be checked by a birder.

## Running the app

Requires the build packages plus `shiny`, `bslib` (>= 0.6), `leaflet`, `plotly`, `DT`.

```r
# from the project root, after the build (or with the data/ folder from the zip)
shiny::runApp("app")
```

The app looks for `data/` inside `app/` first, then one level up, so it works both
from the project root and as a self-contained deployed bundle.

### What the app does

- Map: 12 ecoregion grids as toggleable layers (survey cells vivid, non-survey cells
  pale), colour modes for survey status, species recorded, records, and share of
  expert-expected species found. Hover a cell for id, status, offset from anchor,
  species and record counts; click to open it.
- Cell tab: species list (with expected flag), survey sites ranked by richness
  (revisit candidates), individual records with expandable attributes, expert-expected
  species with recorded flag.
- Ecoregion tab: coverage, species accumulation curve (by survey cell with ±1 sd, or by
  record) against the expert-expected total, species by group and source, species list.
- Overview tab: survey-cell progress by ecoregion.
- Find: choosing a species opens the full species view: cells shade dark teal by that
  species' own record count (never confounded by other species), expected-but-unrecorded
  cells show sand, and three point/track layers draw on top — every record of the species
  in red (all sources, including records outside the grid), a washed-out grey background of
  all wildlife records, and GPS collar tracks for the four collared species (all three
  default-on, individually toggleable). The expert range draws as a dashed outline with a
  pale sand fill that strengthens when grid cells are hidden, so the range + red records +
  telemetry view works with cells off entirely ("Show grid cells" toggle). Species with
  collar data are marked "collared" in the dropdown. Type a cell id to jump to it.
- Data included: sources and taxon groups can be switched off; every panel and colour
  mode recomputes from the record level.

Counts of individuals are carried in the data but never displayed.

### Deploying

1. `Rscript deploy/prepare_deploy.R` — copies `data/` into `app/` and writes `app/manifest.json`.
2. Push the repository to GitHub and connect it to Posit Connect Cloud (free tier; note
   free-tier apps are public — add `shinymanager` or use a private Hugging Face Space if
   the point locations must be access-controlled). Set the content directory to `app/`.
3. For Shiny Server / a VM: copy `app/` (with `app/data/`) to the server's apps directory.
