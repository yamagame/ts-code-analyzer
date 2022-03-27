#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

type PromiseReturnType<T> = T extends Promise<infer U> ? U : never;
export type ScanAsyncReturnType = PromiseReturnType<
  ReturnType<typeof scanAsync>
>;

const header = [
  '@startuml dependencies',
  "' title  React サンプルプロジェクト 依存関係図",
  'skinparam shadowing false',
  'scale 0.8',
  'skinparam packageStyle Rectangle',
  // 'left to right direction',
];

const footer = ['@enduml'];

const isDefined = <T>(value: T | null | undefined): value is T => {
  return value !== null && value !== undefined;
};

const exts = ['', '.ts', '.js', '.jsx', '.tsx'];

const removeRootDir = (srcDir: string, src: string) => {
  if (srcDir !== '' && src.indexOf(srcDir) === 0) {
    return src.substring(srcDir.length);
  }
  return src;
};

const findFileWithExts = (makePathCallback: (ext: string) => string) => {
  let findFile = '';
  exts.some((ext) => {
    const filePath = makePathCallback(ext);
    if (fs.existsSync(filePath) && !fs.lstatSync(filePath).isDirectory()) {
      findFile = filePath;
      return true;
    }
    return false;
  });
  return findFile;
};

const findFile = (basePath: string, baseDir: string, filename: string) => {
  try {
    if (filename.startsWith('/')) return undefined;
    if (filename === '.') {
      {
        const file = findFileWithExts((ext) =>
          path.join(`${filename}/index${ext}`).normalize()
        );
        if (file) return file;
      }
      return undefined;
    }
    if (fs.existsSync(filename) && !fs.lstatSync(filename).isDirectory())
      return filename;
    {
      const file = findFileWithExts((ext) =>
        path.join(`${filename}${ext}`).normalize()
      );
      if (file) return file;
    }
    {
      const file = findFileWithExts((ext) =>
        path.join(`${filename}/index${ext}`).normalize()
      );
      if (file) return file;
    }
    if (basePath === '') return undefined;
    {
      const file = findFileWithExts((ext) =>
        path.join(basePath, `${filename}${ext}`).normalize()
      );
      if (file) return file;
    }
    {
      const file = findFileWithExts((ext) =>
        path.join(basePath, `${filename}/index${ext}`).normalize()
      );
      if (file) return file;
    }
    {
      const file = findFileWithExts((ext) =>
        path.join(baseDir, `${filename}${ext}`).normalize()
      );
      if (file) return file;
    }
    {
      const file = findFileWithExts((ext) =>
        path.join(baseDir, `${filename}/index${ext}`).normalize()
      );
      if (file) return file;
    }
    // console.log(`## not found : ${basePath} : ${filename}`);
    return undefined;
  } catch (err) {
    console.error(err);
  }
  return undefined;
};

type CachedFiles = { [index: string]: string[] };

const cachedFiles: CachedFiles = {};

const scanTypescriptAsync = async (srcPath: string, baseDir: string) => {
  try {
    if (cachedFiles[srcPath]) {
      return;
    }
    // console.log(`${srcPath} -------------------------------------------`);
    const fileInfo = ts.preProcessFile(fs.readFileSync(srcPath).toString());
    const imports = fileInfo.importedFiles
      .map((file) => file.fileName)
      .map((file) => findFile(path.dirname(srcPath), baseDir, file))
      .filter(isDefined);
    // console.log(imports);
    cachedFiles[srcPath] = imports;
    imports.forEach((importFile) => {
      scanTypescriptAsync(importFile, baseDir);
    });
  } catch (err) {
    console.error(srcPath);
    console.error(err);
  }
};

export async function scanAsync(srcPath: string, baseDir: string) {
  await scanTypescriptAsync(srcPath, baseDir);
  const result = Object.entries(cachedFiles).map(([src, imports]) => ({
    source: removeRootDir(baseDir, src),
    imports: imports.map((src) => removeRootDir(baseDir, src)),
  }));
  return result;
}

async function main(argv: string[]) {
  const arg = yargs(hideBin(argv))
    .detectLocale(false)
    .scriptName('ts-scan')
    .usage('$0 [options] <source>', 'Scan typescript import files.')
    .option('base', {
      type: 'string',
      default: '',
      describe: 'Set base directory',
      demandOption: true,
    })
    .option('source', { type: 'string' })
    .demandCommand(1)
    .help()
    .parseSync();

  const srcPath = `${arg.source}`;
  const baseDir = `${arg.base}`;

  const result = await scanAsync(srcPath, baseDir);
  console.log(JSON.stringify(result, null, '  '));
}

if (require.main === module) {
  main(process.argv);
}
