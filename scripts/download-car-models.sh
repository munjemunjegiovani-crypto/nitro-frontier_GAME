#!/usr/bin/env bash
# Downloads the six AI-generated car models (made with Higgsfield, SAM 3D)
# into public/models/. Run from the project folder:
#   bash scripts/download-car-models.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/models
BASE="https://d8j0ntlcm91z4.cloudfront.net/user_3JrnYersSo2jtFolYfoJiZAxsrg"
declare -A MODELS=(
  [vortex]="hf_20261013_060920_6df42cf5-6e7a-41cc-97ee-d6744d4a174d.glb"
  [ember]="hf_20261013_061511_c05586d9-5a7c-45e7-86f1-903d6ea9f1b1.glb"
  [titan]="hf_20261013_061512_4d973b33-bcfb-4ee7-b40b-b33768469600.glb"
  [phantom]="hf_20261013_061514_df538609-c9fa-4b27-ac36-c963317e8913.glb"
  [kestrel]="hf_20261013_061632_46ee0ee3-dcdc-4c2b-9e80-88d0aab63c19.glb"
  [tempest]="hf_20261013_061515_03a46688-68cd-4ad8-95d9-92cd1f8a0792.glb"
)
ok=0
for id in vortex ember titan phantom kestrel tempest; do
  printf 'Downloading %-8s ... ' "$id"
  if curl -fsSL "$BASE/${MODELS[$id]}" -o "public/models/$id.glb.part"; then
    mv "public/models/$id.glb.part" "public/models/$id.glb"
    echo "ok ($(du -h "public/models/$id.glb" | cut -f1))"
    ok=$((ok + 1))
  else
    rm -f "public/models/$id.glb.part"
    echo "FAILED (the game will use the built-in model for this car)"
  fi
done
# Register every model that is present. Keep an existing manifest (which may
# hold hand-tuned flip/yaw settings) unless it is missing or still empty.
MANIFEST=public/models/manifest.json
if [ ! -s "$MANIFEST" ] || grep -q '"cars": *{ *}' "$MANIFEST"; then
  {
    echo '{'
    echo '  "cars": {'
    first=1
    for id in vortex ember titan phantom kestrel tempest; do
      [ -f "public/models/$id.glb" ] || continue
      [ $first -eq 1 ] || echo ','
      printf '    "%s": { "file": "%s.glb", "flip": false, "yawDegrees": 0, "hideWheels": true }' "$id" "$id"
      first=0
    done
    echo
    echo '  }'
    echo '}'
  } > "$MANIFEST"
fi
echo "$ok of 6 models downloaded. Start the game with: npm run dev"
