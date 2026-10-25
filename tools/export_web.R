# ============================================================================
# export_web.R — convert the TDE 2.0 data/ folder (rds) into
#   (a) compact web files for the static dashboard      -> <site>/data/
#   (b) full open-format files for the hand-off pack     -> <pack>/
# Usage: Rscript export_web.R <project_root> <site_dir> <pack_dir>
# ============================================================================
suppressPackageStartupMessages({
  library(sf); library(dplyr); library(tidyr); library(stringr); library(jsonlite); library(readr)
})
sf_use_s2(FALSE)
args <- commandArgs(trailingOnly = TRUE)
root <- args[1]; site <- file.path(args[2], "data"); pack <- args[3]
dir.create(site, recursive = TRUE, showWarnings = FALSE)
dir.create(file.path(pack, "geojson"), recursive = TRUE, showWarnings = FALSE)
dir.create(file.path(pack, "csv"), recursive = TRUE, showWarnings = FALSE)
rd <- function(n) readRDS(file.path(root, "data", paste0(n, ".rds")))
wj <- function(x, name, digits = NA, ...) {
  f <- file.path(site, name)
  write_json(x, f, auto_unbox = TRUE, na = "null", null = "null", digits = digits, ...)
  cat(sprintf("  %-28s %6.2f MB\n", name, file.size(f) / 1e6))
}
wgeo <- function(x, path, digits = 5) {
  if (file.exists(path)) file.remove(path)
  st_write(x, path, driver = "GeoJSON", quiet = TRUE,
           layer_options = c(sprintf("COORDINATE_PRECISION=%d", digits), "RFC7946=YES", "WRITE_BBOX=NO"))
  cat(sprintf("  %-28s %6.2f MB\n", basename(path), file.size(path) / 1e6))
}
wcsv <- function(x, name) { f <- file.path(pack, "csv", name); write_csv(x, f, na = ""); cat(sprintf("  %-28s %6.2f MB\n", name, file.size(f) / 1e6)) }

grid <- rd("grid"); eco <- rd("ecoregions"); pa <- rd("protected_areas"); wreg <- rd("wetland_registry")
ranges <- rd("ranges"); obs <- rd("observations"); obs_cell <- rd("obs_cell"); species <- rd("species")
cell_exp <- rd("cell_expected"); cell_sum <- rd("cell_summary"); eco_sum <- rd("eco_summary"); eco_sp <- rd("eco_species")
eco_sat <- rd("eco_saturation"); sites <- rd("sites"); revisit <- rd("revisit"); cell_sp <- rd("cell_species")
telem <- rd("telemetry"); telem_col <- rd("telemetry_collars"); cell_pa <- rd("cell_pa"); cell_wet <- rd("cell_wetlands")

GROUPS  <- c("Birds", "Mammals", "Reptiles", "Amphibians", "Invertebrates", "Fish", "Other")
SOURCES <- c("birds", "wetlands", "partner", "ranger", "ncw")
TIERS   <- c("field", "internal", "compiled")
idx0 <- function(x, levels) { i <- match(x, levels) - 1L; ifelse(is.na(i), -1L, i) }

# ---- 1. grid (static cell facts + bbox) ------------------------------------
cat("\n== web files ==\n")
bb <- do.call(rbind, lapply(st_geometry(grid), function(g) as.numeric(st_bbox(g))))
grid_df <- grid |> st_drop_geometry() |>
  transmute(id = cell_id, code, status, s = as.integer(is_sample), e = east, n = north,
            lon = round(lon, 5), lat = round(lat, 5),
            x1 = round(bb[, 1], 5), y1 = round(bb[, 2], 5), x2 = round(bb[, 3], 5), y2 = round(bb[, 4], 5),
            npa = n_pa, pa = pa_names, nwet = n_wetlands_registry)
eco_lut <- eco |> st_drop_geometry() |> transmute(code, name = eco_name, area_km2 = round(area_km2), cell_deg = NA_real_)
cd <- grid |> st_drop_geometry() |> distinct(code, cell_deg)
eco_lut$cell_deg <- round(cd$cell_deg[match(eco_lut$code, cd$code)], 6)
eco_lut <- eco_lut |> arrange(name)
wj(list(eco = eco_lut, cells = grid_df), "grid.json")

# ---- 2. polygons: web-simplified ----------------------------------------------
as_mp <- function(x) {
  if (any(st_geometry_type(x) == "GEOMETRYCOLLECTION")) x <- st_collection_extract(x, "POLYGON")
  st_cast(x, "MULTIPOLYGON")
}
eco_web <- suppressWarnings(st_simplify(eco, preserveTopology = TRUE, dTolerance = 0.003)) |> st_make_valid() |> as_mp()
cat("  ecoregion vertices:", nrow(st_coordinates(eco)), "->", nrow(st_coordinates(eco_web)), "\n")
wgeo(eco_web |> select(code, eco_name), file.path(site, "ecoregions.geojson"), 4)
wgeo(pa |> select(pa_id, pa_name_en, category, status_ar, iucn_cat), file.path(site, "protected_areas.geojson"), 4)
wgeo(ranges |> select(species, taxon_group, iucn_global), file.path(site, "ranges.geojson"), 4)

# wetland registry points (plain table; the site makes markers)
wj(wreg |> st_drop_geometry() |>
     transmute(id = wetland_id, name = coalesce(name_en, name_ar), name_ar, lon = round(lon, 5), lat = round(lat, 5),
               surveyed = as.integer(surveyed), site = survey_site_code),
   "wetlands.json")

# ---- 3. observations (columnar, dictionary-encoded) ---------------------------
dict <- function(x) { lv <- sort(unique(na.omit(x))); list(levels = lv, idx = idx0(x, lv)) }
sp_d <- dict(obs$species); cn_d <- dict(obs$common_name); site_d <- dict(obs$site_id)
proj_d <- dict(obs$project); seas_d <- dict(obs$season); meth_d <- dict(obs$method); raw_d <- dict(obs$species_raw)
obs_web <- list(
  n = nrow(obs),
  sources = SOURCES, tiers = TIERS, groups = GROUPS,
  sp_names = sp_d$levels, cn_names = cn_d$levels, site_ids = site_d$levels,
  projects = proj_d$levels, seasons = seas_d$levels, methods = meth_d$levels, raw_names = raw_d$levels,
  id   = obs$obs_id,
  src  = idx0(obs$source, SOURCES),
  tier = idx0(obs$tier, TIERS),
  grp  = idx0(obs$taxon_group, GROUPS),
  sp   = sp_d$idx,
  issp = as.integer(obs$rank %in% c("species", "subspecies")),
  rank = idx0(obs$rank, c("species", "subspecies", "genus", "unidentified", "unparsed", "family", "order", "class", "phylum")),
  cn   = cn_d$idx,
  date = ifelse(is.na(obs$date), NA_integer_, as.integer(obs$date)),   # days since 1970-01-01
  lon  = round(obs$lon, 5), lat = round(obs$lat, 5),
  site = site_d$idx, proj = proj_d$idx, seas = seas_d$idx, meth = meth_d$idx, raw = raw_d$idx
)
wj(obs_web, "observations.json", digits = 5)

# record attributes: one shard per ecoregion (loaded when a cell of that ecoregion is opened)
attrs_dir <- file.path(site, "attrs"); dir.create(attrs_dir, showWarnings = FALSE)
oc_idx <- obs_cell |> mutate(oi = match(obs_id, obs$obs_id) - 1L, ci = match(cell_id, grid$cell_id) - 1L)
for (cd_ in sort(unique(oc_idx$code))) {
  ids <- unique(oc_idx$oi[oc_idx$code == cd_])
  a <- setNames(as.list(obs$attrs[ids + 1L]), ids)
  f <- file.path(attrs_dir, paste0(cd_, ".json"))
  writeLines(sprintf("{%s}", paste(sprintf('"%d":%s', ids, obs$attrs[ids + 1L]), collapse = ",")), f)
}
cat(sprintf("  attrs/*.json (12 shards)     %6.2f MB total\n", sum(file.size(list.files(attrs_dir, full.names = TRUE))) / 1e6))

# obs -> cell links (row indices)
wj(list(o = oc_idx$oi, c = oc_idx$ci), "obs_cell.json")

# ---- 4. species + expected ------------------------------------------------------
TELEM_SPECIES <- sort(unique(telem$species))
wj(species |> transmute(species, group = taxon_group, common = common_name, n_records, n_sources, sources,
                        has_range = as.integer(has_range), iucn = iucn_global,
                        collared = as.integer(species %in% TELEM_SPECIES)),
   "species.json")
exp_strict <- cell_exp |> filter(centroid) |> mutate(ci = match(cell_id, grid$cell_id) - 1L) |> arrange(species, ci)
exp_list <- exp_strict |> group_by(species, taxon_group) |> summarise(cells = list(ci), .groups = "drop")
wj(list(species = exp_list$species, group = exp_list$taxon_group, cells = lapply(exp_list$cells, I)), "cell_expected.json")

# ---- 5. ecoregion tables ---------------------------------------------------------
wj(list(
  summary = eco_sum,
  species = eco_sp |> transmute(code, species, group = taxon_group, common = common_name, n_records, n_cells,
                                expected = as.integer(expected), recorded = as.integer(recorded)),
  saturation = eco_sat |> mutate(s_mean = round(s_mean, 2), s_sd = round(s_sd, 2))
), "eco.json", digits = 2)

# ---- 6. sites --------------------------------------------------------------------
wj(sites |> transmute(key = site_key, src = idx0(source, SOURCES), tier = idx0(tier, TIERS), name = site_name,
                      lon = round(lon, 5), lat = round(lat, 5), n_records, n_species, n_visits,
                      last = as.character(last_date), methods, cells, in_sample = as.integer(coalesce(in_sample_cell, FALSE))),
   "sites.json", digits = 5)

# ---- 7. telemetry segments -------------------------------------------------------
telem <- telem |> arrange(seg_id, event_time)
seg_meta <- telem |> group_by(seg_id, device_id, species, species_label, cluster) |>
  summarise(n_fix = n(), t0 = as.character(as.Date(min(event_time))), t1 = as.character(as.Date(max(event_time))), .groups = "drop")
geoms <- lapply(split(telem[, c("lon", "lat")], telem$seg_id), function(m) st_linestring(as.matrix(m)))
telem_lines <- st_sf(seg_meta[match(names(geoms), seg_meta$seg_id), ], geometry = st_sfc(unname(geoms), crs = 4326))
wgeo(telem_lines, file.path(site, "telemetry.geojson"), 5)
wj(telem_col, "telemetry_collars.json")

# ---- 8. hand-off pack: full-resolution open formats -------------------------------
cat("\n== hand-off pack ==\n")
wgeo(grid, file.path(pack, "geojson", "grid_cells.geojson"), 6)
wgeo(eco, file.path(pack, "geojson", "ecoregions.geojson"), 6)
wgeo(pa, file.path(pack, "geojson", "protected_areas.geojson"), 6)
wgeo(wreg, file.path(pack, "geojson", "wetland_registry.geojson"), 6)
wgeo(ranges, file.path(pack, "geojson", "species_ranges.geojson"), 6)
wgeo(telem_lines, file.path(pack, "geojson", "telemetry_segments.geojson"), 6)
gp <- file.path(pack, "tde_reference.gpkg"); if (file.exists(gp)) file.remove(gp)
for (L in list(list(grid, "grid_cells"), list(eco, "ecoregions"), list(pa, "protected_areas"),
               list(wreg, "wetland_registry"), list(ranges, "species_ranges"), list(telem_lines, "telemetry_segments")))
  st_write(L[[1]], gp, layer = L[[2]], quiet = TRUE)
cat(sprintf("  %-28s %6.2f MB\n", basename(gp), file.size(gp) / 1e6))
obs_pts <- obs |> filter(!is.na(lon), !is.na(lat)) |> st_as_sf(coords = c("lon", "lat"), crs = 4326, remove = FALSE)
st_write(obs_pts |> select(-attrs), gp, layer = "observations", quiet = TRUE)
cat("  + observations point layer written to gpkg\n")

wcsv(obs, "observations.csv"); wcsv(obs_cell, "obs_cell.csv"); wcsv(species, "species.csv")
wcsv(cell_sp, "cell_species.csv"); wcsv(cell_exp, "cell_expected.csv"); wcsv(cell_sum, "cell_summary.csv")
wcsv(cell_pa, "cell_pa.csv"); wcsv(cell_wet, "cell_wetlands.csv")
wcsv(eco_sum, "eco_summary.csv"); wcsv(eco_sp, "eco_species.csv"); wcsv(eco_sat, "eco_saturation.csv")
wcsv(sites, "sites.csv"); wcsv(revisit, "revisit.csv")
wcsv(telem, "telemetry_fixes.csv"); wcsv(telem_col, "telemetry_collars.csv")
wcsv(wreg |> st_drop_geometry(), "wetland_registry.csv")
file.copy(file.path(root, "data", "bird_crosswalk.csv"), file.path(pack, "csv", "bird_crosswalk.csv"), overwrite = TRUE)
cat("\ndone\n")
