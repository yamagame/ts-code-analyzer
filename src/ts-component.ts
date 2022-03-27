#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { scanAsync } from 'ts-scan';
import { scanAllChildren, LineInfo } from 'ts-parser';

const indent = (level: number) => new Array(level).fill('  ').join('');

type ParserKind = string;

class Parser {
  _ptr = 0;
  _info: LineInfo[];
  constructor(info: LineInfo[]) {
    this._info = info;
  }
  prev() {
    return this._info[--this._ptr];
  }
  next() {
    return this._info[this._ptr++];
  }
  last(d: number = 0) {
    return this._info[this._ptr - 1 + d];
  }
  isEnd() {
    return this._ptr >= this._info.length;
  }

  stack: LineInfo[] = [];

  traverse = (node: LineInfo) => {
    const isJsxElement = (node: LineInfo) =>
      node.kind === 'JsxOpeningElement' ||
      node.kind === 'JsxClosingElement' ||
      node.kind === 'JsxSelfClosingElement';
    const isComment = (node: LineInfo) =>
      node.kind === 'MultiLineCommentTrivia' ||
      node.kind === 'SingleLineCommentTrivia';
    const printLog = (node: LineInfo) => {
      if (node.kind === 'Identifier' || node.kind === 'ImportKeyword') {
        console.log(`${indent(node.level)}${node.kind} - ${node.text}`);
      } else {
        console.log(`${indent(node.level)}${node.kind}`);
      }
    };
    this.stack.push(node);
    let m = node;
    let n = node;
    while (!this.isEnd()) {
      printLog(m);
      if (
        m.kind.search(/Declaration$/) >= 0 ||
        m.kind === 'Identifier' ||
        isJsxElement(m) ||
        isComment(m)
      ) {
        console.log(this.stack.map((v) => v.kind).join('/'), m.text);
      }
      n = this.next();
      if (n.level < m.level) {
        this.stack.splice(n.level + 1);
        this.prev();
        break;
      }
      if (m.level < n.level) {
        this.traverse(n);
        n = this.next();
      }
      this.stack.pop();
      this.stack.push(n);
      m = n;
    }
  };
}

async function main(argv: string[]) {
  const arg = yargs(hideBin(argv))
    .detectLocale(false)
    .scriptName('ts-component')
    .usage('$0 [options] <source>', 'Extract react component.')
    .option('base', {
      type: 'string',
      default: '',
      describe: 'Set base directory',
      demandOption: true,
    })
    .option('source', { type: 'string', demandOption: true })
    .help()
    .parseSync();

  const baseDir = `${arg.base}`;
  const srcPath = `${arg.source}`;
  const cachedFiles = await scanAsync(srcPath, baseDir);

  const result = new Set(cachedFiles.map((file) => file.source));
  new Array(...result).forEach((sourcePath) => {
    const sourcePathWithBase = path.join(baseDir, sourcePath);
    const sourceCode = fs.readFileSync(sourcePathWithBase, 'utf-8').trim();

    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceCode,
      ts.ScriptTarget.ES5,
      true
    );

    console.log(`${sourcePath}, ${sourcePathWithBase}`);

    const imports = cachedFiles
      .filter((file) => file.source === sourcePath)
      .map((file) => file.imports)
      .flat();
    console.log(imports);

    const lineInfo: LineInfo[] = [];
    scanAllChildren(lineInfo, sourceFile, -1);

    const parser = new Parser(lineInfo);

    const topNode = parser.next();
    parser.traverse(topNode);
  });
}

if (require.main === module) {
  main(process.argv);
}
