import { ElementId, ElementType } from "./nodes";
import { Graph } from "./graph";

/**
 * Update graph information to nextTick.
 * @param graph the Graph object
 */
export default function nextTick(graph: Graph) {
    updateStates(graph);
}

// Update all Pool states.
function updateStates(graph: Graph) {
    for (let e of graph.elements.values()) {
        if (e.type === ElementType.Pool) {
            e._nextTick(graph.variableScopes());
        }
    }
}

function edgeExecutionOrder(graph: Graph): ElementId[] {
    for (let e of graph.elements.values()) {
        if (e.type === ElementType.Pool) {
            e._nextTick(graph.variableScopes());
        }
    }
    return [];
}

function nextState(graph: Graph) {}
