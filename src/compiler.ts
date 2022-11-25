import { Element, ElementId, ElementType } from "./nodes";
import { Graph } from "./graph";
import { DirectedGraph } from "graphology";
import { hasCycle, topologicalSort } from "graphology-dag";

export type CompiledGraph = ParallelGroup[];
export type ParallelGroup = OrderedConverterGroups | CyclicConverterGroups;
// Apply different execution strategies depending on whether converters
// impose upon each other cyclic execution priority.
export enum ParallelGroupTypes {
    Ordered = "ordered",
    Cyclic = "cyclic",
}
export type OrderedConverterGroups = {
    type: ParallelGroupTypes.Ordered;
    groups: Map<ElementId, Element>[];
    groupExecutionOrder: number[];
    converterOfGroup: Map<number, ElementId>;
    entryPointsToGroup: Map<number, Set<ElementId>>;
};
export type CyclicConverterGroups = {
    type: ParallelGroupTypes.Cyclic;
    groups: Map<ElementId, Element>[];
    converterOfGroup: Map<number, ElementId>;
    entryPointsToGroup: Map<number, Set<ElementId>>;
};

/**
 * Compute the execution order of the `Graph`.
 * It can also be used for checking Graph.
 * @param graph the Graph object.
 * @param isCheckMode whether this run is for checking Graph
 */
export async function compileGraph(
    graph: Graph,
    isCheckMode: boolean = false
): Promise<CompiledGraph> {
    const compiledGraph: CompiledGraph = [];
    const poolGroups = await cutAtPoolInput(graph, isCheckMode);
    for (const group of poolGroups) {
        const converterGroups = await cutAtConverterInput(group, isCheckMode);
        compiledGraph.push(await computeSubGroupOrders(graph, converterGroups));
    }
    return compiledGraph;
}

/**
 * DFS to cut graph into groups that can be executed in parallel.
 * Specifically, cut them at the output point of Pools.
 *
 * Each subgraph contains at most one `Pool` as an input Object.
 * @param graph: the graph object
 * @param isCheckMode whether this run is for checking Graph
 */
async function cutAtPoolInput(
    graph: Graph,
    isCheckMode: boolean = false
): Promise<Map<ElementId, Element>[]> {
    const visited: Set<ElementId> = new Set();
    const groups: Map<ElementId, Element>[] = [];
    for (const id of graph.elements.keys()) {
        if (visited.has(id)) continue;
        const newGroup = await buildGroup(
            graph.elements,
            id,
            true,
            false,
            isCheckMode,
            visited
        );
        groups.push(newGroup);
    }
    return groups;
}

/**
 * DFS cut subgraph at the input points of `Converter`.
 *
 * Each sub-subgraph contains at most one `Converter` as output Element.
 * @param graphElements
 * @param isCheckMode whether this run is for checking Graph
 */
async function cutAtConverterInput(
    graphElements: Map<ElementId, Element>,
    isCheckMode: boolean = false
): Promise<Map<ElementId, Element>[]> {
    const visited: Set<ElementId> = new Set();
    const groups: Map<ElementId, Element>[] = [];
    for (const id of graphElements.keys()) {
        if (visited.has(id)) continue;
        const newGroup = await buildGroup(
            graphElements,
            id,
            true,
            true,
            isCheckMode,
            visited
        );
        groups.push(newGroup);
    }
    return groups;
}

/**
 * Topological sorting of subgroups.
 *
 * @param graph
 * @param groups a list of subgroups cut by Converter output
 * @return If converter causes a priority cycle: return undefined;
 *         Otherwise, return execution order of subgroups.
 */
async function computeSubGroupOrders(
    graph: Graph,
    groups: Map<ElementId, Element>[]
): Promise<ParallelGroup> {
    const groupToConverter: Map<number, ElementId> = new Map();
    const converterToGroup: Map<ElementId, number> = new Map();
    // Pool or Converter to edge
    const entryPointsToGroup: Map<number, Set<ElementId>> = new Map();

    // build `groupToConverter`, `converterToGroup` and `entryPointsToGroup`
    for (const [groupId, subGroup] of groups.entries()) {
        const entryPoints: Set<ElementId> = new Set();
        entryPointsToGroup.set(groupId, entryPoints);
        for (const [elementId, e] of subGroup) {
            switch (e.type) {
                case ElementType.Converter: {
                    groupToConverter.set(groupId, elementId);
                    break;
                }
                case ElementType.Edge: {
                    const from = graph.getElement(e.fromNode);
                    switch (from?.type) {
                        case ElementType.Converter:
                            converterToGroup.set(e.fromNode, groupId);
                            entryPoints.add(elementId);
                            break;
                        case ElementType.Pool:
                            entryPoints.add(elementId);
                            break;
                    }
                    break;
                }
            }
        }
    }

    // compute group priority using DAG and topological sort
    const directedGraph = new DirectedGraph();
    for (const [groupId, converterId] of groupToConverter.entries()) {
        const dependentGroup = converterToGroup.get(converterId);
        if (dependentGroup) {
            directedGraph.mergeEdge(groupId, dependentGroup);
        }
    }
    if (hasCycle(directedGraph)) {
        return {
            type: ParallelGroupTypes.Cyclic,
            groups,
            converterOfGroup: groupToConverter,
            entryPointsToGroup,
        };
    } else {
        const order = topologicalSort(directedGraph).map(parseInt);
        return {
            type: ParallelGroupTypes.Ordered,
            groups,
            groupExecutionOrder: order,
            converterOfGroup: groupToConverter,
            entryPointsToGroup,
        };
    }
}

/**
 * Recursively find all connected neighbors of an element.
 * @param graphElements elements of graphs or subgraph.
 * @param startElement the element to start with.
 * @param cutAtPoolInput whether to ignore `Pool.input <-> Edge.toNode`
 * @param cutAtConverterOutput whether to ignore `Converter.output <-> Edge.fromNode`
 * @param isCheckMode use all output edges of `Gate`
 * @param visited DFS `visited` table
 */
async function buildGroup(
    graphElements: Map<ElementId, Element>,
    startElement: ElementId,
    cutAtPoolInput: boolean,
    cutAtConverterOutput: boolean,
    isCheckMode: boolean,
    visited: Set<ElementId>
): Promise<Map<ElementId, Element>> {
    const group: Map<ElementId, Element> = new Map();
    await buildGroupInner(
        graphElements,
        startElement,
        cutAtPoolInput,
        cutAtConverterOutput,
        group,
        visited
    );
    return group;
}

async function buildGroupInner(
    graphElements: Map<ElementId, Element>,
    currentElement: ElementId,
    cutAtPoolInput: boolean,
    cutAtConverterOutput: boolean,
    group: Map<ElementId, Element>,
    visited: Set<ElementId>
) {
    const element = graphElements.get(currentElement);
    if (!element || visited.has(currentElement)) {
        return;
    }
    // add current element to the group
    group.set(currentElement, element);
    // DFS, set visited to True
    visited.add(currentElement);
    // get ElementId of neighbors
    const neighbors = getNeighborsOf(
        graphElements,
        element,
        cutAtPoolInput,
        cutAtConverterOutput
    );
    // recursively add to group
    for (const elementId of neighbors) {
        await buildGroupInner(
            graphElements,
            elementId,
            cutAtPoolInput,
            cutAtConverterOutput,
            group,
            visited
        );
    }
}

/**
 * Get neighbor after activated Gates.
 * Cut at specific points depending on the flags specified.
 *
 * @param graphElements the graph storage
 * @param element the element itself
 * @param cutAtPoolInput whether to cut graph at Pool input points
 * @param cutAtConverterOutput whether to cut converter at output points
 * @param isCheckMode whether this run is for checking Graph
 */
function getNeighborsOf(
    graphElements: Map<ElementId, Element>,
    element: Element,
    cutAtPoolInput: boolean,
    cutAtConverterOutput: boolean,
    isCheckMode: boolean = false
): ElementId[] {
    const neighbors: ElementId[] = [];
    switch (element.type) {
        case ElementType.Pool: {
            const input = element._getInput();
            if (input && !cutAtPoolInput) {
                neighbors.push(input);
            }
            const output = element._getOutput();
            if (output) {
                neighbors.push(output);
            }
            break;
        }
        case ElementType.Gate: {
            const input = element._getInput();
            if (input && !cutAtPoolInput) {
                neighbors.push(input);
            }
            if (isCheckMode) {
                // for the purpose of checking graph logic
                // enable all gate output edges.
                const outputs = element._getOutputs();
                for (const [output, weight] of outputs.entries()) {
                    if (weight > 0) {
                        neighbors.push(output);
                    }
                }
            } else {
                const output = element._getOutput();
                if (output) {
                    neighbors.push(output);
                }
            }
            break;
        }
        case ElementType.Converter: {
            const inputs = element._getInputs();
            inputs.forEach(id => neighbors.push(id));
            const output = element._getOutput();
            if (output && !cutAtConverterOutput) {
                neighbors.push(output);
            }
            break;
        }
        case ElementType.Edge: {
            const to = graphElements.get(element.toNode);
            // do not connect to Pool, if cut at Pool input
            if (!cutAtPoolInput || to?.type !== ElementType.Pool) {
                neighbors.push(element.toNode);
            }
            const from = graphElements.get(element.fromNode);
            // do not connect from Converter, if cut at Converter output
            if (!cutAtConverterOutput || from?.type !== ElementType.Converter) {
                neighbors.push(element.fromNode);
            }
            break;
        }
    }
    return neighbors;
}