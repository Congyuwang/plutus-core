import { mergeOutputs, Packet } from "../src/executor";
import { ElementId, Graph, NodeType, Pool } from "../src";

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
            expect((<Pool>graph.getElement("p0")).getState()).toEqual(
                p0State--
            );
            expect((<Pool>graph.getElement("p1")).getState()).toEqual(
                p1State++
            );
            graph.nextTick();
        }
    });

    test("test two pools unlimited rate", () => {
        const graph = new Graph();
        graph.addNode(NodeType.Pool, "p0", "p0");
        graph.addNode(NodeType.Pool, "p1", "p1");
        (<Pool>graph.getElement("p0")).setState(10);
        graph.addEdge("p0-p1", "p0", "p1", -1);
        expect((<Pool>graph.getElement("p0")).getState()).toEqual(10);
        expect((<Pool>graph.getElement("p1")).getState()).toEqual(0);
        graph.nextTick();
        expect((<Pool>graph.getElement("p0")).getState()).toEqual(0);
        expect((<Pool>graph.getElement("p1")).getState()).toEqual(10);
        graph.nextTick();
        expect((<Pool>graph.getElement("p0")).getState()).toEqual(0);
        expect((<Pool>graph.getElement("p1")).getState()).toEqual(10);
    });

    test("test two pools with a gate", () => {});
});

describe("test executor utility functions", () => {
    test("test output merger", () => {
        const allOutputs: Map<ElementId, Packet[]> = new Map([
            [
                "converter$0",
                [
                    { from: "pool$0", value: 1 },
                    { from: "converter$1", value: 2 },
                ],
            ],
            ["pool$0", [{ from: "pool$2", value: 3.5 }]],
        ]);
        const newOutput: Map<ElementId, Packet[]> = new Map([
            ["converter$0", [{ from: "pool$3", value: 2.5 }]],
            ["pool$3", [{ from: "converter$5", value: 1.5 }]],
        ]);
        mergeOutputs(allOutputs, newOutput);
        expect(allOutputs).toEqual(
            new Map([
                [
                    "converter$0",
                    [
                        { from: "pool$0", value: 1 },
                        { from: "converter$1", value: 2 },
                        { from: "pool$3", value: 2.5 },
                    ],
                ],
                ["pool$0", [{ from: "pool$2", value: 3.5 }]],
                ["pool$3", [{ from: "converter$5", value: 1.5 }]],
            ])
        );
    });
});
