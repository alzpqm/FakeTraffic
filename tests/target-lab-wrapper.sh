#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Test-only loader wrapper for an already-built target binary in the isolated
# namespace fixture. Does not install a host loader or change library paths.
set -eu
exec "${FT_TEST_LOADER:?explicit existing target loader required}" \
    --library-path "${FT_TEST_LIBRARIES:?explicit target libraries required}" \
    "${FT_TEST_BINARY:?explicit staged target binary required}" "$@"
