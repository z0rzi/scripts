#!/usr/bin/env bash

if [ $# -gt 0 ]; then
    path=$1
else
    path="."
fi

bash -c "rg $path --files || find $path -type f" | datesort.ts
