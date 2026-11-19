#!/usr/bin/env Rscript
# Process discovery using the bupaR ecosystem
#
# Usage:
#   Rscript discover.R \
#     --csv <path_to_csv> \
#     --case_id <column_name> \
#     --activity <column_name> \
#     --timestamp <column_name> \
#     --algorithm <dfg|inductive|heuristics> \
#     --output_format <dfg> \
#     --out <output_json_path> \
#     [--graph_id <id_string>]
#
# Output: JSON file at --out matching the DFGGraph schema.

suppressPackageStartupMessages({
  if (!requireNamespace("bupaR", quietly = TRUE))
    stop("R package 'bupaR' is required. Install: install.packages('bupaR')")
  if (!requireNamespace("processmapR", quietly = TRUE))
    stop("R package 'processmapR' is required. Install: install.packages('processmapR')")
  if (!requireNamespace("jsonlite", quietly = TRUE))
    stop("R package 'jsonlite' is required. Install: install.packages('jsonlite')")

  library(bupaR)
  library(processmapR)
  library(jsonlite)
})

# ── Argument parsing ──────────────────────────────────────────────────────────

args <- commandArgs(trailingOnly = TRUE)

get_arg <- function(flag, default = NULL) {
  idx <- which(args == flag)
  if (length(idx) == 0L) return(default)
  if (idx[1L] >= length(args)) return(default)
  args[[idx[1L] + 1L]]
}

csv_path      <- get_arg("--csv")
case_id_col   <- get_arg("--case_id",       "case:concept:name")
activity_col  <- get_arg("--activity",      "concept:name")
ts_col        <- get_arg("--timestamp",     "time:timestamp")
algorithm     <- get_arg("--algorithm",     "dfg")
output_format <- get_arg("--output_format", "dfg")
out_path      <- get_arg("--out")
graph_id      <- get_arg("--graph_id",
                         paste0("r-", format(Sys.time(), "%Y%m%d%H%M%S")))

if (is.null(csv_path))  stop("--csv is required")
if (is.null(out_path))  stop("--out is required")

# ── Load CSV ──────────────────────────────────────────────────────────────────

df <- tryCatch(
  read.csv(csv_path, stringsAsFactors = FALSE, check.names = FALSE),
  error = function(e) stop(paste("Cannot read CSV:", conditionMessage(e)))
)

# Rename to internal names, tolerating colon-prefixed pm4py column names
safe_rename <- function(df, from, to) {
  if (from %in% names(df) && from != to) {
    names(df)[names(df) == from] <- to
  }
  df
}

df <- safe_rename(df, case_id_col,  "case_id")
df <- safe_rename(df, activity_col, "activity")
df <- safe_rename(df, ts_col,       "timestamp")

required_cols <- c("case_id", "activity", "timestamp")
missing <- setdiff(required_cols, names(df))
if (length(missing) > 0) {
  stop(paste("Missing required columns:", paste(missing, collapse = ", ")))
}

# Parse timestamps — try multiple common formats
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
  as.POSIXct(x, tz = "UTC")  # last resort
}

df$timestamp <- parse_ts(df$timestamp)

if (all(is.na(df$timestamp))) {
  stop("Could not parse any timestamps. Check the timestamp column format.")
}

# Add mandatory bupaR columns if absent
if (!"lifecycle" %in% names(df))  df$lifecycle  <- "complete"
if (!"resource"  %in% names(df))  df$resource   <- "SYSTEM"
if (!"event_id"  %in% names(df))  df$event_id   <- seq_len(nrow(df))

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

# ── Helper: safe ID ───────────────────────────────────────────────────────────

safe_id <- function(label) {
  id <- gsub("[^a-z0-9_]", "_", tolower(as.character(label)))
  substr(id, 1, 32)
}

# ── Discover ──────────────────────────────────────────────────────────────────

result <- list()

if (output_format == "dfg") {

  # Precedence matrix — absolute counts
  prec_obj <- tryCatch(
    processmapR::precedence_matrix(log, type = "absolute"),
    error = function(e) stop(paste("processmapR::precedence_matrix failed:", conditionMessage(e)))
  )
  prec_df <- as.data.frame(prec_obj)

  # Activity counts
  act_tbl <- as.data.frame(table(df$activity), stringsAsFactors = FALSE)
  names(act_tbl) <- c("activity", "count")

  activities <- lapply(seq_len(nrow(act_tbl)), function(i) {
    list(
      id              = safe_id(act_tbl$activity[i]),
      label           = act_tbl$activity[i],
      count           = as.integer(act_tbl$count[i]),
      meanDurationSec = NULL
    )
  })

  # Build edges from precedence matrix
  edges     <- list()
  edge_idx  <- 1L

  # Column names vary slightly across bupaR versions
  ant_col <- if ("antecedent"  %in% names(prec_df)) "antecedent"  else names(prec_df)[1]
  con_col <- if ("consequent"  %in% names(prec_df)) "consequent"  else names(prec_df)[2]
  n_col   <- if ("n"           %in% names(prec_df)) "n"           else names(prec_df)[3]

  for (i in seq_len(nrow(prec_df))) {
    cnt <- as.integer(prec_df[[n_col]][i])
    if (!is.na(cnt) && cnt > 0L) {
      edges[[edge_idx]] <- list(
        id              = paste0("e", edge_idx - 1L),
        source          = safe_id(prec_df[[ant_col]][i]),
        target          = safe_id(prec_df[[con_col]][i]),
        count           = cnt,
        meanDurationSec = NULL
      )
      edge_idx <- edge_idx + 1L
    }
  }

  # Start and end activities
  start_df <- tryCatch(
    as.data.frame(bupaR::start_activities(log)),
    error = function(e) data.frame()
  )
  end_df <- tryCatch(
    as.data.frame(bupaR::end_activities(log)),
    error = function(e) data.frame()
  )

  make_act_map <- function(df) {
    if (nrow(df) == 0 || ncol(df) < 2) return(list())
    result_map <- as.list(as.integer(df[[2]]))
    names(result_map) <- sapply(as.character(df[[1]]), safe_id)
    result_map
  }

  result <- list(
    kind            = "dfg",
    id              = graph_id,
    name            = paste("R bupaR DFG:", basename(csv_path)),
    activities      = activities,
    startActivities = make_act_map(start_df),
    endActivities   = make_act_map(end_df),
    edges           = edges
  )

} else {
  stop(paste0(
    "Unsupported output_format for R bridge: '", output_format, "'. ",
    "Currently only 'dfg' is supported."
  ))
}

# ── Write JSON ────────────────────────────────────────────────────────────────

tryCatch(
  writeLines(
    jsonlite::toJSON(result, auto_unbox = TRUE, null = "null", pretty = TRUE),
    out_path
  ),
  error = function(e) stop(paste("Failed to write JSON output:", conditionMessage(e)))
)

cat("Done. Written to:", out_path, "\n")
