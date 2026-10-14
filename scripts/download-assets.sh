#!/usr/bin/env bash
# Downloads free CC0 photographic assets from Poly Haven (https://polyhaven.com)
# into public/assets-pack/: HDRI skies for each track plus PBR surface scans for
# asphalt, ground and pavement. Run from the project folder:
#   bash scripts/download-assets.sh
# Every download is optional - anything that fails keeps the procedural look.
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=public/assets-pack
mkdir -p "$OUT"
HDR="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k"
TEX="https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k"

fetch() { curl -fsSL --retry 2 --max-time 120 "$1" -o "$2.part" 2>/dev/null && mv "$2.part" "$2" || { rm -f "$2.part"; return 1; }; }

json_hdri=""
for entry in \
  "neon-harbor:shanghai_bund dikhololo_night moonlit_golf" \
  "redline-canyon:qwantani_dusk_2_puresky kloppenheim_06_puresky venice_sunset" \
  "skyline-circuit:venice_sunset kiara_1_dawn sunset_fairway"; do
  track="${entry%%:*}"; names="${entry#*:}"
  printf 'Sky for %-16s ... ' "$track"
  got=0
  for n in $names; do
    if fetch "$HDR/${n}_1k.hdr" "$OUT/$track.hdr"; then echo "ok ($n)"; got=1; json_hdri="$json_hdri\"$track\": \"$track.hdr\","; break; fi
  done
  [ $got -eq 1 ] || echo "FAILED (procedural sky stays)"
done

json_tex=""
for entry in \
  "asphalt:asphalt_02 asphalt_01 asphalt_04" \
  "sand:red_laterite_soil_stones aerial_rocks_02 coast_sand_rocks_02" \
  "pavement:concrete_floor_02 concrete_floor_worn_001 concrete_pavers"; do
  slot="${entry%%:*}"; names="${entry#*:}"
  printf 'Surface %-9s ... ' "$slot"
  got=0
  for n in $names; do
    if fetch "$TEX/$n/${n}_diff_1k.jpg" "$OUT/${slot}_diff.jpg"; then
      nor=""
      fetch "$TEX/$n/${n}_nor_gl_1k.jpg" "$OUT/${slot}_nor.jpg" && nor=", \"nor\": \"${slot}_nor.jpg\""
      echo "ok ($n)"; got=1
      json_tex="$json_tex\"$slot\": { \"diff\": \"${slot}_diff.jpg\"$nor },"
      break
    fi
  done
  [ $got -eq 1 ] || echo "FAILED (procedural surface stays)"
done

{
  echo '{'
  echo "  \"hdri\": { ${json_hdri%,} },"
  echo "  \"textures\": { ${json_tex%,} }"
  echo '}'
} > "$OUT/manifest.json"
echo "Wrote $OUT/manifest.json"
exit 0
