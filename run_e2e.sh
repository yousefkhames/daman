#!/bin/sh
# Serves the folder locally and runs the browser click-through against it.
cd "$(dirname "$0")"
python3 -m http.server 8137 >/dev/null 2>&1 &
SRV=$!
sleep 1
BASE=http://localhost:8137/ node tests/e2e.js
RC=$?
kill $SRV
exit $RC
