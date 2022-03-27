#!/usr/bin/env node
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as CSV from 'libs/csv-parser';
import { scanAsync, ScanAsyncReturnType } from 'ts-scan';

type Flatten<Type> = Type extends Array<infer Item> ? Item : Type;

type DirsType = {
  __dir__?: string;
  __dirs__?: { [index: string]: DirsType };
  __files__?: { [index: string]: Flatten<ScanAsyncReturnType> };
};

interface PrintOptions {
  title?: string;
}

const header = [
  '@startuml dependencies',
  "' title <title> Dependency Graph",
  'skinparam shadowing false',
  'scale 0.8',
  'skinparam packageStyle Rectangle',
  // 'left to right direction',
];

const footer = ['@enduml'];

const spaces = (level: number) => {
  return new Array(level).fill('  ').join('');
};

/**
 * ディレクトリの依存関係リストを作成
 */
function reduceDirectoryGroup(result: ScanAsyncReturnType) {
  return result.reduce<DirsType>((sum, src) => {
    const basename = path.basename(src.source);
    const dirs = path.dirname(src.source).split('/');
    let s = sum;
    dirs.forEach((dir, i) => {
      if (!s.__dirs__) s.__dirs__ = {};
      if (!s.__dirs__[dir])
        s.__dirs__[dir] = {
          __dir__: dirs.slice(0, i + 1).join('_'),
        };
      s = s.__dirs__[dir];
    });
    if (!s.__files__) s.__files__ = {};
    s.__files__[basename] = src;
    return sum;
  }, {});
}

const rootIsRoot = (path: string | undefined) => {
  if (path === undefined) return 'undefined';
  return path === '.' ? 'root' : path;
};

/**
 * ファイルの依存関係図 CSV 形式
 */
function printFilesDependencyCSV(scanFiles: ScanAsyncReturnType) {
  const result = scanFiles
    .map((file) =>
      file.imports.length > 0
        ? file.imports.map((dep) => [file.source, dep])
        : [[file.source, '']]
    )
    .flat()
    .map((d) => [{ value: d[0] }, { value: d[1] }]);
  console.log(
    CSV.stringify([[{ value: 'source' }, { value: 'import' }], ...result])
  );
}

/**
 * ファイルの依存関係図 PlantUML 形式
 */
function printFilesDependencyPlantUML(
  directoryGroups: ReturnType<typeof reduceDirectoryGroup>,
  options: PrintOptions
) {
  console.log(header.join('\n').replace('<title> ', options?.title || ''));

  const printGroup = (groups: DirsType, level: number) => {
    if (groups.__dirs__) {
      Object.entries(groups.__dirs__).forEach(([dirname, dirs]) => {
        console.log(
          `${spaces(level)}package "${dirname}" as ${rootIsRoot(
            dirs.__dir__
          ).replace(/\//g, '_')} {`
        );
        printGroup(dirs, level + 1);
        console.log(`${spaces(level)}}`);
      });
    }
    if (groups.__files__) {
      Object.entries(groups.__files__).forEach(([filename, src]) => {
        console.log(
          `${spaces(level)}rectangle "${path.basename(
            filename
          )}" as ${src.source.replace(/\//g, '_')}`
        );
      });
    }
  };

  printGroup(directoryGroups, 0);

  const printDependency = (groups: DirsType) => {
    if (groups.__dirs__) {
      Object.entries(groups.__dirs__).forEach(([_, dirs]) => {
        printDependency(dirs);
      });
    }
    if (groups.__files__) {
      Object.entries(groups.__files__).forEach(([_, src]) => {
        src.imports.forEach((file) =>
          console.log(
            `${src.source.replace(/\//g, '_')} ---> ${file.replace(/\//g, '_')}`
          )
        );
      });
    }
  };

  printDependency(directoryGroups);

  console.log(footer.join('\n'));
}

/**
 * ディレクトリの依存関係を調べる
 */
function makeDirectoryDependencyList(
  directoryGroups: ReturnType<typeof reduceDirectoryGroup>,
  print: boolean = true
) {
  const dependencies: { [index: string]: string[] } = {};

  const printGroup = (groups: DirsType, level: number) => {
    if (groups.__dirs__) {
      Object.entries(groups.__dirs__).forEach(([dirname, dirs]) => {
        print &&
          console.log(
            `${spaces(level)}package "${dirname}" as ${
              dirs.__dir__ === '.' ? 'root' : dirs.__dir__?.replace(/\//g, '_')
            } {`
          );
        printGroup(dirs, level + 1);
        print && console.log(`${spaces(level)}}`);
      });
    }
    if (groups.__files__) {
      Object.entries(groups.__files__).forEach(([_, src]) => {
        const dir = path.dirname(src.source).replace(/\//g, '_');
        src.imports.forEach((filename) => {
          const importDir = path.dirname(filename).replace(/\//g, '_');
          if (dir === importDir) return;
          if (!dependencies[dir]) dependencies[dir] = [];
          dependencies[dir].push(importDir);
        });
      });
    }
  };

  printGroup(directoryGroups, 0);

  return dependencies;
}

/**
 * ディレクトリの依存関係図 CSV 形式
 */
function printDirectoryDependencyCSV(
  directoryGroups: ReturnType<typeof reduceDirectoryGroup>,
  options: PrintOptions
) {
  console.log(options?.title || '');

  const dependencies = makeDirectoryDependencyList(directoryGroups, false);

  const result: ReturnType<typeof CSV.parse> = [];

  const printDependency = (dependencies: { [index: string]: string[] }) => {
    Object.entries(dependencies).forEach(([dir, imports]) => {
      imports.forEach((importDir) => {
        result.push([
          { value: rootIsRoot(dir), quat: '' },
          { value: rootIsRoot(importDir), quat: '' },
        ]);
      });
    });
  };

  printDependency(dependencies);

  console.log(CSV.stringify(result));
}

/**
 * ディレクトリの依存関係図 PlantUML 形式
 */
function printDirectoryDependencyPlantUML(
  directoryGroups: ReturnType<typeof reduceDirectoryGroup>,
  options: PrintOptions
) {
  console.log(header.join('\n').replace('<title> ', options?.title || ''));

  const dependencies = makeDirectoryDependencyList(directoryGroups);

  const printDependency = (dependencies: { [index: string]: string[] }) => {
    Object.entries(dependencies).forEach(([dir, imports]) => {
      imports.forEach((importDir) => {
        console.log(`${rootIsRoot(dir)} ---> ${rootIsRoot(importDir)}`);
      });
    });
  };

  printDependency(dependencies);

  console.log(footer.join('\n'));
}

async function main(argv: string[]) {
  const arg = yargs(hideBin(argv))
    .detectLocale(false)
    .scriptName('ts-dependency')
    .usage('$0 [options] <source>', 'Parse typescript source dependency.')
    .option('base', {
      type: 'string',
      default: '',
      describe: 'Set base directory',
      demandOption: true,
    })
    .option('title', {
      type: 'string',
      default: 'Typescript project',
      describe: 'Set UML title',
    })
    .option('source', { type: 'string', demandOption: true })
    .option('target', {
      choices: ['file', 'dir'],
      default: 'file',
      describe: 'Select output target',
    })
    .option('mode', {
      choices: ['uml', 'csv'],
      default: 'csv',
      describe: 'Select output type',
    })
    .help()
    .parseSync();

  const baseDir = `${arg.base}`;
  const srcPath = `${arg.source}`;
  const options = { title: arg.title };
  const cachedFiles = await scanAsync(srcPath, baseDir);
  if (arg.mode === 'uml') {
    if (arg.target === 'dir') {
      const directoryGroups = reduceDirectoryGroup(cachedFiles);
      printDirectoryDependencyPlantUML(directoryGroups, options);
    } else {
      const directoryGroups = reduceDirectoryGroup(cachedFiles);
      printFilesDependencyPlantUML(directoryGroups, options);
    }
  } else {
    if (arg.target === 'dir') {
      const directoryGroups = reduceDirectoryGroup(cachedFiles);
      printDirectoryDependencyCSV(directoryGroups, options);
    } else {
      printFilesDependencyCSV(cachedFiles);
    }
  }
}

if (require.main === module) {
  main(process.argv);
}
