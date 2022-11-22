import { VariableScope } from "../src/formula";

export default class MapScope implements VariableScope {
    innerMap: Map<string, any>;

    constructor(inner: Map<string, any>) {
        this.innerMap = inner;
    }

    static fromObj(obj: { [key: string]: number }): MapScope {
        return new MapScope(new Map(Object.entries(obj)));
    }

    get(name: string): object | undefined {
        return this.innerMap.get(name);
    }

    has(name: string): boolean {
        return this.innerMap.has(name);
    }

    keys(): Iterator<string> {
        return this.innerMap.keys();
    }

    set(name: string, value: any) {
        this.innerMap.set(name, value);
    }
}
