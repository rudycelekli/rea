import * as t from "@babel/types";
import { symbolicDefiniteExit } from "./javascriptSymbolicControlFlow.js";

/** Syntax alone can establish an exit, but never a branch's contextual truth. */
export type ElectronStatementFallthrough =
  | { readonly kind: "exit" }
  | {
      readonly kind: "branch";
      readonly test: t.Expression;
      readonly consequentExits: boolean;
      readonly alternateExits: boolean;
    };

interface PrefixEntry {
  readonly position: number;
  readonly fact: ElectronStatementFallthrough;
}

interface BlockIndex {
  readonly positions: WeakMap<t.Node, number>;
  readonly entries: readonly PrefixEntry[];
}

/**
 * One collector's immutable syntax facts. Positions replace repeated body
 * searches; ordinary fallthrough statements need no replay. Conditional tests
 * remain present even when neither branch exits, since evaluating them belongs
 * to the invocation's symbolic environment and can establish unknown coverage.
 */
export class ElectronCallPathBlockPrefixes {
  readonly #blocks = new WeakMap<t.BlockStatement, BlockIndex>();
  readonly #facts = new WeakMap<
    t.Statement,
    ElectronStatementFallthrough | null
  >();

  constructor(
    private readonly admitVisit: () => boolean,
    private readonly parents?: Readonly<WeakMap<t.Node, t.Node>>,
  ) {}

  statement(statement: t.Statement): ElectronStatementFallthrough | null {
    const cached = this.#facts.get(statement);
    if (cached !== undefined) return cached;
    // Only labels enclosing this predecessor exit the block whose continuation
    // we are projecting. A break consumed inside the predecessor still falls
    // through to its following sibling.
    const breakLabels = new Set<string>();
    for (
      let parent = this.parents?.get(statement);
      parent !== undefined && !t.isFunction(parent);
      parent = this.parents?.get(parent)
    ) {
      if (t.isLabeledStatement(parent)) breakLabels.add(parent.label.name);
    }
    const fact: ElectronStatementFallthrough | null = symbolicDefiniteExit(
      statement,
      0,
      breakLabels,
    )
      ? { kind: "exit" }
      : t.isIfStatement(statement)
        ? {
            kind: "branch",
            test: statement.test,
            consequentExits: symbolicDefiniteExit(
              statement.consequent,
              0,
              breakLabels,
            ),
            alternateExits: symbolicDefiniteExit(
              statement.alternate,
              0,
              breakLabels,
            ),
          }
        : null;
    this.#facts.set(statement, fact);
    return fact;
  }

  *before(
    block: t.BlockStatement,
    child: t.Node,
  ): Generator<
    void,
    | { readonly entries: readonly PrefixEntry[]; readonly before: number }
    | undefined
  > {
    let index = this.#blocks.get(block);
    if (index === undefined) {
      const positions = new WeakMap<t.Node, number>();
      const entries: PrefixEntry[] = [];
      for (const [position, statement] of block.body.entries()) {
        if (!this.admitVisit()) return undefined;
        positions.set(statement, position);
        const fact = this.statement(statement);
        if (fact !== null) entries.push({ position, fact });
        if ((position + 1) % 1024 === 0) yield;
      }
      index = { positions, entries };
      this.#blocks.set(block, index);
    }
    const before = index.positions.get(child);
    return before === undefined
      ? undefined
      : { entries: index.entries, before };
  }
}
