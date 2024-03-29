import { mergeOutputs, Packet } from "../src/executor";
import { Converter, ElementId, Graph, NodeType, Pool, Swap } from "../src";
import { smallGraph } from "./testGraph";
import { CheckResultType } from "../src/graph";

describe("test simple cases", () => {
  test("test two pools with a gate", () => {
    const graph = new Graph();
    graph.addNode(NodeType.Pool, "p0", "p0");
    graph.addNode(NodeType.Gate, "g0", "g0");
    graph.addNode(NodeType.Pool, "p1", "p1");
    (<Pool>graph.getElement("p0")).setState(10);
    graph.addEdge("p0-g0", "p0", "g0", 1);
    graph.addEdge("g0-p1", "g0", "p1", 1);
    let p0State = 10;
    let p1State = 0;
    for (let i = 0; i < 10; i++) {
      expect((<Pool>graph.getElement("p0")).getState()).toEqual(p0State--);
      expect((<Pool>graph.getElement("p1")).getState()).toEqual(p1State++);
      graph.nextTick();
    }
  });

  test("test two pools unlimited rate", () => {
    const graph = new Graph();
    graph.addNode(NodeType.Pool, "p0", "p0");
    graph.addNode(NodeType.Pool, "p1", "p1");
    (<Pool>graph.getElement("p0")).setState(10);
    graph.addEdge("p0-p1", "p0", "p1", undefined, -1);
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(10);
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(0);
    graph.nextTick();
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(0);
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(10);
    graph.nextTick();
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(0);
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(10);
  });

  test("test Pools loop", () => {
    const graph = new Graph();
    graph.addNode(NodeType.Pool, "p0", "p0");
    graph.addNode(NodeType.Pool, "p1", "p1");
    graph.addNode(NodeType.Pool, "p2", "p2");
    (<Pool>graph.getElement("p0")).setState(10);
    (<Pool>graph.getElement("p1")).setState(10);
    (<Pool>graph.getElement("p2")).setState(10);
    graph.addEdge("p0-p1", "p0", "p1", undefined, 1);
    graph.addEdge("p1-p2", "p1", "p2", undefined, 2);
    graph.addEdge("p2-p0", "p2", "p0", undefined, 3);
    let p0State = 10;
    let p1State = 10;
    let p2State = 10;
    for (let i = 0; i < 8; i++) {
      graph.nextTick();
      expect((<Pool>graph.getElement("p0")).getState()).toEqual((p0State = p0State - 1 + 3));
      expect((<Pool>graph.getElement("p1")).getState()).toEqual((p1State = p1State - 2 + 1));
      expect((<Pool>graph.getElement("p2")).getState()).toEqual((p2State = p2State - 3 + 2));
    }
    graph.nextTick();
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(
      // 26
      (p0State = p0State - 1 + 2),
      // 27
    );
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(
      // 2
      (p1State = p1State - 2 + 1),
      // 1
    );
    expect((<Pool>graph.getElement("p2")).getState()).toEqual(
      // 2
      (p2State = p2State - 2 + 2),
      // 2
    );
    graph.nextTick();
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(
      // 27
      (p0State = p0State - 1 + 2),
      // 28
    );
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(
      // 1
      (p1State = p1State - 1 + 1),
      // 1
    );
    expect((<Pool>graph.getElement("p2")).getState()).toEqual(
      // 2
      (p2State = p2State - 2 + 1),
      // 1
    );
    for (let i = 0; i < 5; i++) {
      graph.nextTick();
      expect((<Pool>graph.getElement("p0")).getState()).toEqual(p0State);
      expect((<Pool>graph.getElement("p1")).getState()).toEqual(p1State);
      expect((<Pool>graph.getElement("p2")).getState()).toEqual(p2State);
    }
  });

  test("pools with gates and converter (case 0)", () => {
    const graph = smallGraph();
    graph.setGateOutputWeight("g0", "g0-p0", 0);
    graph.setGateOutputWeight("g0", "g0-p1", 0);
    (<Pool>graph.getElement("p0")).setState(8);
    (<Pool>graph.getElement("p1")).setState(12);
    graph.nextTick();
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(4);
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(8);
    expect((<Converter>graph.getElement("c0")).getBuffer()).toEqual({
      p0_token: 2,
      p1_token: 3,
    });
    graph.nextTick();
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(0);
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(4);
    expect((<Converter>graph.getElement("c0")).getBuffer()).toEqual({
      p0_token: 4,
      p1_token: 6,
    });
    graph.nextTick();
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(0);
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graph.getElement("c0")).getBuffer()).toEqual({
      p0_token: 2,
      p1_token: 9,
    });
    graph.nextTick();
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(0);
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graph.getElement("c0")).getBuffer()).toEqual({
      p0_token: 0,
      p1_token: 8,
    });
    graph.nextTick();
    expect((<Converter>graph.getElement("c0")).getBuffer()).toEqual({
      p0_token: 0,
      p1_token: 8,
    });
  });

  test("pools with swap", () => {
    const graph = new Graph();
    const p0 = <Pool>graph.addNode(NodeType.Pool, "p0", "p0");
    p0._setToken("metal");
    p0.setState(100);
    const p1 = <Pool>graph.addNode(NodeType.Pool, "p1", "p1");
    p1._setToken("wood");
    p1.setState(100);
    const s0 = <Swap>graph.addNode(NodeType.Swap, "s0", "s0");
    graph.addEdge("p0-s0", "p0", "s0", 0, 10);
    graph.addEdge("s0-p1", "s0", "p1", 0, 10);
    graph.addEdge("p1-s0", "p1", "s0", 1, 20);
    graph.addEdge("s0-p0", "s0", "p0", 1, 20);
    expect(graph.checkGraph().type).toEqual(CheckResultType.Error);
    s0.setTokenA("metal");
    s0.setTokenB("wood");
    let p0State = 100;
    let p1State = 100;
    let swapMetal = 100;
    let swapWood = 100;
    for (let i = 0; i < 10; i++) {
      graph.nextTick();
      p0State -= 10;
      swapMetal += 10;
      p1State += swapWood - 10000 / swapMetal;
      swapWood = 10000 / swapMetal;
      p1State -= 20;
      swapWood += 20;
      p0State += swapMetal - 10000 / swapWood;
      swapMetal = 10000 / swapWood;
      expect(p1.getState()).toEqual(p1State);
      expect(p0.getState()).toEqual(p0State);
      expect(s0.getTokenA().amount).toEqual(swapMetal);
      expect(s0.getTokenB().amount).toEqual(swapWood);
    }
  });

  test("pools with gates and converter (case 1), also testing graph clone", () => {
    const graph = smallGraph();
    graph.setGateOutputWeight("g0", "g0-p0", 1);
    graph.setGateOutputWeight("g0", "g0-p1", 0);
    (<Pool>graph.getElement("p0")).setState(8);
    (<Pool>graph.getElement("p1")).setState(12);
    graph.nextTick();
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(8);
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(5);
    expect((<Converter>graph.getElement("c0")).getBuffer()).toEqual({
      p0_token: 2,
      p1_token: 3,
    });
    graph.nextTick();
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(4);
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(2);
    expect((<Converter>graph.getElement("c0")).getBuffer()).toEqual({
      p0_token: 4,
      p1_token: 6,
    });
    graph.nextTick();
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(1);
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graph.getElement("c0")).getBuffer()).toEqual({
      p0_token: 4,
      p1_token: 9,
    });
    graph.nextTick();
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(1);
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graph.getElement("c0")).getBuffer()).toEqual({
      p0_token: 3,
      p1_token: 8,
    });
    graph.nextTick();
    expect((<Pool>graph.getElement("p0")).getState()).toEqual(1);
    expect((<Pool>graph.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graph.getElement("c0")).getBuffer()).toEqual({
      p0_token: 2,
      p1_token: 7,
    });
    const graphClone = graph.clone();
    graphClone.nextTick();
    expect((<Pool>graphClone.getElement("p0")).getState()).toEqual(1);
    expect((<Pool>graphClone.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graphClone.getElement("c0")).getBuffer()).toEqual({
      p0_token: 1,
      p1_token: 6,
    });
    graphClone.nextTick();
    expect((<Pool>graphClone.getElement("p0")).getState()).toEqual(1);
    expect((<Pool>graphClone.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graphClone.getElement("c0")).getBuffer()).toEqual({
      p0_token: 0,
      p1_token: 5,
    });
    graphClone.nextTick();
    expect((<Pool>graphClone.getElement("p0")).getState()).toEqual(0.5);
    expect((<Pool>graphClone.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graphClone.getElement("c0")).getBuffer()).toEqual({
      p0_token: 0,
      p1_token: 4.5,
    });
    graphClone.nextTick();
    expect((<Pool>graphClone.getElement("p0")).getState()).toEqual(0.25);
    expect((<Pool>graphClone.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graphClone.getElement("c0")).getBuffer()).toEqual({
      p0_token: 0,
      p1_token: 4.25,
    });
    const graphReloaded = Graph.fromJSON(JSON.parse(JSON.stringify(graph)));
    graphReloaded.nextTick();
    expect((<Pool>graphReloaded.getElement("p0")).getState()).toEqual(1);
    expect((<Pool>graphReloaded.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graphReloaded.getElement("c0")).getBuffer()).toEqual({
      p0_token: 1,
      p1_token: 6,
    });
    graphReloaded.nextTick();
    expect((<Pool>graphReloaded.getElement("p0")).getState()).toEqual(1);
    expect((<Pool>graphReloaded.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graphReloaded.getElement("c0")).getBuffer()).toEqual({
      p0_token: 0,
      p1_token: 5,
    });
    graphReloaded.nextTick();
    expect((<Pool>graphReloaded.getElement("p0")).getState()).toEqual(0.5);
    expect((<Pool>graphReloaded.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graphReloaded.getElement("c0")).getBuffer()).toEqual({
      p0_token: 0,
      p1_token: 4.5,
    });
    graphReloaded.nextTick();
    expect((<Pool>graphReloaded.getElement("p0")).getState()).toEqual(0.25);
    expect((<Pool>graphReloaded.getElement("p1")).getState()).toEqual(0);
    expect((<Converter>graphReloaded.getElement("c0")).getBuffer()).toEqual({
      p0_token: 0,
      p1_token: 4.25,
    });
  });
});

describe("test executor utility functions", () => {
  test("test output merger", () => {
    const allOutputs: { [key: ElementId]: Packet[] } = {
      converter$0: [
        { from: "pool$0", token: "pool$0_token", value: 1 },
        { from: "converter$1", token: "converter$1_token", value: 2 },
      ],

      pool$0: [{ from: "pool$2", token: "pool$2_token", value: 3.5 }],
    };
    const newOutput: { [key: ElementId]: Packet[] } = {
      converter$0: [{ from: "pool$3", token: "pool$3_token", value: 2.5 }],
      pool$3: [{ from: "converter$5", token: "converter$5_token", value: 1.5 }],
    };
    mergeOutputs(allOutputs, newOutput);
    expect(allOutputs).toEqual({
      converter$0: [
        { from: "pool$0", token: "pool$0_token", value: 1 },
        { from: "converter$1", token: "converter$1_token", value: 2 },
        { from: "pool$3", token: "pool$3_token", value: 2.5 },
      ],
      pool$0: [{ from: "pool$2", token: "pool$2_token", value: 3.5 }],
      pool$3: [{ from: "converter$5", token: "converter$5_token", value: 1.5 }],
    });
  });
});
