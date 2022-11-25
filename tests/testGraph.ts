import { Gate, Graph, NodeType } from "../src";

export function testCase1(): Graph {
    const graph = new Graph();
    addDeadCycle(graph);
    addTestGraph(graph);
    addCyclicConverter(graph);
    const g2 = graph.getElement("g2") as Gate;
    g2._setOutput("g2-p1", 0);
    g2._setOutput("g2-p2", 0);
    const g3 = graph.getElement("g3") as Gate;
    g3._setOutput("g3-c4", 0);
    return graph;
}

export function testCase2(): Graph {
    const graph = new Graph();
    addDeadCycle(graph);
    addTestGraph(graph);
    addCyclicConverter(graph);
    const g2 = graph.getElement("g2") as Gate;
    g2._setOutput("g2-c1", 0);
    g2._setOutput("g2-p1", 0);
    const g3 = graph.getElement("g3") as Gate;
    g3._setOutput("g3-p4", 0);
    return graph;
}

export function addTestGraph(graph: Graph) {
    graph.addNode(NodeType.Pool, "p0", "p0");
    graph.addNode(NodeType.Pool, "p1", "p1");
    graph.addNode(NodeType.Pool, "p2", "p2");
    graph.addNode(NodeType.Pool, "p3", "p3");
    graph.addNode(NodeType.Converter, "c0", "c0");
    graph.addNode(NodeType.Converter, "c1", "c1");
    graph.addNode(NodeType.Converter, "c2", "c2");
    graph.addNode(NodeType.Gate, "g2", "g2");
    graph.addEdge("p0-c0", "p0", "c0");
    graph.addEdge("c0-g2", "c0", "g2");
    graph.addEdge("g2-c1", "g2", "c1");
    graph.addEdge("g2-p1", "g2", "p1");
    graph.addEdge("g2-p2", "g2", "p2");
    graph.addEdge("p1-c2", "p1", "c2");
    graph.addEdge("p2-c2", "p2", "c2");
    graph.addEdge("c2-c1", "c2", "c1");
    graph.addEdge("c1-p0", "c1", "p0");
    graph.addEdge("p3-c1", "p3", "c1");
}

export function addCyclicConverter(graph: Graph) {
    graph.addNode(NodeType.Converter, "c3", "c3");
    graph.addNode(NodeType.Converter, "c4", "c4");
    graph.addNode(NodeType.Gate, "g3", "g3");
    graph.addNode(NodeType.Pool, "p4", "p4");
    graph.addEdge("c3-g3", "c3", "g3");
    graph.addEdge("g3-c4", "g3", "c4");
    graph.addEdge("g3-p4", "g3", "p4");
    graph.addEdge("p4-c3", "p4", "c3");
    graph.addEdge("c4-c3", "c4", "c3");
}

export function addDeadCycle(graph: Graph) {
    graph.addNode(NodeType.Gate, "g0", "g0");
    graph.addNode(NodeType.Gate, "g1", "g1");
    graph.addEdge("g0-g1", "g0", "g1");
    graph.addEdge("g1-g0", "g1", "g0");
}