#!/usr/bin/env bash
yarn --silent dev src/ts-component.ts --base=./src/ ./src/ts-parser.ts --mode json | tee test/data/test-data-2.json
yarn --silent dev src/ts-component.ts --base=./src/ ./src/ts-parser.ts --mode csv | tee test/data/test-data-2.csv
yarn --silent dev src/ts-component.ts --base=./src/ ./src/ts-parser.ts --debug --mode log | tee test/data/test-data-2.log
