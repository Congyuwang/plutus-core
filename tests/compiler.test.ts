import { Graph } from "../src";
import {
    addCyclicConverter,
    addDeadCycle,
    addTestGraph,
    testCase1,
    testCase2,
} from "./testGraph";
import { CheckResultType } from "../src/graph";
import {
    activatePoolsAndGates,
    CompiledGraph,
    computeSubGroupOrders,
    cutAtConverterInput,
    cutAtPoolInput,
    ParallelGroupTypes,
} from "../src/compiler";

describe("test compiler module", () => {
    test("test activatePoolsAndGate (1)", () => {
        const graph = testCase1();
        expect(graph.elements.size).toEqual(31);
        const elements = activatePoolsAndGates(graph);
        expect(elements.size).toEqual(28);
    });

    test("test activatePoolsAndGate (2)", () => {
        const graph = testCase2();
        expect(graph.elements.size).toEqual(31);
        const elements = activatePoolsAndGates(graph);
        expect(elements.size).toEqual(28);
    });

    test("test cutByPoolInput (1)", () => {
        const graph = testCase1();
        const elements = activatePoolsAndGates(graph);
        const poolGroups = cutAtPoolInput(elements);
        const poolGroupKeys = poolGroups.map(g => new Set(g.keys()));
        expect(poolGroupKeys.length).toEqual(3);
        expect(poolGroupKeys).toContainEqual(
            new Set(["g0", "g1", "g0-g1", "g1-g0"])
        );
        expect(poolGroupKeys).toContainEqual(
            new Set([
                "c3",
                "c3-g3",
                "g3",
                "g3-p4",
                "p4",
                "p4-c3",
                "c4",
                "c4-c3",
            ])
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
                "p2-c2",
                "c2",
                "c2-c1",
            ])
        );
    });

    test("test cutByPoolInput (2)", () => {
        const graph = testCase2();
        const elements = activatePoolsAndGates(graph);
        const poolGroups = cutAtPoolInput(elements);
        const poolGroupKeys = poolGroups.map(g => new Set(g.keys()));
        expect(poolGroupKeys).toContainEqual(
            new Set(["g0", "g1", "g0-g1", "g1-g0"])
        );
        expect(poolGroupKeys).toContainEqual(
            new Set([
                "c3",
                "c3-g3",
                "g3",
                "p4",
                "p4-c3",
                "c4",
                "c4-c3",
                "g3-c4",
            ])
        );
        expect(poolGroupKeys).toContainEqual(
            new Set(["p0", "p0-c0", "c0", "c0-g2", "g2", "g2-p2"])
        );
        expect(poolGroupKeys).toContainEqual(
            new Set([
                "p2",
                "p2-c2",
                "p1",
                "p1-c2",
                "c2",
                "c2-c1",
                "p3",
                "p3-c1",
                "c1",
                "c1-p0",
            ])
        );
    });

    test("test cutByConverterOutput (1)", () => {
        const graph = testCase1();
        const elements = activatePoolsAndGates(graph);
        const poolGroups = cutAtPoolInput(elements);
        const subgroupsKeys = poolGroups
            .flatMap(g => cutAtConverterInput(g, false))
            .map(g => new Set(g.keys()));
        expect(subgroupsKeys.length).toEqual(8);
        expect(subgroupsKeys).toContainEqual(
            new Set(["g0", "g1-g0", "g1", "g0-g1"])
        );
        expect(subgroupsKeys).toContainEqual(
            new Set(["p3", "p3-c1", "c0-g2", "g2", "c2-c1", "g2-c1", "c1"])
        );
        expect(subgroupsKeys).toContainEqual(new Set(["c1-p0"]));
        expect(subgroupsKeys).toContainEqual(new Set(["p0", "p0-c0", "c0"]));
        expect(subgroupsKeys).toContainEqual(
            new Set(["p1", "p1-c2", "p2", "p2-c2", "c2"])
        );
        expect(subgroupsKeys).toContainEqual(new Set(["c4"]));
        expect(subgroupsKeys).toContainEqual(
            new Set(["c4-c3", "p4", "p4-c3", "c3"])
        );
        expect(subgroupsKeys).toContainEqual(new Set(["c3-g3", "g3", "g3-p4"]));
    });

    test("test cutByConverterOutput (2)", () => {
        const graph = testCase2();
        const elements = activatePoolsAndGates(graph);
        const poolGroups = cutAtPoolInput(elements);
        const subgroupsKeys = poolGroups
            .flatMap(g => cutAtConverterInput(g, false))
            .map(g => new Set(g.keys()));
        expect(subgroupsKeys.length).toEqual(8);
        expect(subgroupsKeys).toContainEqual(new Set(["p0", "p0-c0", "c0"]));
        expect(subgroupsKeys).toContainEqual(new Set(["c0-g2", "g2", "g2-p2"]));
        expect(subgroupsKeys).toContainEqual(
            new Set(["p2", "p1", "p2-c2", "p1-c2", "c2"])
        );
        expect(subgroupsKeys).toContainEqual(
            new Set(["c2-c1", "p3", "p3-c1", "c1"])
        );
        expect(subgroupsKeys).toContainEqual(new Set(["c1-p0"]));
        expect(subgroupsKeys).toContainEqual(
            new Set(["g0", "g1-g0", "g1", "g0-g1"])
        );
        expect(subgroupsKeys).toContainEqual(
            new Set(["p4", "p4-c3", "c4-c3", "c3"])
        );
        expect(subgroupsKeys).toContainEqual(
            new Set(["c3-g3", "g3", "g3-c4", "c4"])
        );
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
        expect(group0).not.toEqual(undefined);
        expect(group1).not.toEqual(undefined);
        expect(group2).not.toEqual(undefined);
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
            g => g.groups.length === 2 && g.type === ParallelGroupTypes.Ordered
        );
        const group2 = compiledGraph.find(g => g.groups.length === 3);
        const group3 = compiledGraph.find(
            g => g.groups.length === 2 && g.type === ParallelGroupTypes.Cyclic
        );
        expect(group0).not.toEqual(undefined);
        expect(group1).not.toEqual(undefined);
        expect(group2).not.toEqual(undefined);
        expect(group3).not.toEqual(undefined);
    });

    test("test checkGraph API (1)", () => {
        const graph = new Graph();
        addDeadCycle(graph);
        addTestGraph(graph);
        expect(graph.checkGraph().type).toEqual(CheckResultType.NoError);
        addCyclicConverter(graph);
        expect(graph.checkGraph()).toEqual({
            type: CheckResultType.Warning,
            errorMsg: "found cyclic converters",
            cyclicConverters: [new Set(["c3", "c4"])],
        });
    });
});
