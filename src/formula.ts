import { all, BigNumber, create, EvalFunction, MathExpression } from "mathjs";

const math = create(all, {
    number: "BigNumber",
    precision: 32,
});

// a class where values of variables can be dynamically requested
interface VariableScope {
    get: (name: string) => object | undefined;
    set: (name: string, value: any) => void;
    has: (name: string) => boolean;
    keys: () => Iterator<string>;
}

// internal class for expression evaluation
class _Formula {
    functions: EvalFunction[];
    expression: MathExpression[];

    constructor(expressions: MathExpression[]) {
        this.expression = expressions;
        this.functions = math.compile(expressions);
    }

    // deserialize from string (not JSON)
    public static fromString(expression: string): _Formula {
        const lines = expression.split(/;\s*\n|[\n;]/);
        return new _Formula(lines.map(l => l.trim()).filter(l => l.length > 0));
    }

    public evaluate(scope: VariableScope): any {
        return this.functions.map(f => f.evaluate(scope));
    }

    // serialize to string (not JSON)
    public toString(): string {
        return this.expression.map(e => e.toString()).join("\n");
    }
}

// The last expression of NumericFn should evaluate to a number
class NumericFn extends _Formula {
    public static fromString(expression: string): NumericFn {
        const lines = expression.split(/;\s*\n|[\n;]/);
        return new NumericFn(
            lines.map(l => l.trim()).filter(l => l.length > 0)
        );
    }

    public evaluate(scope: VariableScope): number {
        const result = super.evaluate(scope);
        const lastOutput = result.pop();
        if (math.isBigNumber(lastOutput)) {
            return math.number(lastOutput);
        }
        if (typeof lastOutput === "number") {
            return lastOutput;
        }
        throw Error(`the last expression is expected to return a number`);
    }
}

// The last expression of BooleanFn should evaluate to a boolean value
class BooleanFn extends _Formula {
    public static fromString(expression: string): BooleanFn {
        const lines = expression.split(/;\s*\n|[\n;]/);
        return new BooleanFn(
            lines.map(l => l.trim()).filter(l => l.length > 0)
        );
    }

    public evaluate(scope: VariableScope): boolean {
        const result = super.evaluate(scope);
        const lastOutput = result.pop();
        if (typeof lastOutput !== "boolean") {
            throw Error(`the last expression is expected to return boolean`);
        }
        return lastOutput;
    }
}

export { math, _Formula, NumericFn, BooleanFn, VariableScope };
