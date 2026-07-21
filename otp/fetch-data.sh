#!/usr/bin/env bash
# Download the inputs OTP needs into ./data: GO Transit GTFS + a GTA OSM extract.
# Re-run to refresh (GO updates its GTFS every few weeks).
set -euo pipefail
cd "$(dirname "$0")/data"

# --- GO Transit GTFS (static schedule) ---------------------------------------
# Canonical source: https://www.metrolinx.com/en/about-us/open-data
# The direct asset URL below can rotate — if it 404s, grab the current link from
# the Open Data portal (accept Metrolinx's terms) and update GO_GTFS_URL.
GO_GTFS_URL="${GO_GTFS_URL:-https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip}"
echo "Downloading GO GTFS…"
curl -fSL "$GO_GTFS_URL" -o GO-GTFS.zip

# --- OSM street network -------------------------------------------------------
# Full Ontario is large (~1GB+, needs lots of OTP heap). Recommended: crop to the
# GTA with osmium (see below). For a first run you can use Ontario directly.
OSM_URL="${OSM_URL:-https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf}"
echo "Downloading Ontario OSM extract…"
curl -fSL "$OSM_URL" -o ontario.osm.pbf

# Crop to a GTA bounding box if osmium is available (much smaller graph + RAM).
# Install: brew install osmium-tool   (macOS)
if command -v osmium >/dev/null 2>&1; then
  echo "Cropping OSM to GTA bbox with osmium…"
  # left,bottom,right,top  (roughly Hamilton -> Oshawa, lake -> Barrie)
  osmium extract -b -80.3,43.1,-78.5,44.1 ontario.osm.pbf -o gta.osm.pbf --overwrite
else
  echo "osmium not found — using full Ontario extract (larger graph)."
  echo "Install osmium-tool and re-run to shrink it. Falling back:"
  cp ontario.osm.pbf gta.osm.pbf
fi

echo "Done. Now: docker compose up"
