import fs from 'fs';
import * as ts from 'typescript';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

export type AstInfo = {
  element: boolean;
  level: number;
  kind: string;
  line: number;
  endl: number;
  pos: number;
  end: number;
  text: string;
  tsNode: ts.Node;
  hasNodes: boolean;
};

const indent = (level: number) => new Array(level).fill('  ').join('');

export function scanAllChildren(
  result: AstInfo[],
  node: ts.Node,
  pos: number,
  depth = 0
) {
  const startLine = ts.getLineAndCharacterOfPosition(
    node.getSourceFile(),
    node.pos
  );
  if (node.pos !== pos && node.getLeadingTriviaWidth() > 0) {
    const trivias = ts.getLeadingCommentRanges(node.getFullText(), 0);
    trivias?.forEach((trivia) => {
      const text = node.getFullText().substring(trivia.pos, trivia.end);
      const commentStartLine = ts.getLineAndCharacterOfPosition(
        node.getSourceFile(),
        node.pos + trivia.pos
      );
      const commentEndLine = ts.getLineAndCharacterOfPosition(
        node.getSourceFile(),
        node.pos + trivia.pos + text.length
      );
      result.push({
        element: true,
        level: depth,
        kind: ts.Debug.formatSyntaxKind(trivia.kind),
        line: commentStartLine.line,
        endl: commentEndLine.line,
        pos: trivia.pos + node.pos,
        end: trivia.end + node.pos,
        tsNode: node,
        text,
        hasNodes: false,
        // node,
      });
    });
  }
  const text = node.getText();
  const nextStartLine = ts.getLineAndCharacterOfPosition(
    node.getSourceFile(),
    node.pos + node.getLeadingTriviaWidth()
  );
  const nextEndLine = ts.getLineAndCharacterOfPosition(
    node.getSourceFile(),
    node.pos + node.getLeadingTriviaWidth() + text.length
  );
  const kind = ts.Debug.formatSyntaxKind(node.kind);
  const childrend = node.getChildren();
  result.push({
    element: childrend.length == 0,
    level: depth,
    kind,
    line: nextStartLine.line,
    endl: nextEndLine.line,
    pos: node.pos + node.getLeadingTriviaWidth(),
    end: node.end,
    tsNode: node,
    text,
    hasNodes: childrend.length > 0,
    // node,
  });
  if (kind === 'JSDocComment') return;
  depth++;
  childrend.forEach((c) => scanAllChildren(result, c, node.pos, depth));
}

class TreeParser {
  constructor(private nodes: AstInfo[]) {
    //
  }

  nextFunction = (i: number) => {
    const nodes = this.nodes;
    const node = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const tnode = nodes[j];
      if (tnode.level <= node.level) {
        return j;
      }
    }
    return nodes.length;
  };

  prevFind = (i: number, kind: string) => {
    const nodes = this.nodes;
    const node = nodes[i];
    for (let j = i - 1; j >= 0; j--) {
      const tnode = nodes[j];
      if (tnode.level < node.level) return -1;
      if (tnode.kind.indexOf(kind) === 0) return j;
    }
    return 0;
  };

  nextFind = (i: number, kind: string | string[]) => {
    const nodes = this.nodes;
    const findCore = (i: number, kind: string) => {
      const node = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const tnode = nodes[j];
        if (tnode.level < node.level) return -1;
        if (nodes[j].kind.indexOf(kind) === 0) return j;
      }
      return -1;
    };
    if (Array.isArray(kind)) {
      for (let j = 0; j < kind.length; j++) {
        i = findCore(i, kind[j]);
        if (i < 0) return -1;
      }
      return i;
    }
    return findCore(i, kind);
  };
}

export function scanJsxFunctions(result: AstInfo[]) {
  const tree = new TreeParser(result);
  for (let i = 0; i < result.length; i++) {
    const node = result[i];
    if (node.kind === 'FunctionDeclaration') {
      const f = tree.nextFind(i, 'FunctionKeyword');
      const e = tree.nextFind(i, 'ExportKeyword');
      const t = tree.nextFind(i, 'Identifier');
      if (tree.nextFind(t, 'JsxElement') >= 0) {
        console.log(`${e >= 0 ? 'export ' : ''}${result[t].text}`);
      }
      i = tree.nextFunction(i);
    }
    if (node.kind === 'VariableStatement') {
      const a = tree.nextFind(i, 'ArrowFunction');
      if (a >= 0) {
        const e = tree.nextFind(i, ['SyntaxList', 'ExportKeyword']);
        const t = tree.prevFind(a, 'Identifier');
        if (t >= 0) {
          if (
            tree.nextFind(t, 'JsxElement') >= 0 ||
            tree.nextFind(t, 'JsxSelfClosingElement') >= 0
          ) {
            console.log(`${e >= 0 ? 'export ' : ''}${result[t].text}`);
          }
        }
        i = tree.nextFunction(a);
      }
    }
  }
}

type ScanNode = {
  level: number;
  export?: string;
  kind: string;
  name?: string;
};

export function scanJsxElements(nodes: AstInfo[]) {
  const result: ScanNode[] = [];
  const tree = new TreeParser(nodes);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.kind === 'ReturnStatement') {
      result.push({
        level: node.level,
        kind: node.kind,
      });
    } else if (node.kind === 'FunctionDeclaration') {
      const exp = `${tree.nextFind(i, 'ExportKeyword') >= 0 ? 'export ' : ''}`;
      const t = tree.nextFind(i, 'Identifier');
      result.push({
        level: node.level,
        export: exp,
        kind: node.kind,
        name: nodes[t].text,
      });
    } else if (node.kind === 'VariableStatement') {
      const exp = `${
        tree.nextFind(i, ['SyntaxList', 'ExportKeyword']) >= 0 ? 'export ' : ''
      }`;
      const a = tree.nextFind(i, 'ArrowFunction');
      if (a >= 0) {
        const t = tree.prevFind(a, 'Identifier');
        if (t >= 0) {
          result.push({
            level: node.level,
            export: exp,
            kind: nodes[a].kind,
            name: nodes[t].text,
          });
        } else {
          result.push({
            level: node.level,
            export: exp,
            kind: nodes[a].kind,
          });
        }
      }
    } else if (node.kind === 'JsxElement') {
      const n = tree.nextFind(i, ['JsxOpeningElement', 'Identifier']);
      if (n >= 0) {
        result.push({
          level: node.level,
          kind: node.kind,
          name: nodes[n].text,
        });
      } else {
        result.push({
          level: node.level,
          kind: node.kind,
        });
      }
    } else if (node.kind === 'JsxSelfClosingElement') {
      const n = tree.nextFind(i, ['Identifier']);
      if (n >= 0) {
        result.push({
          level: node.level,
          kind: node.kind,
          name: nodes[n].text,
        });
      } else {
        result.push({
          level: node.level,
          kind: node.kind,
        });
      }
    }
  }
  {
    let level: number[] = [];
    return result.map((node) => {
      if (level.length === 0) level.push(node.level);
      while (true) {
        if (level[level.length - 1] < node.level) {
          level.push(node.level);
        } else if (level[level.length - 1] > node.level) {
          level.pop();
        } else {
          break;
        }
      }
      node.level = level.indexOf(node.level);
      return node;
    });
  }
}

async function main(arg: string[]) {
  const argv = yargs(hideBin(arg))
    .detectLocale(false)
    .scriptName('ts-parser')
    .usage('$0 [options] <source>', 'Parse a typescript source.')
    .options({
      source: { type: 'string', demandOption: true },
      mode: {
        choices: [
          'src',
          'tree',
          'json',
          'element',
          'jsx-component',
          'jsx-element',
        ],
        default: 'tree',
        describe: 'output type',
        demandOption: true,
      },
    })
    .help()
    .parseSync();

  const sourcePath = `${argv.source}`;

  const sourceCode = fs.readFileSync(sourcePath, 'utf-8').trim();

  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceCode,
    ts.ScriptTarget.ES5,
    true
  );

  const result: AstInfo[] = [];
  scanAllChildren(result, sourceFile, -1);

  // ソース再生成
  if (argv.mode === 'src') {
    let line = 0;
    let pre = -1;
    let pos = 0;
    let kind: ReturnType<typeof ts.Debug.formatSyntaxKind> = 'SourceFile';
    result.forEach((node) => {
      if (node.element) {
        if (node.line !== line) {
          for (let i = 0; i < node.line - line; i++) {
            console.log('');
          }
          pos = node.pos;
        }
        if (pos !== node.pos) {
          for (let i = 0; i < node.pos - pos; i++) {
            process.stdout.write(' ');
          }
        }
        if (pre <= node.pos) {
          process.stdout.write(node.text);
        }
        line = node.endl;
        pos = node.end;
        kind = node.kind;
        pre = pos;
      }
    });
  }

  // JSON形式
  if (argv.mode === 'json') {
    console.log(JSON.stringify(result, null, '  '));
  }

  // JSON形式(elementのみ)
  if (argv.mode === 'element') {
    console.log(
      JSON.stringify(
        result.filter((v) => v.element),
        null,
        '  '
      )
    );
  }

  // TREE形式
  if (argv.mode === 'tree') {
    console.log(`### ${sourcePath}`);
    result.forEach((node) => {
      if (node.kind.match(/Trivia$/)) {
        console.log(
          `${indent(node.level)}${node.kind} ${
            node.hasNodes ? '' : node.text.replace(/\n/g, '\\n')
          }`
        );
      } else if (node.kind.match(/JsxElement/)) {
        console.log(`${indent(node.level)}${node.kind} ${node.text}`);
      } else {
        console.log(
          `${indent(node.level)}${node.kind} ${node.hasNodes ? '' : node.text}`
        );
      }
    });
  }

  // Reactコンポーネント
  if (argv.mode === 'jsx-component') {
    console.log(`### ${sourcePath}`);
    scanJsxFunctions(result);
  }

  // JSXエレメント
  if (argv.mode === 'jsx-element') {
    console.log(`### ${sourcePath}`);
    const retval = scanJsxElements(result);
    // console.log(JSON.stringify(retval, null, '  '));
    retval.forEach((node) =>
      console.log(
        `${indent(node.level)}${node.kind} ${
          node.name !== undefined ? `"${node.name}"` : ''
        }`
      )
    );
  }
}

if (require.main === module) {
  main(process.argv);
}
