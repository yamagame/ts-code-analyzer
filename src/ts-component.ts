#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { scanAsync } from 'ts-scan';
import { scanAllChildren, AstInfo } from 'ts-parser';

enum AttentionKind {
  none,
  arrow,
  arrowParen,
  function,
  variable,
  component,
  comment,
  property,
  block,
}

interface AstNode extends AstInfo {
  identifier?: AstNode;
  returnStatement?: AstNode;
  components?: AstNode[];
  attention?: AttentionKind;
  note?: string;
}

interface AstRegExp {
  exp: RegExp | RegExp[];
  options?: any[];
  match?: (option: any, reg?: AstRegExp) => void;
}

const indent = (level: number) => new Array(level).fill('  ').join('');

class AstStack extends Array<AstNode> {
  replace(ast: AstNode) {
    this.pop();
    this.push(ast);
  }
  last(offset: number = 0) {
    return this[this.length - 1 + offset];
  }
  indexFromLast(kind: string | string[], hook?: (index: number) => void) {
    for (let i = this.length - 1; i >= 0; i--) {
      if (Array.isArray(kind)) {
        for (let j = 0; j < kind.length; j++) {
          if (this[i].kind === kind[j]) {
            if (hook) hook(i);
            return i;
          }
        }
      } else {
        if (this[i].kind === kind) {
          if (hook) hook(i);
          return i;
        }
      }
    }
    return -1;
  }
  findFromLast(kind: string | string[], hook?: (node: AstNode) => void) {
    return this.indexFromLast(kind, (index: number) => {
      if (hook) hook(this[index]);
    });
  }
  match(regs: AstRegExp[] | AstRegExp) {
    const path = this.astPath;
    const test = (reg: AstRegExp, exp: RegExp | RegExp[]) => {
      // exp が配列の場合
      if (Array.isArray(exp)) {
        return exp.some((e, i) => {
          const result = e.test(path);
          if (result && reg.match) reg.match(reg.options?.[i], reg);
          return result;
        });
      }
      // exp が単体の場合
      const result = exp.test(path);
      if (result && reg.match) reg.match(reg.options?.[0], reg);
      return result;
    };
    // regs が配列の場合
    if (Array.isArray(regs)) {
      return regs.some((reg, i) => {
        return test(reg, reg.exp);
      });
    }
    // regs が単体の場合
    return test(regs, regs.exp);
  }
  get astPath() {
    return this.map((v) => v.kind).join('/');
  }
}

function getText(node: AstNode | undefined, kind = AttentionKind.none): string {
  if (node) {
    if (
      node.attention === AttentionKind.arrow ||
      node.attention === AttentionKind.variable ||
      node.attention === AttentionKind.function
    ) {
      return getText(node.identifier, node.attention);
    }
    return `${node.line} ${
      AttentionKind[kind === AttentionKind.none ? node.attention || 0 : kind]
    }: ${node.text.replace(/[ \n]/g, '')} #${node.note || ''}`;
  }
  return '';
}

class Parser {
  _ptr = 0;
  _info: AstNode[];
  constructor(info: AstNode[]) {
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

  stack: AstStack = new AstStack();

  debugLog = (m: AstNode) => {
    const isJsxElement = (node: AstNode) =>
      node.kind === 'JsxOpeningElement' ||
      node.kind === 'JsxClosingElement' ||
      node.kind === 'JsxOpeningFragment' ||
      node.kind === 'JsxClosingFragment' ||
      node.kind === 'JsxSelfClosingElement';
    const isComment = (node: AstNode) =>
      node.kind === 'MultiLineCommentTrivia' ||
      node.kind === 'SingleLineCommentTrivia';
    const isArrow = (node: AstNode) => node.kind === 'CloseParenToken';
    const printLog = (node: AstNode) => {
      if (node.kind === 'Identifier' || node.kind === 'ImportKeyword') {
        console.log(`${indent(node.level)}${node.kind} - ${node.text}`);
      } else {
        console.log(`${indent(node.level)}${node.kind}`);
      }
    };
    printLog(m);
    if (
      m.kind.search(/Declaration$/) >= 0 ||
      m.kind === 'Identifier' ||
      isArrow(m) ||
      isJsxElement(m) ||
      isComment(m)
    ) {
      console.log(this.stack.astPath, m.text);
    }
  };

  pushAttention = (node: AstNode, attention: AttentionKind) => {
    node.attention = attention;
    this.attentions.push(node);
  };
  replaceAttention = (node: AstNode, attention: AttentionKind) => {
    node.attention = attention;
    this.attentions.pop();
    this.attentions.push(node);
  };

  attentions: AstNode[] = [];
  arrowFunctions: AstNode[] = [];
  functions: AstNode[] = [];
  variables: AstNode[] = [];
  components: AstNode[] = [];
  comments: AstNode[] = [];
  blocks: AstNode[] = [];

  traverse = (_node: AstNode) => {
    this.stack.push(_node);
    let node = _node;
    let next = _node;
    while (!this.isEnd()) {
      this.stack.match([
        // 変数を特定
        {
          exp: /VariableDeclaration\/Identifier$/,
          match: () => {
            const ast = this.stack.last(-1);
            ast.identifier = node;
            this.arrowFunctions.push(ast);
            this.pushAttention(ast, AttentionKind.variable);
          },
        },
        //
        // 関数名を特定
        {
          exp: /FunctionDeclaration\/Identifier$/,
          match: () => {
            const ast = this.stack.last(-1);
            ast.identifier = node;
            this.functions.push(ast);
            this.pushAttention(ast, AttentionKind.function);
          },
        },
        // 変数名を特定
        {
          exp: /VariableDeclaration\/Identifier$/,
          match: () => {
            const ast = this.stack.last(-1);
            ast.identifier = node;
            this.variables.push(ast);
            this.pushAttention(ast, AttentionKind.variable);
          },
        },
        // コンポーネントが戻り値になっている関数を特定
        {
          exp: [
            /ReturnStatement\/ParenthesizedExpression\/JsxElement\/JsxOpeningElement\/Identifier$/,
            /ReturnStatement\/JsxSelfClosingElement\/Identifier$/,
            /ReturnStatement\/ParenthesizedExpression\/JsxSelfClosingElement\/Identifier$/,
            /ReturnStatement\/ParenthesizedExpression\/JsxFragment\/JsxOpeningFragment$/,
          ],
          options: [
            [-4, 'open'],
            [-2, 'self'],
            [-3, 'self'],
            [-2, 'open'],
          ],
          match: (option) => {
            const ast = this.stack.last();
            ast.note = option[1];
            this.components.push(ast);
            const returnStatementAst = this.stack.last(option[0]);
            returnStatementAst.identifier = node;
            this.stack.findFromLast(
              ['FunctionDeclaration', 'VariableDeclaration'],
              (node: AstNode) => {
                node.returnStatement = returnStatementAst;
                if (!node.components) node.components = [];
                node.components?.push(ast);
                this.pushAttention(ast, AttentionKind.component);
              }
            );
          },
        },
        // 関数で使用しているコンポーネント
        {
          exp: [
            /JsxOpeningElement\/Identifier$/,
            /JsxOpeningElement\/PropertyAccessExpression\/Identifier$/,
            /JsxSelfClosingElement\/Identifier$/,
            /JsxSelfClosingElement\/PropertyAccessExpression\/Identifier$/,
            /JsxClosingElement\/Identifier$/,
            /JsxClosingElement\/PropertyAccessExpression\/Identifier$/,
            /JsxFragment\/JsxClosingFragment$/,
          ],
          options: ['open', 'open', 'self', 'self', 'close', 'close', 'close'],
          match: (option) => {
            const ast = this.stack.last();
            ast.note = option;
            this.components.push(ast);
            this.stack.findFromLast(
              ['FunctionDeclaration', 'VariableDeclaration'],
              (node: AstNode) => {
                if (!node.components) node.components = [];
                node.components?.push(ast);
                this.pushAttention(ast, AttentionKind.component);
              }
            );
          },
        },
        // プロパティ
        {
          exp: [/PropertyAccessExpression$/],
          options: [],
          match: (option) => {
            // プロパティは一旦スキップ
            this.pushAttention(node, AttentionKind.property);
            while (!this.isEnd()) {
              const ast = this.next();
              if (ast.level <= node.level) {
                break;
              }
            }
            this.prev();
          },
        },
        // アロー関数
        {
          exp: [
            /ArrowFunction\/OpenParenToken$/,
            /ArrowFunction\/CloseParenToken$/,
            /ArrowFunction\/EqualsGreaterThanToken$/,
            /ArrowFunction\/OpenParenToken\/Block\/OpenBraceToken$/,
            /ArrowFunction\/OpenParenToken\/Block\/CloseBraceToken$/,
            /ArrowFunction\/(.+?)Expression\/OpenParenToken$/,
            /ArrowFunction\/(.+?)Expression\/CloseParenToken$/,
          ],
          options: ['open', 'close', '', 'open', 'close', 'open', 'close'],
          match: (option) => {
            const ast = this.stack.last();
            this.stack.match({
              exp: [
                /VariableDeclaration\/ArrowFunction\/OpenParenToken$/,
                /VariableDeclaration\/ArrowFunction\/ParenthesizedExpression\/OpenBraceToken$/,
              ],
              options: [-2, -3],
              match: (option) => {
                const variableAst = this.stack.last(option);
                variableAst.attention = AttentionKind.arrow;
              },
            }),
              (ast.note = option);
            this.pushAttention(ast, AttentionKind.arrowParen);
          },
        },
        // ブロック
        {
          exp: [/Block\/OpenBraceToken$/, /Block\/CloseBraceToken$/],
          options: ['open', 'close'],
          match: (option) => {
            const ast = this.stack.last();
            ast.note = option;
            this.blocks.push(ast);
            this.pushAttention(ast, AttentionKind.block);
          },
        },
        // コメント
        {
          exp: [/SingleLineCommentTrivia$/, /MultiLineCommentTrivia$/],
          match: () => {
            const ast = this.stack.last();
            this.comments.push(ast);
            this.pushAttention(ast, AttentionKind.comment);
          },
        },
      ]);
      // this.debugLog(node);
      next = this.next();
      if (next.level < node.level) {
        this.stack.splice(next.level + 1);
        this.prev();
        break;
      }
      if (node.level < next.level) {
        this.traverse(next);
        next = this.next();
      }
      this.stack.pop();
      this.stack.push(next);
      node = next;
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

    console.log(`# ${sourcePath}, ${sourcePathWithBase}, ---------`);
    console.log('');

    console.log('## imports');
    const imports = cachedFiles
      .filter((file) => file.source === sourcePath)
      .map((file) => file.imports)
      .flat();
    console.log(imports);

    const lineInfo: AstNode[] = [];
    scanAllChildren(lineInfo, sourceFile, -1);

    const parser = new Parser(lineInfo);

    const topNode = parser.next();
    parser.traverse(topNode);

    console.log('## attentions');
    const attentions = parser.attentions.sort((a, b) => a.line - b.line);
    console.log(
      JSON.stringify(
        attentions.map((c) => `${getText(c)}`),
        null,
        '  '
      )
    );

    // console.log('## arrow functions');
    // console.log(
    //   JSON.stringify(
    //     parser.arrowFunctions.map(
    //       (ast) =>
    //         `${getText(ast.identifier)}, ${getText(
    //           ast.returnStatement?.identifier
    //         )}, [${ast.components?.map((c) => getText(c)).join(',') || ''}]`
    //     ),
    //     null,
    //     '  '
    //   )
    // );

    // console.log('## functions');
    // console.log(
    //   JSON.stringify(
    //     parser.functions.map(
    //       (ast) =>
    //         `${getText(ast.identifier)}, ${getText(
    //           ast.returnStatement?.identifier
    //         )}, [${ast.components?.map((c) => getText(c)).join(',') || ''}]`
    //     ),
    //     null,
    //     '  '
    //   )
    // );

    // console.log('## components');
    // console.log(
    //   JSON.stringify(
    //     parser.components?.map((c) => `${getText(c)}`),
    //     null,
    //     '  '
    //   )
    // );

    // console.log('## comments');
    // console.log(
    //   JSON.stringify(
    //     parser.comments?.map((c) => getText(c)),
    //     null,
    //     '  '
    //   )
    // );

    // console.log('## blocks');
    // console.log(
    //   JSON.stringify(
    //     parser.blocks?.map((c) => `${getText(c)}`),
    //     null,
    //     '  '
    //   )
    // );

    console.log('');
    console.log('');
  });
}

if (require.main === module) {
  main(process.argv);
}
