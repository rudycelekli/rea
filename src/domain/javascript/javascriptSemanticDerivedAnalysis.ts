import * as t from "@babel/types";

import { collectJavaScriptSemanticAsyncEffects } from "./javascriptSemanticAsyncEffects.js";
import { collectJavaScriptSemanticCalls } from "./javascriptSemanticCalls.js";
import { collectJavaScriptSemanticChildProcesses } from "./javascriptSemanticChildProcesses.js";
import { collectJavaScriptSemanticFingerprintsSteps } from "./javascriptSemanticFingerprints.js";
import { collectJavaScriptSemanticDataEffects } from "./javascriptSemanticDataEffects.js";
import type {
  JavaScriptSemanticCallable,
  JavaScriptSemanticIr,
  JavaScriptSemanticReference,
} from "./javascriptSemanticIr.js";
import { collectJavaScriptSemanticPromises } from "./javascriptSemanticPromises.js";
import { collectJavaScriptSemanticObjects } from "./javascriptSemanticObjects.js";
import { collectJavaScriptSemanticResources } from "./javascriptSemanticResources.js";
import type { JavaScriptSemanticAnalysisState } from "./javascriptSemanticState.js";

import { createSemanticCallableIdStack } from "./javascriptSemanticCallableStack.js";
import { traverseJavaScriptValueAstSteps } from "./javascriptSemanticTraversal.js";
import { range } from "./javascriptStaticAnalysisHelpers.js";
import { unwrapJavaScriptExpression } from "./javascriptAstValues.js";

type DerivedSemanticAnalysis = Pick<
  JavaScriptSemanticIr,
  | "assignmentFlows"
  | "argumentFlows"
  | "callResultFlows"
  | "callReturnFlows"
  | "callSites"
  | "boundaryOperations"
  | "childProcessInteractions"
  | "childProcessSpawns"
  | "closureCaptures"
  | "configurationOperations"
  | "eventOperations"
  | "frontiers"
  | "functionFingerprints"
  | "objectOperations"
  | "promiseOperations"
  | "requestOperations"
  | "resourceOperations"
  | "timerOperations"
>;

/** Compose bounded semantic passes after lexical definitions are available. */
/**
 * Collect derived semantics with a yield between collectors. Each collector
 * completes before the next starts, so results equal the synchronous form.
 */
export function* collectJavaScriptDerivedSemanticsSteps(
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
  callables: readonly JavaScriptSemanticCallable[],
  references: readonly JavaScriptSemanticReference[],
  parserPartial: boolean,
): Generator<void, DerivedSemanticAnalysis> {
  const calls = collectJavaScriptSemanticCalls(program, state, callables);
  yield;
  const promiseOperations = collectJavaScriptSemanticPromises(
    program,
    state,
    callables,
  );
  yield;
  const asyncEffects = collectJavaScriptSemanticAsyncEffects(
    program,
    state,
    callables,
  );
  yield;
  const childProcesses = collectJavaScriptSemanticChildProcesses(
    program,
    state,
    callables,
  );
  yield;
  const dataEffects = collectJavaScriptSemanticDataEffects(
    program,
    state,
    callables,
  );
  yield;
  const resourceOperations = collectJavaScriptSemanticResources(
    program,
    state,
    callables,
  );
  yield;
  const objectOperations = collectJavaScriptSemanticObjects(
    program,
    state,
    callables,
  );
  yield;
  const assignmentFlows = yield* collectAssignmentFlowsSteps(
    program,
    state,
    callables,
  );
  const functionFingerprints =
    yield* collectJavaScriptSemanticFingerprintsSteps({
      state,
      callables,
      calls,
      promises: promiseOperations,
      events: asyncEffects.eventOperations,
      timers: asyncEffects.timerOperations,
      childProcessSpawns: childProcesses.childProcessSpawns,
      childProcessInteractions: childProcesses.childProcessInteractions,
      requestOperations: dataEffects.requestOperations,
      resourceOperations,
      parserPartial,
    });
  return {
    assignmentFlows,
    ...calls,
    promiseOperations,
    ...asyncEffects,
    ...childProcesses,
    ...dataEffects,
    resourceOperations,
    objectOperations,
    functionFingerprints,
  };
}

/** Keep assignment and initializer syntax in the IR so consumers never reparse source. */
function* collectAssignmentFlowsSteps(
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
  callables: readonly JavaScriptSemanticCallable[],
): Generator<void, JavaScriptSemanticIr["assignmentFlows"]> {
  const flows: JavaScriptSemanticIr["assignmentFlows"][number][] = [];
  const stack = createSemanticCallableIdStack(
    new Set(callables.map((item) => item.callableId)),
  );
  yield* traverseJavaScriptValueAstSteps(program, state.erasedSyntaxNodes, {
    enter: (node, parent) => {
      stack.enter(node, parent);
      let target: t.Node;
      let source: t.Node;
      let operator: string;
      if (t.isAssignmentExpression(node)) {
        target = unwrapJavaScriptExpression(node.left).node;
        source = unwrapJavaScriptExpression(node.right).node;
        operator = node.operator;
      } else if (t.isVariableDeclarator(node) && node.init != null) {
        target = unwrapJavaScriptExpression(node.id).node;
        source = unwrapJavaScriptExpression(node.init).node;
        operator = "=";
      } else return;
      // Destructuring has its own property-selection owner.
      if (!t.isIdentifier(target) && !t.isMemberExpression(target)) return;
      // Exact aliases already have a value/identity projection. Retain the
      // missing syntactic inputs of transformed initializer values separately.
      if (
        t.isVariableDeclarator(node) &&
        (t.isIdentifier(source) || t.isMemberExpression(source))
      )
        return;
      flows.push({
        target: range(target),
        source: range(source),
        sourceIsReference:
          t.isIdentifier(source) || t.isMemberExpression(source),
        operator,
        ownerCallableId: stack.callables.at(-1) ?? null,
      });
    },
    exit: (node) => stack.exit(node),
  });
  return flows;
}
