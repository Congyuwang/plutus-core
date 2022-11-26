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

    test("test Pools loop", () => {
        const graph = new Graph();
        graph.addNode(NodeType.Pool, "p0", "p0");
        graph.addNode(NodeType.Pool, "p1", "p1");
        graph.addNode(NodeType.Pool, "p2", "p2");
        (<Pool>graph.getElement("p0")).setState(10);
        (<Pool>graph.getElement("p1")).setState(10);
        (<Pool>graph.getElement("p2")).setState(10);
        graph.addEdge("p0-p1", "p0", "p1", 1);
        graph.addEdge("p1-p2", "p1", "p2", 2);
        graph.addEdge("p2-p0", "p2", "p0", 3);
        let p0State = 10;
        let p1State = 10;
        let p2State = 10;
        for (let i = 0; i < 8; i++) {
            graph.nextTick();
            expect((<Pool>graph.getElement("p0")).getState()).toEqual(
                (p0State = p0State - 1 + 3)
            );
            expect((<Pool>graph.getElement("p1")).getState()).toEqual(
                (p1State = p1State - 2 + 1)
            );
            expect((<Pool>graph.getElement("p2")).getState()).toEqual(
                (p2State = p2State - 3 + 2)
            );
        }
        graph.nextTick();
        expect((<Pool>graph.getElement("p0")).getState()).toEqual(
            // 26
            (p0State = p0State - 1 + 2)
            // 27
        );
        expect((<Pool>graph.getElement("p1")).getState()).toEqual(
            // 2
            (p1State = p1State - 2 + 1)
            // 1
        );
        expect((<Pool>graph.getElement("p2")).getState()).toEqual(
            // 2
            (p2State = p2State - 2 + 2)
            // 2
        );
        graph.nextTick();
        expect((<Pool>graph.getElement("p0")).getState()).toEqual(
            // 27
            (p0State = p0State - 1 + 2)
            // 28
        );
        expect((<Pool>graph.getElement("p1")).getState()).toEqual(
            // 1
            (p1State = p1State - 1 + 1)
            // 1
        );
        expect((<Pool>graph.getElement("p2")).getState()).toEqual(
            // 2
            (p2State = p2State - 2 + 1)
            // 1
        );
        for (let i = 0; i < 5; i++) {
            graph.nextTick();
            expect((<Pool>graph.getElement("p0")).getState()).toEqual(p0State);
            expect((<Pool>graph.getElement("p1")).getState()).toEqual(p1State);
            expect((<Pool>graph.getElement("p2")).getState()).toEqual(p2State);
        }
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
