import { Pool, Gate, Converter, Edge } from "../src";
import { gof } from "chi-sq-test";
import { sum } from "mathjs";
import MapScope from "./utils";

describe("test Pool", () => {
    test("test Pool state", () => {
        const pool = new Pool("label0");
        pool.setState(2);
        expect(pool.getLabel()).toEqual("label0");
        pool.setAction("x ^ 2");
        expect(pool.getState()).toEqual(2);
        pool._nextTick(MapScope.fromObj({}));
        expect(pool.getState()).toEqual(4);
        pool._nextTick(MapScope.fromObj({}));
        expect(pool.getState()).toEqual(16);

        // cap at condition `x < upper_bound`
        pool.setAction("x * 2");
        pool.setCondition("x< upper_bound");
        expect(pool.getAction()).toEqual("x * 2");
        expect(pool.getCondition()).toEqual("x< upper_bound");

        pool._nextTick(MapScope.fromObj({ upper_bound: 100 }));
        expect(pool.getState()).toEqual(32);
        pool._nextTick(MapScope.fromObj({ upper_bound: 100 }));
        expect(pool.getState()).toEqual(64);
        pool._nextTick(MapScope.fromObj({ upper_bound: 100 }));
        expect(pool.getState()).toEqual(128);
        pool._nextTick(MapScope.fromObj({ upper_bound: 100 }));
        expect(pool.getState()).toEqual(128);
        pool._nextTick(MapScope.fromObj({ upper_bound: 100 }));
        expect(pool.getState()).toEqual(128);

        pool._nextTick(MapScope.fromObj({ upper_bound: 200 }));
        expect(pool.getState()).toEqual(256);

        // set capacity
        pool.setCapacity(100);
        expect(pool.getCapacity()).toEqual(100);
        expect(pool.getState()).toEqual(100);
        pool._nextTick(MapScope.fromObj({ upper_bound: 200 }));
        expect(pool.getState()).toEqual(100);

        // add and subtract
        expect(pool._takeFromPool(20)).toEqual(20);
        expect(pool.getState()).toEqual(80);
        expect(pool._addToPool(100)).toEqual(20);
        expect(pool.getState()).toEqual(100);
        pool.setCapacity(150);
        expect(pool._addToPool(100)).toEqual(50);
        expect(pool._takeFromPool(200)).toEqual(150);
        expect(pool.getState()).toEqual(0);
    });
});

describe("test Gate", () => {
    test("test Gate operations", () => {
        const gate = new Gate("gate0");
        expect(gate.getLabel()).toEqual("gate0");
        // test invalid label
        expect(() => gate._setLabel("bad label")).toThrow(
            Error("`label` must follow javascript variable naming format")
        );
        expect(() => gate._setLabel("5_gates")).toThrow(
            Error("`label` must follow javascript variable naming format")
        );
        gate._setLabel("new_label");
        expect(gate.getLabel()).toEqual("new_label");
        gate._setInput("12345");
        expect(gate._getInput()).toEqual("12345");
    });

    test("test Gate distribution", () => {
        const gate = new Gate("gate0");
        const weightMap = new Map([
            ["1", 1],
            ["2", 2.5],
            ["3", 1],
            ["4", 0.3],
            ["5", 0.7],
        ]);

        // test _setOutput, _deleteOutput
        for (const [id, weight] of weightMap) {
            gate._setOutput(id, weight);
        }
        gate._setOutput("6", 10);
        gate._deleteOutput("6");
        expect(gate._getOutputs()).toEqual(weightMap);
        expect(() => gate._setOutput("bad-weight", -1)).toThrow(
            Error("output weight must be >= 0")
        );

        // test distributions p-value of Chi-Squared > 0.05
        const stats = new Map();
        for (const k of weightMap.keys()) {
            stats.set(k, 0);
        }
        const ROUND = 100000;
        const sumOfWeights = sum(...weightMap.values());
        const expected = [...weightMap.values()].map(
            w => (w * ROUND) / sumOfWeights
        );
        for (let i = 0; i < ROUND; i++) {
            const selected = gate._randomSelect();
            stats.set(selected, stats.get(selected) + 1);
        }
        const { pValue } = gof([...stats.values()], expected);
        expect(pValue).toBeGreaterThan(0.05);
    });
});

describe("test Edge", () => {
    test("test Edge Operations", () => {
        const edge = new Edge("edge0", "n0", "n1");
        expect(edge.getRate()).toEqual(0);
        edge.setRate(2);
        expect(edge.getRate()).toEqual(2);
        edge.setRate(-2);
        expect(edge.getRate()).toEqual(-1);
    });
});

describe("test Converter", () => {
    test("test Converter operations", () => {
        const converter = new Converter("converter0");
        converter._setInput("1");
        converter._setInput("2");
        converter._setInput("3");
        converter._setInput("4");
        converter._deleteInput("2");
        expect(converter._getInputs()).toEqual(new Set(["1", "3", "4"]));
        // test output operations
        expect(converter._getOutput()).toBeUndefined();
        converter._setOutput("10");
        expect(converter._getOutput()).toEqual("10");
        converter._deleteOutput();
        expect(converter._getOutput()).toBeUndefined();
    });

    test("test Converter requirements", () => {
        const converter = new Converter("converter0");
        converter._setRequiredInputPerUnit("001", 2);
        converter._setRequiredInputPerUnit("002", 4);
        converter._setRequiredInputPerUnit("003", 8);
        converter._setRequiredInputPerUnit("004", 16);
        converter.deleteRequiredInputPerUnit("002");
        expect(converter._getRequiredInputPerUnit()).toEqual(
            new Map([
                ["001", 2],
                ["003", 8],
                ["004", 16],
            ])
        );
        converter._addToBuffer("001", 14);
        converter._addToBuffer("003", 4);
        expect(converter.maximumConvertable(MapScope.fromObj({}))).toEqual(0);
        converter._addToBuffer("004", 100);
        expect(converter._takeFromState(10, MapScope.fromObj({}))).toEqual(0.5);
        expect(converter.getBuffer()).toEqual(
            new Map([
                ["001", 13],
                ["003", 0],
                ["004", 92],
            ])
        );
        converter._addToBuffer("003", 16);
        expect(converter.maximumConvertable(MapScope.fromObj({}))).toEqual(2);
        expect(converter._takeFromState(1, MapScope.fromObj({}))).toEqual(1);
        expect(converter.getBuffer()).toEqual(
            new Map([
                ["001", 11],
                ["003", 8],
                ["004", 76],
            ])
        );
    });
});
