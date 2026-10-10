import { parse } from "@babel/parser";
import type {
  CallExpression,
  ImportExpression,
  Node,
  StringLiteral,
} from "@babel/types";
import { traverseJavaScriptAst } from "./javascript/javascriptSemanticTraversal.js";
import { analyzeParsedJavaScriptReferences } from "./javascript/javascriptSemanticAnalysis.js";
import {
  parserPluginsForPath,
  type ParsedJavaScriptSource,
} from "./javascript/javascriptSourceParser.js";
import {
  isCallExpression,
  isExportAllDeclaration,
  isExportNamedDeclaration,
  isIdentifier,
  isImport,
  isImportDeclaration,
  isImportExpression,
  isMemberExpression,
  isStringLiteral,
  isTSExternalModuleReference,
  isTSImportEqualsDeclaration,
  isTSModuleDeclaration,
} from "@babel/types";

type ReferenceSourceImportKind =
  | "imports"
  | "requires"
  | "references"
  | "declares-module";

type ReferenceSourceImportResolution =
  | "internal"
  | "external"
  | "unresolved"
  | "unknown";

type ReferenceSourceImportParseState = "parsed" | "partial" | "unknown";

interface ReferenceSourceImportRelationship {
  readonly from_path: string;
  readonly to: string;
  readonly kind: ReferenceSourceImportKind;
  readonly resolution: ReferenceSourceImportResolution;
  readonly parse_state: ReferenceSourceImportParseState;
}

interface ReferenceSourceParseFailure {
  readonly path: string;
  readonly parser: string;
  readonly reason: string;
}

export interface ReferenceSourceImportParseResult {
  readonly relationships: readonly ReferenceSourceImportRelationship[];
  readonly parse_failures: readonly ReferenceSourceParseFailure[];
}

const codeSourceLanguages = new Set(["JavaScript", "TypeScript", "JSX", "TSX"]);

const safeModuleName = (node: Node | null | undefined): string | undefined => {
  if (isStringLiteral(node)) return node.value;
  return undefined;
};

const resolveSpecifier = (
  specifier: string,
): ReferenceSourceImportResolution => {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return "internal";
  if (specifier.startsWith("node:") || specifier.startsWith("data:"))
    return "external";
  return "external";
};

const isModuleExpression = (
  expression: Node | null | undefined,
): expression is StringLiteral | CallExpression =>
  isStringLiteral(expression) || isCallExpression(expression);

const moduleSpecifierFromExpression = (
  expression: Node | null | undefined,
):
  | { specifier: string; parseState: ReferenceSourceImportParseState }
  | undefined => {
  if (isStringLiteral(expression))
    return { specifier: expression.value, parseState: "parsed" };
  if (
    isCallExpression(expression) &&
    isImport(expression.callee) &&
    expression.arguments.length > 0
  ) {
    const first = expression.arguments[0];
    if (isStringLiteral(first)) {
      return { specifier: first.value, parseState: "parsed" };
    }
    return { specifier: "<dynamic-import>", parseState: "partial" };
  }
  return undefined;
};

const appendRelationship = (
  relationships: ReferenceSourceImportRelationship[],
  input: {
    readonly fromPath: string;
    readonly to: string | undefined;
    readonly kind: ReferenceSourceImportKind;
    readonly parseState: ReferenceSourceImportParseState;
    readonly resolution?: ReferenceSourceImportResolution;
  },
): void => {
  if (input.to === undefined) return;
  relationships.push({
    from_path: input.fromPath,
    to: input.to,
    kind: input.kind,
    resolution: input.resolution ?? resolveSpecifier(input.to),
    parse_state: input.parseState,
  });
};

const extractImportDeclarations = (
  body: readonly Node[],
  from_path: string,
  relationships: ReferenceSourceImportRelationship[],
): void => {
  for (const statement of body) {
    if (isImportDeclaration(statement)) {
      appendRelationship(relationships, {
        fromPath: from_path,
        to: safeModuleName(statement.source),
        kind: "imports",
        parseState: "parsed",
      });
      continue;
    }

    if (isExportNamedDeclaration(statement)) {
      if (statement.source !== null && statement.source !== undefined) {
        appendRelationship(relationships, {
          fromPath: from_path,
          to: safeModuleName(statement.source),
          kind: "imports",
          parseState: "parsed",
        });
      }
      continue;
    }

    if (isExportAllDeclaration(statement)) {
      appendRelationship(relationships, {
        fromPath: from_path,
        to: safeModuleName(statement.source),
        kind: "imports",
        parseState: "parsed",
      });
      continue;
    }

    if (isTSImportEqualsDeclaration(statement)) {
      const reference = statement.moduleReference;
      if (isTSExternalModuleReference(reference)) {
        appendRelationship(relationships, {
          fromPath: from_path,
          to: safeModuleName(reference.expression),
          kind: "requires",
          parseState: "parsed",
        });
      }
      continue;
    }

    if (isTSModuleDeclaration(statement)) {
      if (statement.declare === true && isStringLiteral(statement.id)) {
        appendRelationship(relationships, {
          fromPath: from_path,
          to: statement.id.value,
          kind: "declares-module",
          parseState: "parsed",
          resolution: "unknown",
        });
      }
    }
  }
};

const isRequireCallee = (
  callee: Node | null | undefined,
  unboundRequireLocations: ReadonlySet<string>,
): boolean => {
  const identifier = isIdentifier(callee)
    ? callee
    : isMemberExpression(callee) && isIdentifier(callee.object)
      ? callee.object
      : undefined;
  if (
    identifier?.name !== "require" ||
    identifier.loc === null ||
    identifier.loc === undefined ||
    !unboundRequireLocations.has(
      `${String(identifier.loc.start.line)}:${String(identifier.loc.start.column)}`,
    )
  )
    return false;
  if (isIdentifier(callee)) return true;
  if (
    isMemberExpression(callee) &&
    isIdentifier(callee.object) &&
    callee.object.name === "require" &&
    ((!callee.computed && isIdentifier(callee.property)) ||
      isStringLiteral(callee.property))
  ) {
    const propertyName = isIdentifier(callee.property)
      ? callee.property.name
      : isStringLiteral(callee.property)
        ? callee.property.value
        : undefined;
    return propertyName === "resolve" || propertyName === "main";
  }
  return false;
};

const extractRequireAndDynamicImports = (
  ast: ParsedJavaScriptSource,
  from_path: string,
  relationships: ReferenceSourceImportRelationship[],
): void => {
  // Reuse the lexical-reference owner: a literal spelling is a CommonJS
  // dependency only when the callee is an unbound global, not a local binding
  // or an uncertain lookup through a dynamic scope.
  const unboundRequireLocations = new Set(
    analyzeParsedJavaScriptReferences(ast, "require")
      .filter((reference) => reference.resolution === "unbound")
      .map(
        ({ location }) =>
          `${String(location.start.line)}:${String(location.start.column)}`,
      ),
  );
  // Single traversal owner: iterative, VISITOR_KEYS-gated, no recursion over
  // loc/comment objects. Survives deeply nested generated member chains that
  // overflowed the previous hand-rolled Object.values walker.
  const expressions: Array<CallExpression | ImportExpression> = [];
  for (const statement of ast.program.body)
    traverseJavaScriptAst(statement, {
      enter: (node) => {
        if (isCallExpression(node) || isImportExpression(node))
          expressions.push(node);
      },
    });

  for (const call of expressions) {
    if (isImportExpression(call)) {
      const specifier = safeModuleName(call.source);
      appendRelationship(relationships, {
        fromPath: from_path,
        to: specifier ?? "<dynamic-import>",
        kind: "imports",
        parseState: specifier === undefined ? "partial" : "parsed",
        ...(specifier === undefined ? { resolution: "unknown" } : {}),
      });
      continue;
    }
    const first = call.arguments[0];
    if (
      isRequireCallee(call.callee, unboundRequireLocations) &&
      isModuleExpression(first)
    ) {
      const result = moduleSpecifierFromExpression(first);
      if (result !== undefined) {
        appendRelationship(relationships, {
          fromPath: from_path,
          to: result.specifier,
          kind: "requires",
          parseState: result.parseState,
        });
      }
      continue;
    }

    if (isImport(call.callee) && isModuleExpression(first)) {
      const result = moduleSpecifierFromExpression(first);
      if (result !== undefined) {
        appendRelationship(relationships, {
          fromPath: from_path,
          to: result.specifier,
          kind: "imports",
          parseState: result.parseState,
        });
      }
    }
  }
};

const parseWithBabel = (
  path: string,
  source: string,
  language: string | null,
): {
  ast: ParsedJavaScriptSource | undefined;
  reasons: readonly string[];
} => {
  // Single parser-mode owner: path-driven plugins (dts/JSX/mts) shared with
  // the semantic pipeline. `language` only gates non-JS/TS callers upstream;
  // TypeScript syntax must parse identically here and in semantic analysis.
  void language;
  const plugins = parserPluginsForPath(path);

  try {
    const ast = parse(source, {
      sourceType: "unambiguous",
      allowImportExportEverywhere: false,
      allowReturnOutsideFunction: true,
      allowUndeclaredExports: true,
      errorRecovery: true,
      plugins,
    });
    return { ast, reasons: ast.errors.map((error) => error.message) };
  } catch (cause: unknown) {
    return {
      ast: undefined,
      reasons: [cause instanceof Error ? cause.message : "Parse failed"],
    };
  }
};

/** Parse ESM/CommonJS imports and dynamic imports from source bytes. */
export const parseReferenceSourceImports = (
  path: string,
  bytes: Uint8Array,
  language: string | null,
): ReferenceSourceImportParseResult => {
  if (language !== null && !codeSourceLanguages.has(language))
    return { relationships: [], parse_failures: [] };

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      relationships: [],
      parse_failures: [
        {
          path,
          parser: "utf-8",
          reason:
            "Source bytes are not valid UTF-8; import targets were not parsed.",
        },
      ],
    };
  }
  const { ast, reasons } = parseWithBabel(path, source, language);
  const parseFailures = reasons.map((reason) => ({
    path,
    parser: "babel",
    reason,
  }));

  if (ast === undefined) {
    return {
      relationships: [],
      parse_failures: parseFailures,
    };
  }

  const relationships: ReferenceSourceImportRelationship[] = [];
  extractImportDeclarations(ast.program.body, path, relationships);
  extractRequireAndDynamicImports(ast, path, relationships);

  return {
    relationships: relationships.map((relationship) => ({
      ...relationship,
      parse_state:
        parseFailures.length > 0 && relationship.parse_state === "parsed"
          ? "partial"
          : relationship.parse_state,
    })),
    parse_failures: parseFailures,
  };
};
