import { Graph } from "./graph";
import { ElementId, ElementType, Token } from "./nodes";
import {
  CompiledGraph,
  compileGraph,
  ConverterGroupTypes,
  CyclicConverterGroups,
  OrderedConverterGroups,
} from "./compiler";

export type Packet = {
  from: ElementId;
  token: Token;
  value: number;
};

/**
 * Update graph information to nextTick.
 * @param graph the Graph object
 */
export default function nextTick(graph: Graph) {
  // compute simulation execution order
  const compiledGraph = compileGraph(graph);
  // actually execute graph
  const outputs = executeCompiledGraph(graph, compiledGraph);
  // write to graph
  writeToGraph(graph, outputs);
}

/**
 * Execute the full simulation and update state of Graph.
 *
 * @param graph the Graph object
 * @param compiledGraph execution order and other info.
 */
function executeCompiledGraph(
  graph: Graph,
  compiledGraph: CompiledGraph,
): { [key: ElementId]: Packet[] } {
  const allOutputs: { [key: ElementId]: Packet[] } = {};
  for (const group of compiledGraph) {
    switch (group.type) {
      case ConverterGroupTypes.Cyclic: {
        const outputs = executeCyclicSubgroup(graph, group);
        mergeOutputs(allOutputs, outputs);
        break;
      }
      case ConverterGroupTypes.Ordered: {
        const outputs = executeOrderedSubgroup(graph, group);
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
 * @param graph the graph object
 * @param orderedSubgroups
 */
function executeOrderedSubgroup(
  graph: Graph,
  orderedSubgroups: OrderedConverterGroups,
): { [key: ElementId]: Packet[] } {
  const allOutputs: { [key: ElementId]: Packet[] } = {};
  for (const i of orderedSubgroups.groupExecutionOrder) {
    const subgraph = orderedSubgroups.groups[i]!;
    const entryPoints = orderedSubgroups.entryPointsToGroup[i];
    const outputs = executeSubgroup(graph, entryPoints);

    const converterId = orderedSubgroups.converterOfGroup[i];
    const converter = converterId !== undefined ? subgraph[converterId] : undefined;
    for (const [id, packets] of Object.entries(outputs)) {
      if (
        converter !== undefined &&
        converterId !== undefined &&
        id === converterId &&
        converter.type === ElementType.Converter
      ) {
        // write to converter if this subgroup has a converter
        for (const packet of packets) {
          converter._addToBuffer(packet.token, packet.value);
        }
      } else {
        // Otherwise, aggregate outputs
        if (!(id in allOutputs)) {
          allOutputs[id] = [];
        }
        allOutputs[id]!.push(...packets);
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
 * @param graph the Graph object
 * @param cyclicSubgroup
 */
function executeCyclicSubgroup(
  graph: Graph,
  cyclicSubgroup: CyclicConverterGroups,
): { [key: ElementId]: Packet[] } {
  const allOutputs: { [key: ElementId]: Packet[] } = {};
  for (const entryPoints of Object.values(cyclicSubgroup.entryPointsToGroup)) {
    const outputs = executeSubgroup(graph, entryPoints);
    mergeOutputs(allOutputs, outputs);
  }
  return allOutputs;
}

/**
 * Subgraph consists of only Edges and Gates, and at most one Converter.
 * The common logic part of executing cyclic and ordered subgroup.
 */
function executeSubgroup(
  graph: Graph,
  entryPoints: Set<ElementId> | undefined,
): { [key: ElementId]: Packet[] } {
  const output: { [key: ElementId]: Packet[] } = {};
  if (entryPoints === undefined || entryPoints.size === 0) {
    // dead group (i.e. group with no input from Converter or Pool.)
    return output;
  }

  // Use `visited` to keep track of visited edges
  // and prevent potential infinite loop.
  for (const edgeId of entryPoints) {
    runEdge(graph, edgeId, output);
  }
  return output;
}

// all output are cached in outputs Map and not written to Graph
function runEdge(
  graph: Graph,
  edgeId: ElementId,
  outputs: { [key: ElementId]: Packet[] },
  packet?: Packet,
) {
  const edge = graph.getElement(edgeId);
  if (edge?.type !== ElementType.Edge) return; // never happens

  // evaluate edge condition
  if (!edge.evaluateCondition(graph.variableScope())) return;

  // source
  const nextPacket: Packet = {
    from: edge.fromNode,
    token: "",
    value: 0,
  };
  const fromElement = graph.getElement(edge.fromNode);
  switch (fromElement?.type) {
    case ElementType.Converter: {
      nextPacket.value = fromElement._takeFromState(
        edge.isUnlimited()
          ? fromElement.maximumConvertable(graph.variableScope()) // take all
          : edge.getRate(),
        graph.variableScope(),
      );
      nextPacket.token = fromElement.getToken();
      break;
    }
    case ElementType.Pool: {
      nextPacket.value = edge.isUnlimited()
        ? fromElement._takeFromPool(fromElement.getState()) // take all
        : fromElement._takeFromPool(edge.getRate());
      nextPacket.token = fromElement.getToken();
      break;
    }
    case ElementType.Gate: {
      if (packet === undefined) return;

      if (!fromElement.evaluateCondition(graph.variableScope())) return;

      // forwarding with possible loss
      nextPacket.value = edge.isUnlimited()
        ? packet.value // lossless take all
        : Math.min(packet.value, edge.getRate());
      nextPacket.from = packet.from;
      nextPacket.token = packet.token;
      break;
    }
    case ElementType.Swap: {
      if (packet === undefined) return;

      const swap = fromElement.swap(packet.value, packet.token, graph.variableScope());
      
      // if nothing swapped, end recursion
      if (swap === undefined) return;

      const [token, amount] = swap;
      nextPacket.from = packet.from;
      nextPacket.token = token;
      nextPacket.value = amount;
      break;
    }
    case ElementType.Edge:
      throw Error("bad data structure (edge-edge connection)");
  }

  // target
  const toElement = graph.getElement(edge.toNode);

  // next step if the packet is not empty
  if (nextPacket.value <= 0) {
    return;
  }
  // recurse if the next element is Gate or Swap
  switch (toElement?.type) {
    case ElementType.Gate: {
      const nextEdge = toElement._getOutput();
      if (nextEdge !== undefined) {
        // continue forwarding if edge connected to Gate
        // and there's something to forward
        runEdge(graph, nextEdge, outputs, nextPacket);
      }
      break;
    }
    case ElementType.Swap: {
      const pipe = toElement._getPipes().find(p => p[0] === edgeId);
      if (pipe === undefined) {
        throw Error("internal Error, pipe must not be undefined");
      }
      const nextEdge = pipe[1];
      if (nextEdge !== undefined) {
        // continue forwarding if edge connected to Gate
        // and there's something to forward
        runEdge(graph, nextEdge, outputs, nextPacket);
      }
      break;
    }
    default: {
      // write to the output in cases of Pool or Converter
      if (!(edge.toNode in outputs)) {
        outputs[edge.toNode] = [];
      }
      outputs[edge.toNode]!.push(nextPacket);
    }
  }
}

/**
 * Write collected outputs to Graph.
 * @param graph the graph object
 * @param allOutputs outputs collected from all subgraph.
 */
export function writeToGraph(graph: Graph, allOutputs: { [key: ElementId]: Packet[] }) {
  for (const [id, packets] of Object.entries(allOutputs)) {
    const e = graph.getElement(id);
    switch (e?.type) {
      case ElementType.Pool:
        if (packets.length !== 1) {
          throw Error("must have exactly one packet to Pool");
        }
        e._addToPool(packets[0]!.value);
        break;
      case ElementType.Converter:
        for (const packet of packets) {
          e._addToBuffer(packet.token, packet.value);
        }
        break;
    }
  }
}

export function mergeOutputs(
  to: { [key: ElementId]: Packet[] },
  from: { [key: ElementId]: Packet[] },
) {
  for (const [id, packets] of Object.entries(from)) {
    if (!(id in to)) {
      to[id] = [];
    }
    to[id]!.push(...packets);
  }
}
