import { Graph } from "./graph";
import { Element, ElementId, ElementType } from "./nodes";
import {
    CompiledGraph,
    compileGraph,
    CyclicConverterGroups,
    OrderedConverterGroups,
    ParallelGroupTypes,
} from "./compiler";
import { VariableScope } from "./formula";
import assert from "assert";

type Packet = {
    from: ElementId;
    value: number;
};

/**
 * Update graph information to nextTick.
 * @param graph the Graph object
 */
export default async function nextTick(graph: Graph) {
    // update Pool states, and activate Gates.
    await activatePoolsAndGates(graph);
    // compute simulation execution order
    const compiledGraph = await compileGraph(graph);
    // variable scope for evaluating conditions and functions
    const scope = graph.variableScope();
    // actually execute graph
    const outputs = await executeCompiledGraph(compiledGraph, scope);
    // write to graph
    writeToGraph(graph, outputs);
}

/**
 * Update all Pool states and activate gates.
 * @param graph the graph computed
 */
async function activatePoolsAndGates(graph: Graph) {
    for (const e of graph.elements.values()) {
        switch (e.type) {
            case ElementType.Pool:
            case ElementType.Gate:
                e._nextTick(graph.variableScope());
                break;
        }
    }
}

/**
 * Execute the full simulation and update state of Graph.
 *
 * @param compiledGraph execution order and other info.
 * @param scope for evaluating conditions and functions
 */
async function executeCompiledGraph(
    compiledGraph: CompiledGraph,
    scope: VariableScope
): Promise<Map<ElementId, Packet[]>> {
    let allOutputs: Map<ElementId, Packet[]> = new Map();
    for (const group of compiledGraph) {
        switch (group.type) {
            case ParallelGroupTypes.Cyclic: {
                const outputs = await executeCyclicSubgroup(group, scope);
                mergeOutputs(allOutputs, outputs);
                break;
            }
            case ParallelGroupTypes.Ordered: {
                const outputs = await executeOrderedSubgroup(group, scope);
                mergeOutputs(allOutputs, outputs);
                break;
            }
        }
    }
    return allOutputs;
}

async function executeOrderedSubgroup(
    orderedSubgroups: OrderedConverterGroups,
    scope: VariableScope
): Promise<Map<ElementId, Packet[]>> {
    let allOutputs: Map<ElementId, Packet[]> = new Map();
    for (const i of orderedSubgroups.groupExecutionOrder) {
        const subgraph = orderedSubgroups.groups[i];
        const entryPoints = orderedSubgroups.entryPointsToGroup.get(i);
        const outputs = await executeSubgroup(subgraph, entryPoints, scope);

        const converterId = orderedSubgroups.converterOfGroup.get(i);
        const converter = converterId ? subgraph.get(converterId) : undefined;
        for (const [id, packets] of outputs.entries()) {
            if (
                !!converter &&
                !!converterId &&
                id === converterId &&
                converter.type === ElementType.Converter
            ) {
                // write to converter if this subgroup has a converter
                const converterOutput = outputs.get(converterId);
                if (converterOutput) {
                    for (const packet of converterOutput) {
                        converter._addToBuffer(packet.from, packet.value);
                    }
                }
            } else {
                // Otherwise, aggregate outputs
                if (!allOutputs.has(id)) {
                    allOutputs.set(id, []);
                }
                allOutputs.get(id)!.push(...packets);
            }
        }
    }
    return allOutputs;
}

async function executeCyclicSubgroup(
    cyclicSubgroup: CyclicConverterGroups,
    scope: VariableScope
): Promise<Map<ElementId, Packet[]>> {
    let allOutputs: Map<ElementId, Packet[]> = new Map();
    for (const [i, subgraph] of cyclicSubgroup.groups.entries()) {
        const entryPoints = cyclicSubgroup.entryPointsToGroup.get(i);
        const outputs = await executeSubgroup(subgraph, entryPoints, scope);
        mergeOutputs(allOutputs, outputs);
    }
    return allOutputs;
}

/**
 * Subgraph consists of only Edges and Gates, and at most one Converter.
 *
 * There are several scenarios:
 * - Edges and Gates form chains.
 * - Or, Edges and Gates form a cycle, resulting in no entry point.
 */
async function executeSubgroup(
    subgraph: Map<ElementId, Element>,
    entryPoints: Set<ElementId> | undefined,
    scope: VariableScope
): Promise<Map<ElementId, Packet[]>> {
    const output: Map<ElementId, Packet[]> = new Map();
    if (!entryPoints) {
        // dead group (i.e. group with no input from Converter or Pool.)
        return output;
    }

    // Use `visited` to keep track of visited edges
    // and prevent potential infinite loop.
    const visited: Set<ElementId> = new Set();
    for (const edgeId of entryPoints) {
        doEdgeWork(subgraph, edgeId, visited, output, scope);
    }
    return output;
}

// all output are cached in outputs Map and not written to Graph
function doEdgeWork(
    subgraph: Map<ElementId, Element>,
    edgeId: ElementId,
    visited: Set<ElementId>,
    outputs: Map<ElementId, Packet[]>,
    scope: VariableScope,
    packet?: Packet
) {
    if (visited.has(edgeId)) return;
    visited.add(edgeId);
    const edge = subgraph.get(edgeId);
    if (edge?.type !== ElementType.Edge) return; // never happens

    // source
    let nextPacket: Packet | undefined = {
        from: edge.fromNode,
        value: 0,
    };
    const fromElement = subgraph.get(edge.fromNode);
    switch (fromElement?.type) {
        case ElementType.Converter:
            nextPacket.value = fromElement._takeFromState(
                edge.getRate(),
                scope
            );
            break;
        case ElementType.Pool:
            nextPacket.value = fromElement._takeFromPool(edge.getRate());
            break;
        case ElementType.Gate:
            if (!packet) {
                // forward nothing if gate does not come with packet
                nextPacket = undefined;
            } else {
                // forwarding with possible loss
                nextPacket.value = Math.min(packet.value, edge.getRate());
                nextPacket.from = packet.from;
            }
            break;
        case ElementType.Edge:
            throw Error("bad data structure (edge-edge connection)");
    }

    // target
    const toElement = subgraph.get(edge.toNode);
    // recurse if the next element is Gate
    if (toElement?.type === ElementType.Gate) {
        const nextEdge = toElement._getOutput();
        if (nextEdge) {
            // continue forwarding if edge connected to Gate
            doEdgeWork(subgraph, nextEdge, visited, outputs, scope, nextPacket);
        }
    } else {
        // write to the output in cases of Pool or Converter
        if (nextPacket) {
            if (!outputs.has(edge.toNode)) {
                outputs.set(edge.toNode, []);
            }
            outputs.get(edge.toNode)?.push(nextPacket);
        }
    }
}

/**
 * Write collected outputs to Graph.
 * @param graph the graph object
 * @param allOutputs outputs collected from all subgraph.
 */
function writeToGraph(graph: Graph, allOutputs: Map<ElementId, Packet[]>) {
    for (const [id, packets] of allOutputs) {
        const e = graph.getElement(id);
        switch (e?.type) {
            case ElementType.Pool:
                assert(packets.length == 1);
                e._addToPool(packets[0]!.value);
                break;
            case ElementType.Converter:
                for (const packet of packets) {
                    e._addToBuffer(packet.from, packet.value);
                }
                break;
        }
    }
}

function mergeOutputs(
    to: Map<ElementId, Packet[]>,
    from: Map<ElementId, Packet[]>
) {
    for (const [id, packets] of from.entries()) {
        if (!to.has(id)) {
            to.set(id, []);
        }
        to.get(id)!.push(...packets);
    }
}
