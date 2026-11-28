#!/usr/bin/env Rscript
# Render a processmapR::process_map() to a PNG file.
#
# Usage:
#   Rscript render_process_map.R \
#     --csv      <path_to_csv> \
#     --out      <output_png_path> \
#     [--case_id    <column_name>]       default: "case:concept:name"
#     [--activity   <column_name>]       default: "concept:name"
#     [--timestamp  <column_name>]       default: "time:timestamp"
#     [--type       frequency|performance]  default: "frequency"
#
# Requires R packages:
#   bupaR, processmapR, DiagrammeRsvg, rsvg, jsonlite
#
# Install (once):
#   install.packages(c("bupaR","processmapR","DiagrammeRsvg","rsvg","jsonlite"),
#                    repos = "https://cloud.r-project.org")

suppressPackageStartupMessages({
  for (pkg in c("bupaR", "processmapR", "DiagrammeRsvg", "rsvg", "jsonlite")) {
    if (!requireNamespace(pkg, quietly = TRUE))
      stop(sprintf(
        "R package '%s' is required. Install with: install.packages('%s')", pkg, pkg
      ))
  }
  library(bupaR)
  library(processmapR)
  library(DiagrammeRsvg)
  library(rsvg)
})

# ── Argument parsing ──────────────────────────────────────────────────────────

args <- commandArgs(trailingOnly = TRUE)

get_arg <- function(flag, default = NULL) {
  idx <- which(args == flag)
  if (length(idx) == 0L) return(default)
  if (idx[1L] >= length(args)) return(default)
  args[[idx[1L] + 1L]]
}

csv_path     <- get_arg("--csv")
out_path     <- get_arg("--out")
case_id_col  <- get_arg("--case_id",   "case:concept:name")
activity_col <- get_arg("--activity",  "concept:name")
ts_col       <- get_arg("--timestamp", "time:timestamp")
map_type     <- get_arg("--type",      "frequency")   # frequency | performance

if (is.null(csv_path)) stop("--csv is required")
if (is.null(out_path)) stop("--out is required")
if (!map_type %in% c("frequency", "performance"))
  stop(sprintf("--type must be 'frequency' or 'performance', got '%s'", map_type))

# ── Load CSV ──────────────────────────────────────────────────────────────────

df <- tryCatch(
  read.csv(csv_path, stringsAsFactors = FALSE, check.names = FALSE),
  error = function(e) stop(paste("Cannot read CSV:", conditionMessage(e)))
)

# Rename columns to internal names (tolerates pm4py colon-prefixed names)
safe_rename <- function(df, from, to) {
  if (from %in% names(df) && from != to) names(df)[names(df) == from] <- to
  df
}
df <- safe_rename(df, case_id_col,  "case_id")
df <- safe_rename(df, activity_col, "activity")
df <- safe_rename(df, ts_col,       "timestamp")

required_cols <- c("case_id", "activity", "timestamp")
missing <- setdiff(required_cols, names(df))
if (length(missing) > 0)
  stop(paste("Missing required columns after rename:", paste(missing, collapse = ", ")))

# ── Parse timestamps ──────────────────────────────────────────────────────────

parse_ts <- function(x) {
  formats <- c(
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%OSZ",
    "%Y-%m-%d"
  )
  for (fmt in formats) {
    parsed <- as.POSIXct(x, format = fmt, tz = "UTC")
    if (!all(is.na(parsed))) return(parsed)
  }
  as.POSIXct(x, tz = "UTC")
}

df$timestamp <- parse_ts(df$timestamp)
if (all(is.na(df$timestamp)))
  stop("Could not parse any timestamps. Check the timestamp column format.")

# ── Mandatory bupaR columns ───────────────────────────────────────────────────

if (!"lifecycle" %in% names(df)) df$lifecycle <- "complete"
if (!"resource"  %in% names(df)) df$resource  <- "SYSTEM"
if (!"event_id"  %in% names(df)) df$event_id  <- seq_len(nrow(df))

# ── Build bupaR event log ─────────────────────────────────────────────────────

log <- tryCatch(
  bupaR::eventlog(
    df,
    case_id              = "case_id",
    activity_id          = "activity",
    activity_instance_id = "event_id",
    lifecycle_id         = "lifecycle",
    timestamp            = "timestamp",
    resource_id          = "resource"
  ),
  error = function(e) stop(paste("Failed to build bupaR event log:", conditionMessage(e)))
)

# ── Render process map → SVG → PNG ───────────────────────────────────────────

type_arg <- if (map_type == "performance") performance() else frequency()

# processmapR returns a DiagrammeR grViz object
pm_obj <- tryCatch(
  processmapR::process_map(log, type = type_arg, render = FALSE),
  error = function(e) stop(paste("processmapR::process_map failed:", conditionMessage(e)))
)

# Export grViz DOT source → SVG via DiagrammeRsvg
svg_str <- tryCatch(
  DiagrammeRsvg::export_svg(pm_obj),
  error = function(e) stop(paste("DiagrammeRsvg::export_svg failed:", conditionMessage(e)))
)

# Convert SVG → PNG via rsvg (writes directly to file)
tryCatch(
  rsvg::rsvg_png(chartr("", "", svg_str), file = out_path, width = 1600),
  error = function(e) {
    # rsvg_png may also accept a raw vector; try via chartr conversion
    rsvg::rsvg_png(
      svg  = charToRaw(svg_str),
      file = out_path,
      width = 1600
    )
  }
)

if (!file.exists(out_path) || file.info(out_path)$size == 0)
  stop("rsvg::rsvg_png produced an empty or missing file")

cat("Done. PNG written to:", out_path, "\n")