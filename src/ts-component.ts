#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { scanAsync, findFile } from 'ts-scan';
import { scanAllChildren, AstInfo } from 'ts-parser';
import * as CSV from 'libs/csv-parser';
import { CSVItem } from 'libs/csv-parser';

enum AttentionKind {
  none,
  import,
  arrow,
  arrowVariable,
  export,
  paren,
  function,
  functionCall,
  variable,
  component,
  comment,
  property,
  object,
  objectProperty,
  block,
}

interface AstNode extends AstInfo {
  identifier?: AstNode;
  returnStatement?: AstNode;
  children?: AstNode[];
  path?: string;
  attention?: AttentionKind;
  note?: string;
  syntax: {
    export: boolean;
  };
}

const initAstNode = (n: AstNode) => {
  n.syntax = { export: false };
};

interface AstRegExp {
  exp: RegExp | RegExp[] | [any, RegExp][];
  options?: any[];
  match?: (option: any, reg?: AstRegExp) => void;
}

const indent = (level: number) => new Array(level).fill('  ').join('');

const trimQuat = (str: string) => {
  const t = str.match(/^['"](.+)['"]$/);
  if (t) return t[1];
  return str;
};

class AstStack extends Array<AstNode> {
  replace(ast: AstNode) {
    this.pop();
    this.push(ast);
  }
  last(offset: number = 0) {
    return this[this.length - 1 + offset];
  }
  indexFromLast(kind: string | string[], hook?: (index: number) => void) {
    for (let i = this.length - 2; i >= 0; i--) {
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
    const test = (reg: AstRegExp, exp: RegExp | RegExp[] | [any, RegExp][]) => {
      // exp が配列の場合
      if (Array.isArray(exp)) {
        return exp.some((e, i) => {
          if (Array.isArray(e)) {
            const result = e[1].test(path);
            if (result && reg.match) reg.match(e[0], reg);
            return result;
          } else {
            const result = e.test(path);
            if (result && reg.match) reg.match(reg.options?.[i], reg);
            return result;
          }
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
      node.attention === AttentionKind.arrowVariable
      // node.attention === AttentionKind.variable ||
      // node.attention === AttentionKind.function
    ) {
      return getText(node.identifier, node.attention);
    }
    const kindStr =
      AttentionKind[kind === AttentionKind.none ? node.attention || 0 : kind];
    const textStr =
      node.attention === AttentionKind.comment ||
      node.attention === AttentionKind.import ||
      node.attention === AttentionKind.export
        ? node.text
        : node.text.replace(/[ \n]/g, '');
    return `${node.line} ${kindStr}: ${textStr} #${node.note || ''}, !${
      node.syntax.export ? 'export' : 'intarnal'
    }`;
  }
  return '';
}

class ExportCSV {
  level: number = 0;
  getCsv(node: AstNode | undefined, kind = AttentionKind.none): CSVItem[] {
    if (node) {
      if (
        node.attention === AttentionKind.arrowVariable
        // node.attention === AttentionKind.variable ||
        // node.attention === AttentionKind.function
      ) {
        return this.getCsv(node.identifier, node.attention);
      }
      const kindStr =
        AttentionKind[kind === AttentionKind.none ? node.attention || 0 : kind];
      const textStr = (node: AstNode) => {
        const note = node.note || '';
        if (node.attention === AttentionKind.import) {
          return `${
            node.children ? node.children?.map((v) => v.text).join(' ') : ''
          }`;
        }
        const r =
          node.attention === AttentionKind.comment ||
          node.attention === AttentionKind.export
            ? node.text
            : node.text.replace(/[ \n]/g, '');
        if (note.indexOf('fragment') < 0) {
          if (note === 'jsx-close') {
            return `</${r}>`;
          }
          if (note.indexOf('jsx-self') === 0) {
            return `<${r} />`;
          }
          if (note.indexOf('jsx-open') === 0) {
            return `<${r}>`;
          }
        }
        return r;
      };
      const getIndentCell = (level: number) => {
        return new Array(level < 0 ? 0 : level).fill('  ').join('');
      };
      const note = node.note || '';
      if (note.indexOf('open') >= 0) this.level++;
      const returnStatement = node.returnStatement;
      const returnComponent = returnStatement ? textStr(returnStatement) : '';
      const getCsvCol = () => {
        if (kindStr === 'paren' || kindStr === 'block' || kindStr === 'arrow') {
          return [];
        } else {
          return [
            { value: `` },
            { value: `${node.line}` },
            {
              value: `${kindStr}${returnComponent !== '' ? '-component' : ''}`,
            },
            { value: `${getIndentCell(this.level)}${textStr(node)}` },
            { value: node.syntax.export ? 'export' : '' },
            { value: node.path || note },
          ];
        }
      };
      const retval = getCsvCol();
      if (note.indexOf('close') >= 0) this.level--;
      return retval;
    }
    return [];
  }
}

interface ParserOption {
  debug?: boolean;
  baseDir: string;
  srcPath: string;
}
class Parser {
  _ptr = 0;
  _info: AstNode[];
  _options: ParserOption;
  constructor(info: AstNode[], options: ParserOption) {
    this._info = info;
    this._options = options;
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
      m.kind === 'ExportKeyword' ||
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

  toAbsolutePath = (p: string) => {
    const { srcPath, baseDir } = this._options;
    const r = findFile(path.dirname(srcPath), baseDir, p);
    if (r === undefined) return p;
    return r;
  };

  attentions: AstNode[] = [];

  traverse = (_node: AstNode) => {
    this.stack.push(_node);
    let node = _node;
    let next = _node;
    const isExport = (offset: number, kind?: string) => {
      const node = this.stack.last(offset);
      if (node && node.syntax.export === true) {
        if (kind) {
          if (node.kind === kind) return node;
        } else {
          return node;
        }
      }
      return null;
    };
    while (!this.isEnd()) {
      this.stack.match([
        // import 定義
        {
          exp: [/ImportDeclaration$/],
          match: () => {
            const ast = this.stack.last();
            this.pushAttention(ast, AttentionKind.import);
          },
        },
        // import ID
        {
          exp: [
            /ImportDeclaration\/ImportClause\/Identifier$/,
            /ImportDeclaration\/ImportClause\/NamespaceImport\/Identifier$/,
            /ImportDeclaration\/ImportClause\/NamedImports\/SyntaxList\/ImportSpecifier\/Identifier$/,
          ],
          match: () => {
            const ast = this.stack.last();
            this.stack.findFromLast(['ImportDeclaration'], (node: AstNode) => {
              if (!node.children) node.children = [];
              node.children?.push(ast);
            });
          },
        },
        // import パス
        {
          exp: [/ImportDeclaration\/StringLiteral$/],
          match: () => {
            const ast = this.stack.last();
            this.stack.findFromLast(['ImportDeclaration'], (node: AstNode) => {
              // if (!node.children) node.children = [];
              node.path = `${this.toAbsolutePath(trimQuat(ast.text))}`;
              // node.children?.push(ast);
            });
          },
        },
        // 変数を特定
        {
          exp: /VariableDeclaration\/Identifier$/,
          match: () => {
            const ast = this.stack.last();
            if (isExport(-4, 'VariableStatement')) {
              ast.syntax.export = true;
            }
            this.pushAttention(ast, AttentionKind.variable);
            this.stack.findFromLast(
              ['VariableDeclaration'],
              (node: AstNode) => {
                node.identifier = ast;
              }
            );
          },
        },
        //
        // 関数名を特定
        {
          exp: /FunctionDeclaration\/Identifier$/,
          match: () => {
            const ast = this.stack.last();
            if (isExport(-1)) {
              ast.syntax.export = true;
            }
            this.pushAttention(ast, AttentionKind.function);
            this.stack.findFromLast(
              ['FunctionDeclaration'],
              (node: AstNode) => {
                node.identifier = ast;
              }
            );
          },
        },
        // 関数呼び出し
        {
          exp: /CallExpression\/Identifier$/,
          match: () => {
            const ast = this.stack.last();
            this.pushAttention(ast, AttentionKind.functionCall);
          },
        },
        // コンポーネントが戻り値になっている関数を特定
        {
          exp: [
            [
              'jsx-open-return',
              /ReturnStatement\/ParenthesizedExpression\/JsxElement\/JsxOpeningElement\/Identifier$/,
            ],
            [
              'jsx-self-return',
              /ReturnStatement\/ParenthesizedExpression\/JsxSelfClosingElement\/Identifier$/,
            ],
            [
              'jsx-open-return-fragment',
              /ReturnStatement\/ParenthesizedExpression\/JsxFragment\/JsxOpeningFragment$/,
            ],
            [
              'jsx-open-return',
              /ReturnStatement\/JsxElement\/JsxOpeningElement\/Identifier$/,
            ],
            [
              'jsx-self-return',
              /ReturnStatement\/JsxSelfClosingElement\/Identifier$/,
            ],
            [
              'jsx-open-return-fragment',
              /ReturnStatement\/JsxFragment\/JsxOpeningFragment$/,
            ],
            [
              'jsx-open-return',
              /ReturnStatement\/JsxSelfClosingElement\/Identifier$/,
            ],
          ],
          match: (option) => {
            const ast = this.stack.last();
            ast.note = option;
            this.pushAttention(ast, AttentionKind.component);
            this.stack.findFromLast(
              ['FunctionDeclaration', 'VariableDeclaration'],
              (node: AstNode) => {
                if (node.identifier) {
                  node.identifier.returnStatement = ast;
                }
              }
            );
          },
        },
        // コンポーネントが戻り値になっているアロー関数を特定
        {
          exp: [
            [
              [-4, 'jsx-open-return'],
              /VariableDeclaration\/ArrowFunction\/ParenthesizedExpression\/JsxElement\/JsxOpeningElement$/,
            ],
            [
              [-4, 'jsx-self-return'],
              /VariableDeclaration\/ArrowFunction\/ParenthesizedExpression\/JsxElement\/JsxSelfClosingElement$/,
            ],
            [
              [-4, 'jsx-open-return-fragment'],
              /VariableDeclaration\/ArrowFunction\/ParenthesizedExpression\/JsxFragment\/JsxOpeningFragment$/,
            ],
            [
              [-3, 'jsx-open-return'],
              /VariableDeclaration\/ArrowFunction\/JsxElement\/JsxOpeningElement$/,
            ],
            [
              [-3, 'jsx-self-return'],
              /VariableDeclaration\/ArrowFunction\/JsxElement\/JsxSelfClosingElement$/,
            ],
            [
              [-3, 'jsx-open-return-fragment'],
              /VariableDeclaration\/ArrowFunction\/JsxFragment\/JsxOpeningFragment$/,
            ],
            [
              [-2, 'jsx-open-return'],
              /VariableDeclaration\/ArrowFunction\/JsxOpeningElement$/,
            ],
            [
              [-2, 'jsx-self-return'],
              /VariableDeclaration\/ArrowFunction\/JsxSelfClosingElement$/,
            ],
            [
              [-2, 'jsx-open-return-fragment'],
              /VariableDeclaration\/ArrowFunction\/JsxOpeningFragment$/,
            ],
          ],
          match: (option) => {
            const ast = this.stack.last();
            ast.note = option[1];
            if (option[1].indexOf('fragment') >= 0) {
              this.pushAttention(ast, AttentionKind.component);
            }
            const node = this.stack.last(option[0]);
            if (node.identifier) {
              node.identifier.returnStatement = ast;
            }
          },
        },
        // 関数で使用しているコンポーネント
        {
          exp: [
            /JsxOpeningElement\/Identifier$/,
            /JsxOpeningElement\/PropertyAccessExpression\/Identifier$/,
            /JsxOpeningElement\/PropertyAccessExpression\/DotToken$/,
            /JsxSelfClosingElement\/Identifier$/,
            /JsxSelfClosingElement\/PropertyAccessExpression\/Identifier$/,
            /JsxClosingElement\/Identifier$/,
            /JsxClosingElement\/PropertyAccessExpression\/Identifier$/,
            /JsxFragment\/JsxClosingFragment$/,
          ],
          options: [
            'jsx-open',
            'jsx-open-prop',
            'jsx-dot-prop',
            'jsx-self',
            'jsx-self-prop',
            'jsx-close',
            'jsx-close-prop',
            'jsx-close-fragment',
          ],
          match: (option) => {
            const ast = this.stack.last();
            ast.note = option;
            if (option.indexOf('prop') >= 0) {
              this.stack.findFromLast(
                ['PropertyAccessExpression'],
                (node: AstNode) => {
                  node.text += ast.text;
                }
              );
            } else {
              this.stack.findFromLast(
                ['FunctionDeclaration', 'VariableDeclaration'],
                (node: AstNode) => {
                  // if (!node.children) node.children = [];
                  // node.children?.push(ast);
                  this.pushAttention(ast, AttentionKind.component);
                }
              );
            }
          },
        },
        // プロパティ
        {
          exp: [
            ['jsx-open', /JsxOpeningElement\/PropertyAccessExpression$/],
            ['jsx-close', /JsxClosingElement\/PropertyAccessExpression$/],
            ['prop', /PropertyAccessExpression$/],
            ['word', /PropertyAccessExpression\/Identifier$/],
            ['word', /PropertyAccessExpression\/DotToken$/],
          ],
          match: (option) => {
            const ast = this.stack.last();
            if (option === 'word') {
              this.stack.findFromLast(
                ['PropertyAccessExpression'],
                (node: AstNode) => {
                  node.text += ast.text;
                }
              );
            } else {
              ast.text = '';
              this.stack.match({
                exp: [/PropertyAccessExpression\/PropertyAccessExpression$/],
                match: (option) => {
                  // const node = this.stack.last(-1);
                  // if (!node.children) node.children = [];
                  // node.children?.push(ast);
                },
              });
              if (option.indexOf('jsx') >= 0) {
                ast.note = option;
                this.pushAttention(ast, AttentionKind.component);
              } else {
                this.pushAttention(ast, AttentionKind.property);
              }
            }
          },
        },
        // アロー関数
        {
          exp: [
            ['open', /ArrowFunction\/OpenParenToken$/],
            ['close', /ArrowFunction\/CloseParenToken$/],
            ['open', /CallExpression\/OpenParenToken$/],
            ['close', /CallExpression\/CloseParenToken$/],
            ['arrow', /ArrowFunction\/EqualsGreaterThanToken$/],
            ['open', /ArrowFunction\/OpenParenToken\/Block\/OpenBraceToken$/],
            ['close', /ArrowFunction\/OpenParenToken\/Block\/CloseBraceToken$/],
            ['open', /ArrowFunction\/(.+?)Expression\/OpenParenToken$/],
            ['close', /ArrowFunction\/(.+?)Expression\/CloseParenToken$/],
          ],
          match: (option) => {
            const ast = this.stack.last();
            this.stack.match({
              exp: [
                [-2, /VariableDeclaration\/ArrowFunction\/OpenParenToken$/],
                [
                  -3,
                  /VariableDeclaration\/ArrowFunction\/ParenthesizedExpression\/OpenBraceToken$/,
                ],
              ],
              match: (option) => {
                const variableAst = this.stack.last(option);
                if (isExport(option - 3)) {
                  if (variableAst.identifier)
                    variableAst.identifier.syntax.export = true;
                }
                variableAst.attention = AttentionKind.arrowVariable;
              },
            });
            ast.note = option;
            if (option === 'arrow') {
              this.pushAttention(ast, AttentionKind.arrow);
            } else {
              this.pushAttention(ast, AttentionKind.paren);
            }
          },
        },
        // オブジェクト
        {
          exp: [
            ['object-open', /ObjectLiteralExpression\/OpenBraceToken$/],
            ['object-close', /ObjectLiteralExpression\/CloseBraceToken$/],
          ],
          match: (option) => {
            const ast = this.stack.last();
            ast.note = option;
            this.pushAttention(ast, AttentionKind.object);
          },
        },
        // オブジェクトプロパティ
        {
          exp: [/PropertyAssignment\/Identifier$/],
          match: (option) => {
            const ast = this.stack.last();
            ast.note = 'object-prop';
            this.pushAttention(ast, AttentionKind.objectProperty);
          },
        },
        // エキスポート
        {
          exp: [
            [-3, /SyntaxList\/ExportKeyword$/],
            [-2, /SyntaxList\/ExportAssignment\/ExportKeyword$/],
          ],
          match: (option) => {
            const ast = this.stack.last();
            {
              const ast = this.stack.last(option);
              this.stack
                .slice(option)
                .forEach((node) => (node.syntax.export = true));
            }
            node.syntax = { export: true };
            ast.note = 'export';
            // this.pushAttention(ast, AttentionKind.export);
          },
        },
        // ブロック
        {
          exp: [
            ['open', /Block\/OpenBraceToken$/],
            ['close', /Block\/CloseBraceToken$/],
          ],
          match: (option) => {
            const ast = this.stack.last();
            ast.note = option;
            this.pushAttention(ast, AttentionKind.block);
          },
        },
        // コメント
        {
          exp: [/SingleLineCommentTrivia$/, /MultiLineCommentTrivia$/],
          match: () => {
            const ast = this.stack.last();
            this.pushAttention(ast, AttentionKind.comment);
          },
        },
      ]);
      if (this._options.debug) {
        this.debugLog(node);
      }
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
    .option('mode', {
      choices: ['log', 'csv'],
      default: 'csv',
      describe: 'Select output format',
    })
    .option('debug', { type: 'boolean' })
    .option('source', { type: 'string', demandOption: true })
    .help()
    .parseSync();

  const baseDir = `${arg.base}`;
  const srcPath = `${arg.source}`;
  const importedFiles = await scanAsync(srcPath, baseDir);

  const result = new Set(importedFiles.map((file) => file.source));
  new Array(...result).forEach((sourcePath) => {
    const sourcePathWithBase = path.join(baseDir, sourcePath);
    const sourceCode = fs.readFileSync(sourcePathWithBase, 'utf-8').trim();

    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceCode,
      ts.ScriptTarget.ES5,
      true
    );

    const lineInfo: AstNode[] = [];
    scanAllChildren(lineInfo, sourceFile, -1);

    lineInfo.forEach((n) => initAstNode(n));

    const parser = new Parser(lineInfo, { debug: arg.debug, srcPath, baseDir });

    const topNode = parser.next();
    parser.traverse(topNode);

    const attentions = parser.attentions.sort((a, b) => a.line - b.line);

    if (arg.mode === 'csv') {
      console.log(`${sourcePath}, ${sourcePathWithBase}`);
      const csvExport = new ExportCSV();
      const csvData = attentions
        .map((c) => csvExport.getCsv(c, 0))
        .filter((v) => v.length > 0);
      console.log(CSV.stringify(csvData));
      console.log('');
    } else {
      console.log(`# ${sourcePath}, ${sourcePathWithBase}, ---------`);
      console.log('');

      console.log('## imports');
      const imports = importedFiles
        .filter((file) => file.source === sourcePath)
        .map((file) => file.imports)
        .flat();
      console.log(imports);

      console.log('## attentions');
      console.log(
        JSON.stringify(
          attentions.map((c) => `${getText(c)}`),
          null,
          '  '
        )
      );
    }
  });
}

if (require.main === module) {
  main(process.argv);
}
