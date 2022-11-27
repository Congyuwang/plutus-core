import { Element, ElementId, ElementType } from "./nodes";
import { Graph } from "./graph";
import { DirectedGraph } from "graphology";
import { hasCycle, topologicalSort } from "graphology-dag";

export type CompiledGraph = ParallelGroup[];
export type ParallelGroup = OrderedConverterGroups | CyclicConverterGroups;
// Apply different execution strategies depending on whether converters
// impose upon each other cyclic execution priority.
export enum ConverterGroupTypes {
    Ordered = "ordered",
    Cyclic = "cyclic",
}
export type OrderedConverterGroups = {
    type: ConverterGroupTypes.Ordered;
    groups: { [key: ElementId]: Element }[];
    groupExecutionOrder: number[];
    converterOfGroup: { [key: number]: ElementId };
    entryPointsToGroup: { [key: number]: Set<ElementId> };
};
export type CyclicConverterGroups = {
    type: ConverterGroupTypes.Cyclic;
    groups: { [key: ElementId]: Element }[];
    converterOfGroup: { [key: number]: ElementId };
    entryPointsToGroup: { [key: number]: Set<ElementId> };
};

/**
 * Compute the execution order of the `Graph`.
 * It can also be used for checking Graph.
 * @param graph the Graph object.
 * @param isCheckMode whether this run is for checking Graph
 */
export function compileGraph(
    graph: Graph,
    isCheckMode: boolean = false
): CompiledGraph {
    const activeGraphElements = activatePoolsAndGates(graph, isCheckMode);
    const compiledGraph: CompiledGraph = [];
    const poolGroups = cutAtPoolInput(activeGraphElements, isCheckMode);
    for (const group of poolGroups) {
        const converterGroups = cutAtConverterInput(group, isCheckMode);
        compiledGraph.push(computeSubGroupOrders(graph, converterGroups));
    }
    return compiledGraph;
}

/**
 * Update all Pool states and activate gates before compiling.
 * @param graph the graph computed
 * @param checkMode if running for checking graph, which does not
 *        change states of Gate or Pool.
 * @return active graph elements (with disabled edges removed).
 */
export function activatePoolsAndGates(
    graph: Graph,
    checkMode: boolean = false
): { [key: ElementId]: Element } {
    const disabled: Set<ElementId> = new Set();
    for (const e of Object.values(graph.elements)) {
        switch (e.type) {
            case ElementType.Pool:
                if (!checkMode) e._nextTick(graph.variableScope());
                break;
            case ElementType.Gate:
                if (!checkMode) {
                    e._nextTick();
                    const selected = e._getOutput();
                    Object.keys(e._getOutputs())
                        .filter(id => id !== selected)
                        .forEach(id => disabled.add(id));
                } else {
                    Object.entries(e._getOutputs())
                        .filter(([, weight]) => weight <= 0)
                        .forEach(([id]) => disabled.add(id));
                }
                break;
        }
    }
    const activeElements: { [key: ElementId]: Element } = {};
    for (const [id, element] of Object.entries(graph.elements)) {
        if (!disabled.has(id)) {
            activeElements[id] = element;
        }
    }
    return activeElements;
}

/**
 * DFS to cut graph into groups that can be executed in parallel.
 * Specifically, cut them at the output point of Pools.
 *
 * Each subgraph contains at most one `Pool` as an input Object.
 * @param graphElements: elements of graph, with disabled elements removed
 * @param isCheckMode whether this run is for checking Graph
 */
export function cutAtPoolInput(
    graphElements: { [key: ElementId]: Element },
    isCheckMode: boolean = false
): { [key: ElementId]: Element }[] {
    const visited: Set<ElementId> = new Set();
    const groups: { [key: ElementId]: Element }[] = [];
    for (const id of Object.keys(graphElements)) {
        if (visited.has(id)) continue;
        const newGroup = buildGroup(
            graphElements,
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
export function cutAtConverterInput(
    graphElements: { [key: ElementId]: Element },
    isCheckMode: boolean = false
): { [key: ElementId]: Element }[] {
    const visited: Set<ElementId> = new Set();
    const groups: { [key: ElementId]: Element }[] = [];
    for (const id of Object.keys(graphElements)) {
        if (visited.has(id)) continue;
        const newGroup = buildGroup(
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
export function computeSubGroupOrders(
    graph: Graph,
    groups: { [key: ElementId]: Element }[]
): ParallelGroup {
    const groupToConverter: { [key: number]: ElementId } = {};
    const converterToGroup: { [key: ElementId]: number } = {};
    // Pool or Converter to edge
    const entryPointsToGroup: { [key: number]: Set<ElementId> } = {};

    // build `groupToConverter`, `converterToGroup` and `entryPointsToGroup`
    for (const [groupId, subGroup] of groups.entries()) {
        const entryPoints: Set<ElementId> = new Set();
        entryPointsToGroup[groupId] = entryPoints;
        for (const [elementId, e] of Object.entries(subGroup)) {
            switch (e.type) {
                case ElementType.Converter: {
                    groupToConverter[groupId] = elementId;
                    break;
                }
                case ElementType.Edge: {
                    const from = graph.getElement(e.fromNode);
                    switch (from?.type) {
                        case ElementType.Converter:
                            converterToGroup[e.fromNode] = groupId;
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
    for (const i of groups.keys()) {
        directedGraph.addNode(i);
    }
    for (const [groupId, converterId] of Object.entries(groupToConverter)) {
        const dependentGroup = converterToGroup[converterId];
        if (dependentGroup !== undefined) {
            directedGraph.mergeEdge(groupId, dependentGroup);
        }
    }
    if (hasCycle(directedGraph)) {
        return {
            type: ConverterGroupTypes.Cyclic,
            groups,
            converterOfGroup: groupToConverter,
            entryPointsToGroup,
        };
    } else {
        const order = topologicalSort(directedGraph).map(i => parseInt(i, 10));
        return {
            type: ConverterGroupTypes.Ordered,
            groups,
            groupExecutionOrder: order,
            converterOfGroup: groupToConverter,
            entryPointsToGroup,
        };
    }
}

/**
 * Recursively find all connected neighbors of an element.
 * (DFS algorithm)
 *
 * @param graphElements elements of graphs or subgraph.
 * @param startElement the element to start with.
 * @param cutAtPoolInput whether to ignore `Pool.input <-> Edge.toNode`
 * @param cutAtConverterOutput whether to ignore `Converter.output <-> Edge.fromNode`
 * @param isCheckMode use all output edges of `Gate`
 * @param visited DFS `visited` table
 */
function buildGroup(
    graphElements: { [key: ElementId]: Element },
    startElement: ElementId,
    cutAtPoolInput: boolean,
    cutAtConverterOutput: boolean,
    isCheckMode: boolean,
    visited: Set<ElementId>
): { [key: ElementId]: Element } {
    const group: { [key: ElementId]: Element } = {};
    buildGroupInner(
        graphElements,
        startElement,
        cutAtPoolInput,
        cutAtConverterOutput,
        group,
        isCheckMode,
        visited
    );
    return group;
}

// DFS
function buildGroupInner(
    graphElements: { [key: ElementId]: Element },
    currentElement: ElementId,
    cutAtPoolInput: boolean,
    cutAtConverterOutput: boolean,
    group: { [key: ElementId]: Element },
    isCheckMode: boolean,
    visited: Set<ElementId>
) {
    const element = graphElements[currentElement];
    if (element === undefined || visited.has(currentElement)) {
        return;
    }
    // add current element to the group
    group[currentElement] = element;
    // DFS, set visited to True
    visited.add(currentElement);
    // get ElementId of neighbors
    const neighbors = getNeighborsOf(
        graphElements,
        element,
        cutAtPoolInput,
        cutAtConverterOutput,
        isCheckMode
    );
    // recursively add to group
    for (const elementId of neighbors) {
        buildGroupInner(
            graphElements,
            elementId,
            cutAtPoolInput,
            cutAtConverterOutput,
            group,
            isCheckMode,
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
    graphElements: { [key: ElementId]: Element },
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
            if (output !== undefined) {
                neighbors.push(output);
            }
            break;
        }
        case ElementType.Gate: {
            const input = element._getInput();
            if (input !== undefined) {
                neighbors.push(input);
            }
            if (isCheckMode) {
                // for the purpose of checking graph logic
                // enable all gate output edges.
                const outputs = element._getOutputs();
                for (const [output, weight] of Object.entries(outputs)) {
                    if (weight > 0) {
                        neighbors.push(output);
                    }
                }
            } else {
                const output = element._getOutput();
                if (output !== undefined) {
                    neighbors.push(output);
                }
            }
            break;
        }
        case ElementType.Converter: {
            const inputs = element._getInputs();
            Object.keys(inputs).forEach(id => neighbors.push(id));
            const output = element._getOutput();
            if (output && !cutAtConverterOutput) {
                neighbors.push(output);
            }
            break;
        }
        case ElementType.Edge: {
            const to = graphElements[element.toNode];
            // do not connect to Pool, if cut at Pool input
            if (!cutAtPoolInput || to?.type !== ElementType.Pool) {
                neighbors.push(element.toNode);
            }
            const from = graphElements[element.fromNode];
            // do not connect from Converter, if cut at Converter output
            if (!cutAtConverterOutput || from?.type !== ElementType.Converter) {
                neighbors.push(element.fromNode);
            }
            break;
        }
    }
    return neighbors;
}
