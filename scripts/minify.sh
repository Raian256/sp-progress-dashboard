#!/bin/bash

# The host caps index.html at 100KB. Terser's defaults leave top-level names
# unmangled — and nearly all of the script is top-level — so mangle those too
# (safe: nothing in the HTML references script names; tests run the unminified
# source and use the explicit window.* exports). console.log is debug noise in
# the release build; warn/error stay.
PROJECT="$1"
html-minifier-terser \
    --collapse-whitespace \
    --remove-comments \
    --remove-optional-tags \
    --minify-css true \
    --minify-js '{"toplevel":true,"compress":{"passes":2,"pure_funcs":["console.log"]},"mangle":{"toplevel":true}}' \
    -o build/$PROJECT/index.html $PROJECT/index.html
