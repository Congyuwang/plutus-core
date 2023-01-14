import { ElementType, Graph, NodeType } from "../src";

describe("test graph functionality", () => {
  test("test graph auto label", () => {
    const graph = new Graph();
    graph.addNode(NodeType.Pool, "p-0");
    graph.addNode(NodeType.Pool, "p-1");
    expect(() => graph.addNode(NodeType.Pool, "p-0")).toThrow(Error("id already exists"));
    graph.setLabel("p-1", "pool$custom");
    expect(graph.getElement("p-0")?.getLabel()).toEqual("pool$0");
    expect(graph.getElement("p-1")?.getLabel()).toEqual("pool$custom");
    expect(graph.deleteElement("p-1")).toEqual(["p-1"]);
    graph.addNode(NodeType.Pool, "p-2");
    graph.addNode(NodeType.Converter, "c-0");
    expect(graph.getElement("p-2")?.getLabel()).toEqual("pool$2");
    expect(graph.getElement("c-0")?.getLabel()).toEqual("converter$0");
    graph.addEdge("e-0", "p-0", "c-0");
    graph.addEdge("e-1", "p-2", "c-0");
    expect(graph.getElement("e-0")?.getLabel()).toEqual("edge$0");
    expect(graph.getElement("e-1")?.getLabel()).toEqual("edge$1");
  });

  test("test graph pool-edge connecting and deleting", () => {
    const graph = new Graph();
    graph.addNode(NodeType.Pool, "p-0");
    graph.addNode(NodeType.Pool, "p-1");
    graph.addNode(NodeType.Pool, "p-2");
    graph.addNode(NodeType.Pool, "p-3");
    graph.addEdge("e-0", "p-0", "p-1");
    const p0 = graph.getElement("p-0");
    const p1 = graph.getElement("p-1");
    const p2 = graph.getElement("p-2");
    const p3 = graph.getElement("p-3");
    expect(p0?.type).toEqual(ElementType.Pool);
    expect(p1?.type).toEqual(ElementType.Pool);
    expect(p2?.type).toEqual(ElementType.Pool);
    expect(p3?.type).toEqual(ElementType.Pool);
    expect(Object.keys(graph.elements).length).toEqual(5);
    expect(Object.keys(graph.labels).length).toEqual(5);
    if (p0?.type === ElementType.Pool) {
      expect(p0._getOutput()).toEqual("e-0");
      expect(p0._getInput()).toBeUndefined();
    }
    if (p1?.type === ElementType.Pool) {
      expect(p1._getInput()).toEqual("e-0");
      expect(p1._getOutput()).toBeUndefined();
    }

    // p3 -> p0 -> p1 -> p2
    // |                  |
    // +--------<---------+
    graph.addEdge("e-1", "p-1", "p-2");
    graph.addEdge("e-2", "p-2", "p-3");
    graph.addEdge("e-3", "p-3", "p-0");
    expect(() => graph.addEdge("e-3", "p-3", "p-0")).toThrow(Error("edge id already exists"));
    expect(() => graph.addEdge("e-4", "p-5", "p-0")).toThrow(
      Error("connecting Node with non-existing id"),
    );
    expect(() => graph.addEdge("e-4", "p-3", "p-3")).toThrow(
      Error("cannot connect to self (self loop not allowed)"),
    );
    graph.addEdge("e-4", "p-3", "p-0");
    if (p0?.type === ElementType.Pool) {
      expect(p0._getInput()).toEqual("e-4");
      expect(p0._getOutput()).toEqual("e-0");
    }
    if (p1?.type === ElementType.Pool) {
      expect(p1._getInput()).toEqual("e-0");
      expect(p1._getOutput()).toEqual("e-1");
    }
    if (p2?.type === ElementType.Pool) {
      expect(p2._getInput()).toEqual("e-1");
      expect(p2._getOutput()).toEqual("e-2");
    }
    if (p3?.type === ElementType.Pool) {
      expect(p3._getInput()).toEqual("e-2");
      expect(p3._getOutput()).toEqual("e-4");
    }
    expect(Object.keys(graph.elements).length).toEqual(8);
    expect(Object.keys(graph.labels).length).toEqual(8);

    // p3 -> p0 -> p1 -> p2
    expect(graph.deleteElement("e-2")).toEqual(["e-2"]);
    if (p2?.type === ElementType.Pool) {
      expect(p2._getInput()).toEqual("e-1");
      expect(p2._getOutput()).toBeUndefined();
    }
    if (p3?.type === ElementType.Pool) {
      expect(p3._getInput()).toBeUndefined();
      expect(p3._getOutput()).toEqual("e-4");
    }
    expect(Object.keys(graph.elements).length).toEqual(7);
    expect(Object.keys(graph.labels).length).toEqual(7);

    // p3    p1 -> p2
    expect(new Set(graph.deleteElement("p-0"))).toEqual(new Set(["e-4", "e-0", "p-0"]));
    if (p1?.type === ElementType.Pool) {
      expect(p1._getInput()).toBeUndefined();
      expect(p1._getOutput()).toEqual("e-1");
    }
    if (p2?.type === ElementType.Pool) {
      expect(p2._getInput()).toEqual("e-1");
      expect(p2._getOutput()).toBeUndefined();
    }
    if (p3?.type === ElementType.Pool) {
      expect(p3._getInput()).toBeUndefined();
      expect(p3._getOutput()).toBeUndefined();
    }
    expect(Object.keys(graph.elements).length).toEqual(4);
    expect(Object.keys(graph.labels).length).toEqual(4);

    // p3 <- p1    p2
    graph.addEdge("e-3", "p-1", "p-3");
    expect(graph.getElement("e-1")).toBeUndefined();
    if (p1?.type === ElementType.Pool) {
      expect(p1._getInput()).toBeUndefined();
      expect(p1._getOutput()).toEqual("e-3");
    }
    if (p2?.type === ElementType.Pool) {
      expect(p2._getInput()).toBeUndefined();
      expect(p2._getOutput()).toBeUndefined();
    }
    if (p3?.type === ElementType.Pool) {
      expect(p3._getInput()).toEqual("e-3");
      expect(p3._getOutput()).toBeUndefined();
    }
    expect(Object.keys(graph.elements).length).toEqual(4);
    expect(Object.keys(graph.labels).length).toEqual(4);

    // p3    p2
    expect(new Set(graph.deleteElement("p-1"))).toEqual(new Set(["p-1", "e-3"]));
    if (p2?.type === ElementType.Pool) {
      expect(p2._getInput()).toBeUndefined();
      expect(p2._getOutput()).toBeUndefined();
    }
    if (p3?.type === ElementType.Pool) {
      expect(p3._getInput()).toBeUndefined();
      expect(p3._getOutput()).toBeUndefined();
    }
    expect(Object.keys(graph.elements).length).toEqual(2);
    expect(Object.keys(graph.labels).length).toEqual(2);
  });

  test("test graph pool, gate, and converter", () => {
    const graph = new Graph();
    graph.addNode(NodeType.Pool, "p-0");
    graph.addNode(NodeType.Pool, "p-1");
    graph.addNode(NodeType.Pool, "p-2");
    graph.addNode(NodeType.Pool, "p-3");
    graph.addNode(NodeType.Converter, "c-0");
    graph.addNode(NodeType.Gate, "g-0");
    graph.addNode(NodeType.Swap, "s-0");
    const p0 = graph.getElement("p-0");
    const p1 = graph.getElement("p-1");
    const p2 = graph.getElement("p-2");
    const p3 = graph.getElement("p-3");
    const c0 = graph.getElement("c-0");
    const g0 = graph.getElement("g-0");
    const s0 = graph.getElement("s-0");
    expect(p0?.type).toEqual(ElementType.Pool);
    expect(p1?.type).toEqual(ElementType.Pool);
    expect(p2?.type).toEqual(ElementType.Pool);
    expect(p3?.type).toEqual(ElementType.Pool);
    expect(c0?.type).toEqual(ElementType.Converter);
    expect(g0?.type).toEqual(ElementType.Gate);
    expect(s0?.type).toEqual(ElementType.Swap);
    expect(Object.keys(graph.elements).length).toEqual(7);

    // +-->g0------->---s0-+
    // |   |               |
    // |   |               |
    // p3  +-->p0--->p1    p2
    // |             |     |
    // |             c0<---+
    // |             |
    // +---s0-<------+
    graph.addEdge("e-0", "p-0", "p-1");
    graph.addEdge("e-1", "p-1", "c-0");
    graph.addEdge("e-3", "p-3", "g-0");
    graph.addEdge("e-4", "g-0", "p-0");
    graph.addEdge("e-5-0", "g-0", "s-0", 0);
    graph.addEdge("e-5-1", "s-0", "p-2", 0);
    graph.addEdge("e-2-0", "c-0", "s-0", 1);
    graph.addEdge("e-2-1", "s-0", "p-3", 1);
    graph.addEdge("e-6", "p-2", "c-0");
    if (c0?.type === ElementType.Converter) {
      expect(new Set(Object.keys(c0._getInputs()))).toEqual(new Set(["e-1", "e-6"]));
      expect(c0._getOutput()).toEqual("e-2-0");
    }
    if (g0?.type === ElementType.Gate) {
      expect(g0._getInput()).toEqual("e-3");
      expect(g0._getOutputs()).toEqual({
        "e-4": 1,
        "e-5-0": 1,
      });
    }
    expect(Object.keys(graph.elements).length).toEqual(16);
    expect(Object.keys(graph.labels).length).toEqual(16);

    // +------>g0------->--s0--+
    // |      /|               |
    // |     / |               |
    // p3   /  +-->p0--->p1    p2
    // |   |             |     |
    // |   +------------>c0<---+
    // |                 |
    // +-----s0---<------+
    graph.addEdge("e-7", "g-0", "c-0");
    if (c0?.type === ElementType.Converter) {
      expect(new Set(Object.keys(c0._getInputs()))).toEqual(new Set(["e-1", "e-6", "e-7"]));
      expect(c0._getOutput()).toEqual("e-2-0");
    }
    if (g0?.type === ElementType.Gate) {
      expect(g0._getInput()).toEqual("e-3");
      expect(g0._getOutputs()).toEqual({
        "e-4": 1,
        "e-5-0": 1,
        "e-7": 1,
      });
    }
    expect(graph.upStreamTokensOfConverter("c-0"))
      .toEqual(new Set(["pool$1_token", "pool$2_token", "pool$3_token"]));
    expect(Object.keys(graph.elements).length).toEqual(17);
    expect(Object.keys(graph.labels).length).toEqual(17);

    // +------>g0------->--s0
    // |      /|
    // |     / |
    // p3   /  +-->p0--->p1--->p2
    // |   |                   |
    // |   +------------>c0<---+
    // |                 |
    // +-----s0---<------+
    graph.addEdge("e-8", "p-1", "p-2");
    if (c0?.type === ElementType.Converter) {
      expect(new Set(Object.keys(c0._getInputs()))).toEqual(new Set(["e-6", "e-7"]));
      expect(c0._getOutput()).toEqual("e-2-0");
    }
    if (g0?.type === ElementType.Gate) {
      expect(g0._getInput()).toEqual("e-3");
      expect(g0._getOutputs()).toEqual({
        "e-4": 1,
        "e-5-0": 1,
        "e-7": 1,
      });
    }
    expect(Object.keys(graph.elements).length).toEqual(16);
    expect(Object.keys(graph.labels).length).toEqual(16);

    // +------>g0
    // |      /|
    // |     / |
    // p3   /  +-->p0--->p1--->p2
    //     |                   |
    //     +------------>c0<---+
    graph.deleteElement("s-0");
    if (c0?.type === ElementType.Converter) {
      expect(new Set(Object.keys(c0._getInputs()))).toEqual(new Set(["e-6", "e-7"]));
      expect(c0._getOutput()).toBeUndefined();
    }
    if (g0?.type === ElementType.Gate) {
      expect(g0._getInput()).toEqual("e-3");
      expect(g0._getOutputs()).toEqual({
        "e-4": 1,
        "e-7": 1,
      });
    }
    expect(Object.keys(graph.elements).length).toEqual(12);
    expect(Object.keys(graph.labels).length).toEqual(12);

    //        g0
    //        /
    //       /
    // p3---/----->p0--->p1--->p2
    // |   |                   |
    // |   +------------>c0<---+
    // |                 |
    // +----------<------+
    graph.addEdge("e-2", "c-0", "p-3");
    graph.addEdge("e-9", "p-3", "p-0");
    if (c0?.type === ElementType.Converter) {
      expect(new Set(Object.keys(c0._getInputs()))).toEqual(new Set(["e-6", "e-7"]));
      expect(c0._getOutput()).toEqual("e-2");
    }
    if (g0?.type === ElementType.Gate) {
      expect(g0._getInput()).toBeUndefined();
      expect(g0._getOutputs()).toEqual({ "e-7": 1 });
    }
    expect(Object.keys(graph.elements).length).toEqual(12);
    expect(Object.keys(graph.labels).length).toEqual(12);

    // p3--->p0--->p1--->p2    g0
    expect(new Set(graph.deleteElement("c-0"))).toEqual(new Set(["c-0", "e-6", "e-2", "e-7"]));
    if (g0?.type === ElementType.Gate) {
      expect(g0._getInput()).toBeUndefined();
      expect(g0._getOutputs()).toEqual({});
    }
    expect(Object.keys(graph.elements).length).toEqual(8);
    expect(Object.keys(graph.labels).length).toEqual(8);

    //        +------->--------+
    //        |                |
    // p3--->p0     p1--->p2   g0
    // |            |          |
    // +-----<------+-----<----+
    graph.addEdge("e-10", "p-2", "g-0");
    graph.addEdge("e-11", "g-0", "p-3");
    graph.addEdge("e-12", "g-0", "p-1");
    graph.addEdge("e-13", "p-0", "g-0");
    if (g0?.type === ElementType.Gate) {
      expect(g0._getInput()).toEqual("e-13");
      expect(g0._getOutputs()).toEqual({
        "e-11": 1,
        "e-12": 1,
      });
    }
    expect(Object.keys(graph.elements).length).toEqual(10);
    expect(Object.keys(graph.labels).length).toEqual(10);

    // p3--->p0     p1     g0
    expect(new Set(graph.deleteElement("p-2"))).toEqual(new Set(["p-2", "e-8"]));
    expect(Object.keys(graph.elements).length).toEqual(8);
    expect(Object.keys(graph.labels).length).toEqual(8);

    // p3--->p0    p1
    expect(new Set(graph.deleteElement("g-0"))).toEqual(new Set(["g-0", "e-13", "e-12", "e-11"]));
    expect(Object.keys(graph.elements).length).toEqual(4);
    expect(Object.keys(graph.labels).length).toEqual(4);
  });
});
