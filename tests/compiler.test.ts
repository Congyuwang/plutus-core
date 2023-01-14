/**
 * For the details of the testing graphs,
 * open `../plutus-test-graph.drawio.xml` in `https://app.diagrams.net`
 */
import { Graph, Swap } from "../src";
import { addCyclicConverter, addDeadCycle, addTestGraph, testCase1, testCase2 } from "./testGraph";
import { CheckResultType } from "../src/graph";
import {
  activatePoolsAndGates,
  CompiledGraph,
  computeSubGroupOrders,
  ConverterGroupTypes,
  cutAtConverterInput,
  cutAtPoolInput,
} from "../src/compiler";

describe("test compiler module", () => {
  test("test activatePoolsAndGate (1)", () => {
    const graph = testCase1();
    expect(Object.keys(graph.elements).length).toEqual(34);
    const elements = activatePoolsAndGates(graph);
    expect(Object.keys(elements).length).toEqual(31);
  });

  test("test activatePoolsAndGate (2)", () => {
    const graph = testCase2();
    expect(Object.keys(graph.elements).length).toEqual(34);
    const elements = activatePoolsAndGates(graph);
    expect(Object.keys(elements).length).toEqual(31);
  });

  test("test cutByPoolInput (1)", () => {
    const graph = testCase1();
    const elements = activatePoolsAndGates(graph);
    const poolGroups = cutAtPoolInput(elements);
    console.log(poolGroups);
    console.log((<Swap>graph.getElement("s0"))._getPipes());
    const poolGroupKeys = poolGroups.map(g => new Set(Object.keys(g)));
    expect(poolGroupKeys.length).toEqual(4);
    expect(poolGroupKeys).toContainEqual(new Set(["s0", "s0-p2"]));
    expect(poolGroupKeys).toContainEqual(new Set(["g0", "g1", "g0-g1", "g1-g0"]));
    expect(poolGroupKeys).toContainEqual(
      new Set(["c3", "c3-g3", "g3", "g3-p4", "p4", "p4-c3", "c4", "c4-c3"]),
    );
    expect(poolGroupKeys).toContainEqual(
      new Set([
        "p0",
        "p0-c0",
        "c0",
        "c0-g2",
        "g2",
        "g2-c1",
        "c1",
        "c1-p0",
        "p3",
        "p3-c1",
        "p1",
        "p1-c2",
        "p2",
        "p2-s0",
        "s0",
        "s0-c2",
        "c2",
        "c2-c1",
      ]),
    );
  });

  test("test cutByPoolInput (2)", () => {
    const graph = testCase2();
    const elements = activatePoolsAndGates(graph);
    const poolGroups = cutAtPoolInput(elements);
    const poolGroupKeys = poolGroups.map(g => new Set(Object.keys(g)));
    expect(poolGroupKeys).toContainEqual(new Set(["g0", "g1", "g0-g1", "g1-g0"]));
    expect(poolGroupKeys).toContainEqual(
      new Set(["c3", "c3-g3", "g3", "p4", "p4-c3", "c4", "c4-c3", "g3-c4"]),
    );
    expect(poolGroupKeys).toContainEqual(
      new Set(["p0", "p0-c0", "c0", "c0-g2", "g2", "g2-s0", "s0", "s0-p2"]),
    );
    expect(poolGroupKeys).toContainEqual(
      new Set(["p2", "p2-s0", "s0", "s0-c2", "p1", "p1-c2", "c2", "c2-c1", "p3", "p3-c1", "c1", "c1-p0"]),
    );
  });

  test("test cutByConverterOutput (1)", () => {
    const graph = testCase1();
    const elements = activatePoolsAndGates(graph);
    const poolGroups = cutAtPoolInput(elements);
    const subgroupsKeys = poolGroups
      .flatMap(g => cutAtConverterInput(g, false))
      .map(g => new Set(Object.keys(g)));
    expect(subgroupsKeys.length).toEqual(9);
    expect(subgroupsKeys).toContainEqual(new Set(["s0", "s0-p2"]));
    expect(subgroupsKeys).toContainEqual(new Set(["g0", "g1-g0", "g1", "g0-g1"]));
    expect(subgroupsKeys).toContainEqual(
      new Set(["p3", "p3-c1", "c0-g2", "g2", "c2-c1", "g2-c1", "c1"]),
    );
    expect(subgroupsKeys).toContainEqual(new Set(["c1-p0"]));
    expect(subgroupsKeys).toContainEqual(new Set(["p0", "p0-c0", "c0"]));
    expect(subgroupsKeys).toContainEqual(new Set(["p1", "p1-c2", "p2", "p2-s0", "s0", "s0-c2", "c2"]));
    expect(subgroupsKeys).toContainEqual(new Set(["c4"]));
    expect(subgroupsKeys).toContainEqual(new Set(["c4-c3", "p4", "p4-c3", "c3"]));
    expect(subgroupsKeys).toContainEqual(new Set(["c3-g3", "g3", "g3-p4"]));
  });

  test("test cutByConverterOutput (2)", () => {
    const graph = testCase2();
    const elements = activatePoolsAndGates(graph);
    const poolGroups = cutAtPoolInput(elements);
    const subgroupsKeys = poolGroups
      .flatMap(g => cutAtConverterInput(g, false))
      .map(g => new Set(Object.keys(g)));
    expect(subgroupsKeys.length).toEqual(8);
    expect(subgroupsKeys).toContainEqual(new Set(["p0", "p0-c0", "c0"]));
    expect(subgroupsKeys).toContainEqual(new Set(["c0-g2", "g2", "g2-s0", "s0", "s0-p2"]));
    expect(subgroupsKeys).toContainEqual(new Set(["p2", "p1", "p2-s0", "s0", "s0-c2", "p1-c2", "c2"]));
    expect(subgroupsKeys).toContainEqual(new Set(["c2-c1", "p3", "p3-c1", "c1"]));
    expect(subgroupsKeys).toContainEqual(new Set(["c1-p0"]));
    expect(subgroupsKeys).toContainEqual(new Set(["g0", "g1-g0", "g1", "g0-g1"]));
    expect(subgroupsKeys).toContainEqual(new Set(["p4", "p4-c3", "c4-c3", "c3"]));
    expect(subgroupsKeys).toContainEqual(new Set(["c3-g3", "g3", "g3-c4", "c4"]));
  });

  test("test subgroupOrders (1)", () => {
    const graph = testCase1();
    const elements = activatePoolsAndGates(graph);
    const poolGroups = cutAtPoolInput(elements);
    const compiledGraph: CompiledGraph = poolGroups.map(g => {
      const groups = cutAtConverterInput(g, false);
      return computeSubGroupOrders(graph, groups);
    });
    const group0 = compiledGraph.find(g => g.groups.length === 1);
    const group1 = compiledGraph.find(g => g.groups.length === 3);
    const group2 = compiledGraph.find(g => g.groups.length === 4);
    // no cyclic group
    expect(group0?.type).toEqual(ConverterGroupTypes.Ordered);
    expect(group1?.type).toEqual(ConverterGroupTypes.Ordered);
    expect(group2?.type).toEqual(ConverterGroupTypes.Ordered);
    // entry points
    expect(new Set(Object.values(group0!.entryPointsToGroup))).toEqual(new Set([new Set()]));
    expect(new Set(Object.values(group1!.entryPointsToGroup))).toEqual(
      new Set([new Set(["c4-c3", "p4-c3"]), new Set(["c3-g3"]), new Set([])]),
    );
    expect(new Set(Object.values(group2!.entryPointsToGroup))).toEqual(
      new Set([
        new Set(["p1-c2", "p2-s0"]),
        new Set(["p3-c1", "c0-g2", "c2-c1"]),
        new Set(["p0-c0"]),
        new Set(["c1-p0"]),
      ]),
    );
    if (group1?.type === ConverterGroupTypes.Ordered) {
      const groups = group1.groupExecutionOrder.map(o => group1.groups[o]);
      expect(groups.findIndex(g => "c4" in g!)).toBeLessThan(groups.findIndex(g => "c3" in g!));
    }
    if (group2?.type === ConverterGroupTypes.Ordered) {
      const groups = group2.groupExecutionOrder.map(o => group2.groups[o]);
      expect(groups.findIndex(g => "c0" in g!)).toBeLessThan(groups.findIndex(g => "g2" in g!));
      expect(groups.findIndex(g => "c2" in g!)).toBeLessThan(groups.findIndex(g => "c1" in g!));
    }
  });

  test("test subgroupOrders (2)", () => {
    const graph = testCase2();
    const elements = activatePoolsAndGates(graph);
    const poolGroups = cutAtPoolInput(elements);
    const compiledGraph: CompiledGraph = poolGroups.map(g => {
      const groups = cutAtConverterInput(g, false);
      return computeSubGroupOrders(graph, groups);
    });
    const group0 = compiledGraph.find(g => g.groups.length === 1);
    const group1 = compiledGraph.find(
      g => g.groups.length === 2 && g.type === ConverterGroupTypes.Ordered,
    );
    const group2 = compiledGraph.find(g => g.groups.length === 3);
    const group3 = compiledGraph.find(
      g => g.groups.length === 2 && g.type === ConverterGroupTypes.Cyclic,
    );
    expect(group0?.type).toEqual(ConverterGroupTypes.Ordered);
    expect(group1?.type).toEqual(ConverterGroupTypes.Ordered);
    expect(group2?.type).toEqual(ConverterGroupTypes.Ordered);
    expect(group3?.type).toEqual(ConverterGroupTypes.Cyclic);
    // entry points
    expect(new Set(Object.values(group0!.entryPointsToGroup))).toEqual(new Set([new Set()]));
    expect(new Set(Object.values(group1!.entryPointsToGroup))).toEqual(
      new Set([new Set(["p0-c0"]), new Set(["c0-g2"])]),
    );
    expect(new Set(Object.values(group2!.entryPointsToGroup))).toEqual(
      new Set([new Set(["p2-s0", "p1-c2"]), new Set(["c2-c1", "p3-c1"]), new Set(["c1-p0"])]),
    );
    expect(new Set(Object.values(group3!.entryPointsToGroup))).toEqual(
      new Set([new Set(["c4-c3", "p4-c3"]), new Set(["c3-g3"])]),
    );
    if (group1?.type === ConverterGroupTypes.Ordered) {
      const groups = group1.groupExecutionOrder.map(o => group1.groups[o]);
      expect(groups.findIndex(g => "c0" in g!)).toBeLessThan(groups.findIndex(g => "g2" in g!));
    }
    if (group2?.type === ConverterGroupTypes.Ordered) {
      const groups = group2.groupExecutionOrder.map(o => group2.groups[o]);
      expect(groups.findIndex(g => "c2" in g!)).toBeLessThan(groups.findIndex(g => "c1" in g!));
    }
  });

  test("test checkGraph API (1)", () => {
    const graph = new Graph();

    addDeadCycle(graph);
    expect(graph.checkGraph().type).toEqual(CheckResultType.NoError);

    addTestGraph(graph);
    expect(graph.checkGraph().type).toEqual(CheckResultType.NoError);

    addCyclicConverter(graph);
    expect(graph.checkGraph()).toEqual({
      type: CheckResultType.Warning,
      errorMsg: "found cyclic converters",
      cyclicConverters: [new Set(["c3", "c4"])],
    });

    graph.setGateOutputWeight("g3", "g3-c4", 0);
    expect(graph.checkGraph().type).toEqual(CheckResultType.NoError);
  });
});
