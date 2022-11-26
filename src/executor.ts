import { Graph } from "./graph";
import { Element, ElementId, ElementType } from "./nodes";
import {
    CompiledGraph,
    compileGraph,
    CyclicConverterGroups,
    OrderedConverterGroups,
    ConverterGroupTypes,
} from "./compiler";
import { VariableScope } from "./formula";
import assert from "assert";

export type Packet = {
    from: ElementId;
    value: number;
};

/**
 * Update graph information to nextTick.
 * @param graph the Graph object
 */
export default function nextTick(graph: Graph) {
    // compute simulation execution order
    const compiledGraph = compileGraph(graph);
    // variable scope for evaluating conditions and functions
    const scope = graph.variableScope();
    // actually execute graph
    const outputs = executeCompiledGraph(compiledGraph, scope);
    // write to graph
    writeToGraph(graph, outputs);
}

/**
 * Execute the full simulation and update state of Graph.
 *
 * @param compiledGraph execution order and other info.
 * @param scope for evaluating conditions and functions
 */
export function executeCompiledGraph(
    compiledGraph: CompiledGraph,
    scope: VariableScope
): Map<ElementId, Packet[]> {
    let allOutputs: Map<ElementId, Packet[]> = new Map();
    for (const group of compiledGraph) {
        switch (group.type) {
            case ConverterGroupTypes.Cyclic: {
                const outputs = executeCyclicSubgroup(group, scope);
                mergeOutputs(allOutputs, outputs);
                break;
            }
            case ConverterGroupTypes.Ordered: {
                const outputs = executeOrderedSubgroup(group, scope);
                mergeOutputs(allOutputs, outputs);
                break;
            }
        }
    }
    return allOutputs;
}

/**
 * Run strategy if `group.type === ConverterGroupTypes.Ordered`.
 * Because a cycle does not exist in converters,
 * it runs all subgraph which the converter inputs depend upon first,
 * and then run the subgraph that contains this specific converter later.
 * @param orderedSubgroups
 * @param scope
 */
function executeOrderedSubgroup(
    orderedSubgroups: OrderedConverterGroups,
    scope: VariableScope
): Map<ElementId, Packet[]> {
    let allOutputs: Map<ElementId, Packet[]> = new Map();
    for (const i of orderedSubgroups.groupExecutionOrder) {
        const subgraph = orderedSubgroups.groups[i];
        const entryPoints = orderedSubgroups.entryPointsToGroup.get(i);
        const outputs = executeSubgroup(subgraph, entryPoints, scope);

        const converterId = orderedSubgroups.converterOfGroup.get(i);
        const converter = converterId ? subgraph.get(converterId) : undefined;
        for (const [id, packets] of outputs.entries()) {
            if (
                converter !== undefined &&
                converterId !== undefined &&
                id === converterId &&
                converter.type === ElementType.Converter
            ) {
                // write to converter if this subgroup has a converter
                const converterOutput = outputs.get(converterId);
                if (converterOutput !== undefined) {
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

/**
 * Run strategy if `group.type === ConverterGroupTypes.Cyclic`.
 * Because a dependent-relation cycle exists among converters,
 * Each subgroup only consumes the buffer of each converter
 * left from the previous tick.
 * It writes to these converter-buffers at the end of this tick.
 * @param cyclicSubgroup
 * @param scope
 */
function executeCyclicSubgroup(
    cyclicSubgroup: CyclicConverterGroups,
    scope: VariableScope
): Map<ElementId, Packet[]> {
    let allOutputs: Map<ElementId, Packet[]> = new Map();
    for (const [i, subgraph] of cyclicSubgroup.groups.entries()) {
        const entryPoints = cyclicSubgroup.entryPointsToGroup.get(i);
        const outputs = executeSubgroup(subgraph, entryPoints, scope);
        mergeOutputs(allOutputs, outputs);
    }
    return allOutputs;
}

/**
 * Subgraph consists of only Edges and Gates, and at most one Converter.
 * The common logic part of executing cyclic and ordered subgroup.
 */
function executeSubgroup(
    subgraph: Map<ElementId, Element>,
    entryPoints: Set<ElementId> | undefined,
    scope: VariableScope
): Map<ElementId, Packet[]> {
    const output: Map<ElementId, Packet[]> = new Map();
    if (entryPoints === undefined || entryPoints.size === 0) {
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
    let nextPacket: Packet = {
        from: edge.fromNode,
        value: 0,
    };
    const fromElement = subgraph.get(edge.fromNode);
    switch (fromElement?.type) {
        case ElementType.Converter: {
            nextPacket.value = fromElement._takeFromState(
                edge.getRate(),
                scope
            );
            break;
        }
        case ElementType.Pool: {
            nextPacket.value = fromElement._takeFromPool(edge.getRate());
            break;
        }
        case ElementType.Gate: {
            if (packet === undefined) {
                // nothing to forward, end recursion
                return;
            } else {
                // forwarding with possible loss
                nextPacket.value = Math.min(packet.value, edge.getRate());
                nextPacket.from = packet.from;
            }
            break;
        }
        case ElementType.Edge:
            throw Error("bad data structure (edge-edge connection)");
    }

    // target
    const toElement = subgraph.get(edge.toNode);
    // recurse if the next element is Gate
    if (toElement?.type === ElementType.Gate) {
        const nextEdge = toElement._getOutput();
        if (nextEdge !== undefined && nextPacket.value > 0) {
            // continue forwarding if edge connected to Gate
            // and there's something to forward
            doEdgeWork(subgraph, nextEdge, visited, outputs, scope, nextPacket);
        }
    } else {
        // write to the output in cases of Pool or Converter
        if (!outputs.has(edge.toNode)) {
            outputs.set(edge.toNode, []);
        }
        if (nextPacket.value > 0) {
            outputs.get(edge.toNode)!.push(nextPacket);
        }
    }
}

/**
 * Write collected outputs to Graph.
 * @param graph the graph object
 * @param allOutputs outputs collected from all subgraph.
 */
export function writeToGraph(
    graph: Graph,
    allOutputs: Map<ElementId, Packet[]>
) {
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

export function mergeOutputs(
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
