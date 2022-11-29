import { math, _Formula, NumericFn, BooleanFn } from "../src/formula";
import MapScope from "./utils";

describe("test formula", () => {
  test("formula output should be 5, while x get updated to 2", () => {
    const scope = new MapScope(new Map([["x", 1]]));
    const formula = new _Formula(["x = x + 1", "y = 5"]);
    expect(formula.evaluate(scope)).toEqual([
      math.bignumber(2),
      math.bignumber(5),
    ]);
    expect(scope.get("x")).toEqual(math.bignumber(2));
  });

  test("boolean output should be true", () => {
    const scope = new MapScope(new Map([["x", 5]]));
    const formula = new _Formula(["x = x + 1", "y = 5", "y == x-1"]);
    expect(formula.evaluate(scope)).toEqual([
      math.bignumber(6),
      math.bignumber(5),
      true,
    ]);
    expect(scope.get("x")).toEqual(math.bignumber(6));
  });

  test("formula output should be 6", () => {
    const scope = new MapScope(new Map([["x", 5]]));
    const formula = new NumericFn(["x = x + 1", "y = 5", "x"]);
    expect(formula.evaluate(scope)).toEqual(6);
  });

  test("test to string and from string", () => {
    const scope = new MapScope(new Map([["x", 5]]));
    const formula = _Formula.fromString(
      "z=2; x=x+1; \ny$pool_state=5;y$pool_state==x-1"
    );
    expect(formula.evaluate(scope)).toEqual([
      math.bignumber(2),
      math.bignumber(6),
      math.bignumber(5),
      true,
    ]);
    expect(scope.get("x")).toEqual(math.bignumber(6));
    expect(formula.toString()).toEqual(
      "z=2\nx=x+1\ny$pool_state=5\ny$pool_state==x-1"
    );
  });

  test("formula output should be true", () => {
    const scope = new MapScope(new Map([["_x1", 1]]));
    const formula = new BooleanFn([
      "_x1 = (_x1 + 1) ^ 2",
      "y = 5",
      "_x1 == y - 1",
    ]);
    expect(formula.evaluate(scope)).toEqual(true);
  });

  test("test to string and from string", () => {
    const scope = new MapScope(new Map([["_1", 1]]));
    const formula = BooleanFn.fromString(
      "_1 = (_1 + 1) ^ 2\ny = 5\n_1 == y - 1"
    );
    expect(formula.evaluate(scope)).toEqual(true);
    expect(formula.toString()).toEqual("_1 = (_1 + 1) ^ 2\ny = 5\n_1 == y - 1");
  });
});
