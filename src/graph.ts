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
import { compileGraph, ParallelGroupTypes } from "./compiler";
import nextTick from "./runner";

export const DEFAULT_WEIGHT = 1;

export enum CheckResultType {
    NoError,
    Warning,
}

export type GraphCheckResult = GraphCheckWarningResult | GraphCheckNoError;

export type GraphCheckNoError = {
    type: CheckResultType.NoError;
};

export type GraphCheckWarningResult = {
    type: CheckResultType.Warning;
    cyclicConverters: Set<ElementId>[];
};

class Graph {
    // Mapping from globally unique ID to Edge | Node.
    elements: Map<ElementId, Element>;
    // Mapping from globally unique labels to unique ID.
    labels: Map<Label, ElementId>;
    // A counter for implementing automatic labelling.
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

    /**
     * Create an edge between two different Nodes.
     * This is the only right way to add edge to this graph.
     *
     * ## Specific behavior
     *
     * The method checks that the fromId, and toId must exist,
     * and that they do not correspond to Edges,
     * but Nodes (Pool | Converter | etc. ).
     *
     * When connecting an edge which conflicts with existing edge
     * (i.e., connecting to a Pool which already has an edge connected to it),
     * the method will delete the old edge.
     *
     * @param edgeId the id of the edge, must be different from existing ids
     * @param fromId from which Node
     * @param toId to which Node
     * @param label (optional) a globally unique label.
     *        If missing, use automatic labelling.
     */
    public addEdge(
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

    /**
     * Add a new Node to the graph.
     * @param type `NodeType.Pool` | `NodeType.Converter` | `NodeType.Gate`,
     * @param id a globally unique element id.
     * @param label (Optional) a globally unique label.
     *        If missing, use automatic labelling.
     */
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

    /**
     * This method updates label of an existing element.
     *
     * It updates both the label index (i.e., deletes the old label, and
     * adds the new label), and the element label fields.
     *
     * @param id the id of the element
     * @param label the label of the element
     */
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

    /**
     * Add required element to converter (using Label).
     *
     * The internal remembers the required element using ElementID,
     * which is supposed to remain immutable, whereas the Label
     * might change.
     */
    public setConverterRequiredInputPerUnit(
        id: ElementId,
        label: Label,
        amount: number
    ) {
        const converter = this.getElement(id);
        if (!converter || converter.type !== ElementType.Converter) {
            throw Error("Selected element is not a converter");
        }
        const requiredId = this.labels.get(label);
        if (!requiredId) {
            throw Error(`label '${label}' does not exist`);
        }
        converter._setRequiredInputPerUnit(requiredId, amount);
    }

    public getConverterRequiredInputPerUnit(id: ElementId): Map<Label, number> {
        const converter = this.getElement(id);
        if (!converter || converter.type !== ElementType.Converter) {
            throw Error("Selected element is not a converter");
        }
        const returnMap: Map<Label, number> = new Map();
        const requiredInput = converter._getRequiredInputPerUnit();
        for (const [id, requirement] of requiredInput) {
            const label = this.getElement(id);
            if (label) {
                returnMap.set(label.getLabel(), requirement);
            } else {
                // remove invalid input entries
                requiredInput.delete(id);
            }
        }
        return returnMap;
    }

    /**
     * Delete an element.
     *
     * ## Specific Behavior
     *
     * ### General
     * The delete methods keeps all data consistency.
     * It clears up ElementId index and label index.
     * It clears up associated edges (dangling edges are not allowed).
     * It clears up all input / output linking fields (no dangling reference).
     *
     * ### Edge
     * When deleting an edge, also unset the input / output fields
     * of connected Nodes (if any).
     *
     * ### Nodes
     * When deleting a node, also delete all associated edges to that node,
     * and unset all related input / output linking fields of those edges.
     *
     * @param id
     */
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
                for (const edgeId of gateOutputEdges) {
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

    /**
     * Return a VariableScope object for `mathjs` expressions.
     * See `GraphVariableScope` for details.
     */
    public variableScope(): VariableScope {
        return new GraphVariableScope(this);
    }

    /**
     * Compute the next tick state of the graph
     */
    public async nextTick() {
        await nextTick(this);
    }

    /**
     * Check whether the graph has any error or warnings.
     */
    public async checkGraph(): Promise<GraphCheckResult> {
        const compiledGraph = await compileGraph(this, true);
        const cyclicConverters: Set<ElementId>[] = [];
        compiledGraph.forEach(g => {
            if (g.type === ParallelGroupTypes.Cyclic) {
                cyclicConverters.push(new Set(g.converterOfGroup.values()));
            }
        });
        if (cyclicConverters.length > 0) {
            return {
                type: CheckResultType.Warning,
                cyclicConverters,
            };
        } else {
            return {
                type: CheckResultType.NoError,
            };
        }
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

/**
 * The Graph Variable Scope provides `mathjs` package
 * a usable variable query interface to `mathjs` expression evaluation.
 *
 * It indexes states of the graph using element Labels.
 * Specifically, `Pool.state` by Pool labels, and `Edge.rate` by Edge labels.
 *
 * It also serves as a cache storage for intermediate variables during `mathjs`
 * computation.
 *
 * It does not have side effect to graph variables (i.e., you cannot
 * alter the value of some `Pool.state` simply by assigning it a new value
 * in `mathjs` expressions). In that case, a temporary variable is created
 * and stored in `GraphVariableScope.localCache`.
 *
 * Readings prioritize `GraphVariableScope.localCache` over `Graph` states.
 *
 * All writings write to `GraphVariableScope.localCache`.
 */
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
        for (const label of this.graph.labels.keys()) {
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
