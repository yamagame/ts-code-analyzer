#!/usr/bin/env bash
yarn --silent dev src/ts-component.ts --base=./ ./test/sample/index.ts --mode json | tee test/data/sample-index.json
yarn --silent dev src/ts-component.ts --base=./ ./test/sample/index.ts --mode csv | tee test/data/sample-index.csv
yarn --silent dev src/ts-component.ts --base=./ ./test/sample/index.ts --debug --mode log | tee test/data/sample-index.log
