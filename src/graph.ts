import {
    Converter,
    Edge,
    Element,
    ElementId,
    ElementType,
    Gate,
    Label,
    Node,
    NodeType,
    Pool,
} from "./nodes";
import { VariableScope } from "./formula";

const DEFAULT_WEIGHT = 1;

class Graph {
    elements: Map<ElementId, Element>;
    labels: Map<Label, ElementId>;
    autoLabelCounter: {
        pool: number;
        gate: number;
        converter: number;
        edge: number;
    };

    constructor() {
        this.elements = new Map();
        this.labels = new Map();
        this.autoLabelCounter = {
            converter: 0,
            edge: 0,
            gate: 0,
            pool: 0,
        };
    }

    // C-Edge
    public connect(
        edgeId: ElementId,
        fromId: ElementId,
        toId: ElementId,
        label?: Label
    ) {
        const from = this.getElement(fromId);
        const to = this.getElement(toId);
        const labelName = label ? label : this.autoLabel(ElementType.Edge);
        if (!from || !to) {
            throw Error("connecting Node with non-existing id");
        }
        if (this.elements.has(edgeId)) {
            throw Error("edge id already exists");
        }
        // from.output = edge
        this.setNodeOutputToEdge(from, edgeId);
        // to.input = edge
        this.setNodeInputToEdge(to, edgeId);
        this.elements.set(edgeId, new Edge(labelName, fromId, toId));
        this.labels.set(labelName, edgeId);
    }

    // C-Node
    public addNode(type: NodeType, id: ElementId, label?: Label): Node {
        if (this.elements.has(id)) {
            throw Error("id already exists");
        }
        const labelName = label ? label : this.autoLabelNode(type);
        if (this.labels.has(labelName)) {
            throw Error("duplicate label");
        }
        let newElement;
        switch (type) {
            case NodeType.Pool:
                newElement = new Pool(labelName);
                break;
            case NodeType.Gate:
                newElement = new Gate(labelName);
                break;
            case NodeType.Converter:
                newElement = new Converter(labelName);
                break;
        }
        this.elements.set(id, newElement);
        this.labels.set(labelName, id);
        return newElement;
    }

    // R
    public getElement(id: ElementId): Element | undefined {
        return this.elements.get(id);
    }

    public getElementByLabel(label: Label): Element | undefined {
        const id = this.labels.get(label);
        if (!id) return undefined;
        return this.getElement(id);
    }

    public getStateByLabel(label: Label): number | undefined {
        const e = this.getElementByLabel(label);
        if (!e) return e;
        switch (e.type) {
            case ElementType.Pool:
                return e.getState();
            case ElementType.Edge:
                return e.getRate();
            case ElementType.Gate:
            case ElementType.Converter:
                return undefined;
        }
    }

    // U-label
    public setLabel(id: ElementId, label: Label): Element {
        // check that id exists
        const e = this.elements.get(id);
        if (!e) {
            throw new Error("id not found");
        }
        // check that new label is not duplicated
        if (this.labels.has(label)) {
            throw new Error(`label '${label}' already exists`);
        }
        this.labels.delete(e.getLabel());
        e._setLabel(label);
        this.labels.set(label, id);
        return e;
    }

    // D
    public deleteElement(id: ElementId) {
        const e = this.elements.get(id);
        if (!e) return;
        switch (e.type) {
            case ElementType.Pool:
                const poolInputEdge = e._getInput();
                if (poolInputEdge) {
                    this.deleteElement(poolInputEdge);
                }
                const poolOutputEdge = e._getOutput();
                if (poolOutputEdge) {
                    this.deleteElement(poolOutputEdge);
                }
                break;
            case ElementType.Converter:
                const converterOutputEdge = e._getOutput();
                if (converterOutputEdge) {
                    this.deleteElement(converterOutputEdge);
                }
                const converterInputEdges = e._getInputs();
                converterInputEdges.forEach(edgeId =>
                    this.deleteElement(edgeId)
                );
                break;
            case ElementType.Gate:
                const gateInputEdge = e._getInput();
                if (gateInputEdge) {
                    this.deleteElement(gateInputEdge);
                }
                const gateOutputEdges = e._getOutputs().keys();
                for (let edgeId of gateOutputEdges) {
                    this.deleteElement(edgeId);
                }
                break;
            case ElementType.Edge:
                const from = this.getElement(e.fromNode);
                const to = this.getElement(e.toNode);
                if (from) Graph.deleteNodeOutput(from, id);
                if (to) Graph.deleteNodeInput(to, id);
                break;
        }
        this.elements.delete(id);
        this.labels.delete(e.getLabel());
    }

    public variableScopes(): VariableScope {
        return new GraphVariableScope(this);
    }

    // node.output = edge.from
    private setNodeOutputToEdge(from: Element, edgeId: ElementId) {
        switch (from.type) {
            case ElementType.Edge:
                throw Error("edge must not start from `Edge`");
            case ElementType.Gate:
                from._setOutput(edgeId, DEFAULT_WEIGHT);
                break;
            default:
                // delete current output edge if Pool, Converter
                const currentOutputEdge = from._getOutput();
                if (currentOutputEdge) {
                    this.deleteElement(currentOutputEdge);
                }
                from._setOutput(edgeId);
                break;
        }
    }

    // node.input = edge.to
    private setNodeInputToEdge(to: Element, edgeId: ElementId) {
        switch (to.type) {
            case ElementType.Edge:
                throw Error("edge must not point to `Edge`");
            case ElementType.Pool:
            case ElementType.Gate:
                const currentOutputEdge = to._getInput();
                // delete current input edge if Pool, Gate
                if (currentOutputEdge) {
                    this.deleteElement(currentOutputEdge);
                }
                to._setInput(edgeId);
                break;
            case ElementType.Converter:
                to._setInput(edgeId);
                break;
        }
    }

    // delete an edge id from the outputs edges of a node
    private static deleteNodeOutput(from: Element, edgeId: ElementId) {
        switch (from.type) {
            case ElementType.Edge:
                throw Error(
                    "cannot delete output of edge (edge-edge connection not allowed)"
                );
            case ElementType.Gate:
                from._deleteOutput(edgeId);
                break;
            default:
                from._deleteOutput();
                break;
        }
    }

    // delete an edge id from the input edges of a node
    private static deleteNodeInput(to: Element, edgeId: ElementId) {
        switch (to.type) {
            case ElementType.Edge:
                throw Error(
                    "cannot delete output of edge (edge-edge connection not allowed)"
                );
            case ElementType.Converter:
                to._deleteInput(edgeId);
                break;
            default:
                to._deleteInput();
                break;
        }
    }

    // internal representation of labels of different types of nodes
    private autoLabelNode(type: NodeType): Label {
        return this.autoLabel(type as string as ElementType);
    }

    // internal representation of labels of different types of nodes
    private autoLabel(type: ElementType): Label {
        switch (type) {
            case ElementType.Pool:
                return `pool$${this.autoLabelCounter.pool++}`;
            case ElementType.Converter:
                return `converter$${this.autoLabelCounter.converter++}`;
            case ElementType.Gate:
                return `gate$${this.autoLabelCounter.gate++}`;
            case ElementType.Edge:
                return `edge$${this.autoLabelCounter.edge++}`;
        }
    }
}

// Newly generated variables are not written into Graph.
// They are stored only into the local cache in GraphVariableScope.
// Thus, the computation does not have side effects.
class GraphVariableScope implements VariableScope {
    private graph;
    private localCache: Map<Label, any>;

    constructor(graph: Graph) {
        this.graph = graph;
        this.localCache = new Map();
    }

    get(label: Label): any {
        const checkLocal = this.localCache.get(label);
        if (checkLocal) return checkLocal;
        return this.graph.getStateByLabel(label);
    }

    // always check localCache first
    has(label: Label): boolean {
        return !!this.get(label);
    }

    keys(): Iterator<Label> {
        const vars = new Set(this.localCache.keys());
        for (let label of this.graph.labels.keys()) {
            if (this.has(label)) {
                vars.add(label);
            }
        }
        return vars.keys();
    }

    set(label: Label, value: any): void {
        this.localCache.set(label, value);
    }
}

export { Graph };
