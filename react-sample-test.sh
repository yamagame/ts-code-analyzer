#!/usr/bin/env bash
yarn --silent dev src/ts-component.ts --base=../../react-typescript-starter-app/src/ ../../react-typescript-starter-app/src/index.tsx --mode json | tee test/data/test-data.json
yarn --silent dev src/ts-component.ts --base=../../react-typescript-starter-app/src/ ../../react-typescript-starter-app/src/index.tsx --mode csv | tee test/data/test-data.csv
yarn --silent dev src/ts-component.ts --base=../../react-typescript-starter-app/src/ ../../react-typescript-starter-app/src/index.tsx --debug --mode log | tee test/data/test-data.log
