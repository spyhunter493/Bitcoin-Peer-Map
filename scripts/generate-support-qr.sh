#!/usr/bin/env sh
set -eu

# Requires qrencode and Python 3; no application dependency is needed.
support_repo_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
support_svg="${support_repo_dir}/src/static/assets/support-bitcoin-qr.svg"
qrencode --type=SVG --inline --svg-path --rle \
    --level=M --margin=4 --size=6 \
    --foreground=000000 --background=ffffff \
    --output="${support_svg}" \
    'bitcoin:bc1qnngus06lk0e60e05yq902e9edx7kt4kcuuuy72'

python3 - "${support_svg}" <<'PY'
import sys
import xml.etree.ElementTree as ET

ET.register_namespace('', 'http://www.w3.org/2000/svg')
tree = ET.parse(sys.argv[1])
svg = tree.getroot()
dimension = int(svg.attrib['viewBox'].split()[2]) * 6
svg.set('width', str(dimension))
svg.set('height', str(dimension))
svg.set('preserveAspectRatio', 'xMidYMid meet')
svg.set('shape-rendering', 'crispEdges')
for path in svg.iter('{http://www.w3.org/2000/svg}path'):
    path.attrib.pop('style', None)
    path.set('stroke', '#000000')
    path.set('fill', 'none')
tree.write(sys.argv[1], encoding='unicode')
with open(sys.argv[1], 'a') as output:
    output.write('\n')
PY
