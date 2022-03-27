## ファイルの依存関係を CSV ファイルで出力

### yarn コマンドを使用した例

```bash
yarn --silent dev src/dependency.ts dep --base=../../react-typescript-starter-app/src/ ../../react-typescript-starter-app/src/index.tsx | tee temp-result.csv
```

### npx コマンドを使用した例

```bash
npx ts-node -r tsconfig-paths/register src/dependency.ts dep --base ../../react-typescript-starter-app/src/ ../../react-typescript-starter-app/src/index.tsx | tee temp-result.csv
```

### 使用しているファイル名だけ切り出し

依存関係を CSV ファイル(例:temp-result.csv)で出力したのち下記コマンドを実行

```bash
cat temp-result.csv | cut -d ',' -f 1 | uniq
```

yarn --silent dev src/ts-component.ts --base=../../react-typescript-starter-app/src/ ../../react-typescript-starter-app/src/index.tsx | tee temp-ast-2.txt

../../react-typescript-starter-app/src/serviceWorker.ts
