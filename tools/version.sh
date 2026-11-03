#!/bin/bash
# Setzt eine neue Versionsnummer an alle CSS/JS-Verweise, damit Browser
# (und Homescreen-Apps) nach einem Update garantiert die neuen Dateien laden.
# Aufruf: tools/version.sh            (Version = aktuelles Datum+Uhrzeit)
set -e
cd "$(dirname "$0")/.."
V=${1:-$(date +%Y%m%d%H%M)}
sed -i -E "s#(assets/(style\.css|config\.js|admin\.js|liste\.js))(\?v=[0-9]+)?\"#\1?v=$V\"#g" index.html liste.html
sed -i -E "s#from \"\./common\.js(\?v=[0-9]+)?\"#from \"./common.js?v=$V\"#" assets/admin.js assets/liste.js
echo "Version $V gesetzt"
