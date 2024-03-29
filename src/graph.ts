import {
  Converter,
  Edge,
  Element,
  ElementId,
  ElementType,
  Gate,
  isValidLabel,
  Label,
  Node,
  NodeType,
  Pool,
  Swap,
  Token,
} from "./nodes";
import { math, VariableScope } from "./formula";
import { compileGraph, ConverterGroupTypes } from "./compiler";
import nextTick from "./executor";

export const DEFAULT_WEIGHT = 1;
export const DEFAULT_EDGE_RATE = 1;

export enum CheckResultType {
  NoError = "no error",
  Warning = "warning",
  Error = "error",
}

export type GraphCheckResult = GraphCheckError | GraphCheckWarning | GraphCheckNoError;

export type GraphCheckNoError = {
  type: CheckResultType.NoError;
};

export type GraphCheckWarning = {
  type: CheckResultType.Warning;
  errorMsg: string;
  cyclicConverters: Set<ElementId>[];
};

export type GraphCheckError = {
  type: CheckResultType.Error;
  errorMsg: string;
}

class Graph {
  // Mapping from globally unique ID to Edge | Node.
  elements: { [key: ElementId]: Element };
  // Mapping from globally unique labels to unique ID.
  labels: { [key: Label]: ElementId };
  // A counter for implementing automatic labelling.
  autoLabelCounter: {
    pool: number;
    gate: number;
    converter: number;
    edge: number;
    swap: number;
  };

  /**
   * Deep clone the graph use constructor `new Graph(graph)`.
   */
  constructor(graph?: Graph) {
    if (graph === undefined) {
      this.elements = {};
      this.labels = {};
      this.autoLabelCounter = {
        converter: 0,
        edge: 0,
        gate: 0,
        pool: 0,
        swap: 0,
      };
    } else {
      this.elements = {};
      Object.entries(graph.elements).forEach(([id, e]) => {
        this.elements[id] = e.clone();
      });
      this.labels = { ...graph.labels };
      this.autoLabelCounter = { ...graph.autoLabelCounter };
    }
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
   * @param rate default to 1, negative means unlimited.
   * @param label (optional) a globally unique label.
   *        If missing, use automatic labelling.
   * @param swapInputIndex when adding output to Swap edge,
   *        provide this information.
   * @return the newly created edge
   */
  public addEdge(
    edgeId: ElementId,
    fromId: ElementId,
    toId: ElementId,
    swapInputIndex?: number,
    rate = DEFAULT_EDGE_RATE,
    label?: Label,
  ): Edge {
    const from = this.getElement(fromId);
    const to = this.getElement(toId);
    const labelName = label !== undefined ? label : this.autoLabel(ElementType.Edge);
    if (from === undefined || to === undefined) {
      throw Error("connecting Node with non-existing id");
    }
    if (edgeId in this.elements) {
      throw Error("edge id already exists");
    }
    if (fromId === toId) {
      throw Error("cannot connect to self (self loop not allowed)");
    }
    // from.output = edge
    this.setNodeOutputToEdge(from, edgeId, swapInputIndex);
    // to.input = edge
    this.setNodeInputToEdge(to, edgeId, swapInputIndex);
    const edge = new Edge(labelName, fromId, toId, rate);
    this.elements[edgeId] = edge;
    this.labels[labelName] = edgeId;
    return edge;
  }

  /**
   * Add a new Node object to the Graph.
   * The indexes are updated automatically.
   * Labels must be globally unique.
   *
   * @param node
   * @param id
   */
  public addNodeObject(node: Node, id: ElementId) {
    if (id in this.elements) {
      throw Error("id already exists");
    }
    if (node.getLabel() in this.labels) {
      throw Error("duplicate label");
    }
    this.elements[id] = node;
    this.labels[node.getLabel()] = id;
  }

  /**
   * Add a new Node to the graph.
   * @param type `NodeType.Pool` | `NodeType.Converter` | `NodeType.Gate`,
   * @param id a globally unique element id.
   * @param label (Optional) a globally unique label.
   *        If missing, use automatic labelling.
   */
  public addNode(type: NodeType, id: ElementId, label?: Label): Node {
    if (id in this.elements) {
      throw Error("id already exists");
    }
    const labelName = label !== undefined ? label : this.autoLabelNode(type);
    if (labelName in this.labels) {
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
      case NodeType.Swap:
        newElement = new Swap(labelName);
        break;
    }
    this.elements[id] = newElement;
    this.labels[labelName] = id;
    return newElement;
  }

  public getElement(id: ElementId): Element | undefined {
    return this.elements[id];
  }

  public getIdByLabel(label: Label): ElementId | undefined {
    return this.labels[label];
  }

  public getLabelById(id: ElementId): Label | undefined {
    return this.elements[id]?.getLabel();
  }

  public getElementByLabel(label: Label): Element | undefined {
    const id = this.labels[label];
    if (id === undefined) return undefined;
    return this.getElement(id);
  }

  public getStateByLabel(label: Label): number | undefined {
    const e = this.getElementByLabel(label);
    if (e === undefined) return e;
    switch (e.type) {
      case ElementType.Pool:
        return e.getState();
      case ElementType.Edge:
        return e.getRate();
      default:
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
    // check label
    const e = this.validateLabel(id, label);
    delete this.labels[e.getLabel()];
    e._setLabel(label);
    this.labels[label] = id;
    return e;
  }

  /**
   * Check whether the set label operation is valid.
   * No write operation.
   */
  public validateLabel(id: ElementId, label: Label): Element {
    // check that id exists
    const e = this.elements[id];
    if (e === undefined) {
      throw Error("id not found");
    }
    // check that new label is not duplicated
    if (label in this.labels) {
      throw Error(`label '${label}' already exists`);
    }
    if (!isValidLabel(label)) {
      throw Error("`label` must follow javascript variable naming format");
    }
    return e;
  }

  /**
   * Add required element to converter.
   *
   * The internal remembers the required element using ElementID,
   * which is supposed to remain immutable, whereas the Label
   * might change.
   * @param converterId the id of the Converter.
   * @param inputId the id of the input element.
   *        Must be either `Pool` ot `Converter`.
   * @param amount the amount required. If (amount <= 0)
   *        this input requirement is removed.
   */
  public setConverterRequiredInputPerUnit(
    converterId: ElementId,
    inputId: ElementId,
    amount: number,
  ) {
    const converter = this.validateConverterRequiredInputPerUnit(converterId, inputId);
    if (amount > 0) {
      converter._setRequiredInputPerUnit(inputId, amount);
    } else {
      converter._deleteInput(inputId);
    }
  }

  /**
   * Validate required element to converter.
   *
   * Validate whether this is a valid input element for converter.
   * No actual change is made.
   * @param converterId the id of the Converter.
   * @param token the token of the input.
   */
  public validateConverterRequiredInputPerUnit(
    converterId: ElementId,
    token: Token,
  ): Converter {
    const converter = this.getElement(converterId);
    if (converter === undefined || converter.type !== ElementType.Converter) {
      throw Error("Selected element is not a converter");
    }
    const availableTokens = this.upStreamTokensOfConverter(converterId);
    Object.keys(converter._getRequiredInputPerUnit()).forEach(token => {
      if (!availableTokens.has(token)) {
        throw Error(`${token} not available`);
      }
    });
    return converter;
  }

  public upStreamTokensOfConverter(converterId: ElementId): Set<Token> {
    const converter = this.getElement(converterId);
    if (converter === undefined || converter.type !== ElementType.Converter) {
      throw Error("Selected element is not a converter");
    }
    const tokens: Set<Token> = new Set();
    const inputs = Object.keys(converter._getInputs());
    for (const edge of inputs) {
      this.upStreamTokenOf(edge).forEach(token => tokens.add(token));
    }
    return tokens;
  }

  private upStreamTokenOf(element: ElementId): Set<Token> {
    const e = this.getElement(element);
    const tokens: Set<Token> = new Set();
    switch (e?.type) {
      case ElementType.Converter:
      case ElementType.Pool: {
        // pool and converter returns output token
        tokens.add(e.getToken());
        break;
      }
      case ElementType.Gate: {
        const gateInput = e._getInput();
        if (gateInput !== undefined) {
          const gateTokens = this.upStreamTokenOf(gateInput);
          gateTokens.forEach(token => tokens.add(token));
        }
        break;
      }
      case ElementType.Edge: {
        const edgeTokens = this.upStreamTokenOf(e.fromNode);
        edgeTokens.forEach(token => tokens.add(token));
        break;
      }
    }
    return tokens;
  }

  /**
   * Adjust weights of the outputs of a gate.
   *
   * The internal remembers the required element using ElementID,
   * which is supposed to remain immutable, whereas the Label
   * might change.
   * @param gateId the id of the Gate
   * @param edgeId the id of the output Edge
   *               (must be an already-connected edge)
   * @param weight the weight to that output. (If weight < 0)
   *        the actual weight is set to 0.
   */
  public setGateOutputWeight(
    gateId: ElementId,
    edgeId: ElementId,
    weight: number = DEFAULT_WEIGHT,
  ) {
    const gate = this.validateGateOutputWeight(gateId, edgeId);
    gate._setOutput(edgeId, Math.max(0, weight));
  }

  public validateGateOutputWeight(
    gateId: ElementId,
    edgeId: ElementId,
    weight: number = DEFAULT_WEIGHT,
  ): Gate {
    const gate = this.getElement(gateId);
    if (gate === undefined || gate.type !== ElementType.Gate) {
      throw Error("Selected element is not a gate");
    }
    const edge = this.getElement(edgeId);
    if (edge?.type !== ElementType.Edge) {
      throw Error("the output element must be specified as an edge");
    }
    if (!(edgeId in gate._getOutputs())) {
      throw Error("the output edge is not connected to this gate");
    }
    if (weight < 0) {
      throw Error("output weight must be >= 0");
    }
    return gate;
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
   * @param id element deleted
   * @return ids of elements removed
   */
  public deleteElement(id: ElementId): ElementId[] {
    const deleted: ElementId[] = [];
    this.deleteElementInner(id, deleted);
    return deleted;
  }

  private deleteElementInner(id: ElementId, deleted: ElementId[]) {
    const e = this.elements[id];
    if (e === undefined) return;
    deleted.push(id);
    delete this.elements[id];
    delete this.labels[e.getLabel()];
    switch (e.type) {
      case ElementType.Pool: {
        const poolInputEdge = e._getInput();
        if (poolInputEdge !== undefined) {
          this.deleteElementInner(poolInputEdge, deleted);
        }
        const poolOutputEdge = e._getOutput();
        if (poolOutputEdge !== undefined) {
          this.deleteElementInner(poolOutputEdge, deleted);
        }
        break;
      }
      case ElementType.Converter: {
        const converterOutputEdge = e._getOutput();
        if (converterOutputEdge !== undefined) {
          this.deleteElementInner(converterOutputEdge, deleted);
        }
        const converterInputEdges = e._getInputs();
        Object.keys(converterInputEdges).forEach(edgeId =>
          this.deleteElementInner(edgeId, deleted),
        );
        break;
      }
      case ElementType.Gate: {
        const gateInputEdge = e._getInput();
        if (gateInputEdge !== undefined) {
          this.deleteElementInner(gateInputEdge, deleted);
        }
        const gateOutputEdges = Object.keys(e._getOutputs());
        for (const edgeId of gateOutputEdges) {
          this.deleteElementInner(edgeId, deleted);
        }
        break;
      }
      case ElementType.Edge: {
        const from = this.getElement(e.fromNode);
        const to = this.getElement(e.toNode);
        if (from !== undefined) Graph.deleteNodeOutput(from, id);
        if (to !== undefined) Graph.deleteNodeInput(to, id);
        break;
      }
      case ElementType.Swap: {
        for (const [pipeIn, pipeOut] of e._getPipes()) {
          if (pipeIn !== undefined) this.deleteElementInner(pipeIn, deleted);
          if (pipeOut !== undefined) this.deleteElementInner(pipeOut, deleted);
        }
        break;
      }
    }
  }

  /**
   * Return a VariableScope object for `mathjs` expressions.
   * See `GraphVariableScope` for details.
   */
  public variableScope(): VariableScope {
    return new GraphVariableScope(this);
  }

  /**
   * Compute the next tick state of the graph.
   *
   * call checkGraph() before calling nextTick!
   */
  public nextTick() {
    nextTick(this);
  }

  /**
   * Check whether the graph has any error or warnings.
   */
  public checkGraph(): GraphCheckResult {
    try {
      Object.values(this.elements).forEach(e => {
        if (e.type === ElementType.Swap) {
          e.validateSwapConfig();
        }
      });
    } catch (err) {
      return {
        type: CheckResultType.Error,
        errorMsg: `${err}`,
      };
    }
    const compiledGraph = compileGraph(this, true);
    const cyclicConverters: Set<ElementId>[] = [];
    compiledGraph.forEach(g => {
      if (g.type === ConverterGroupTypes.Cyclic) {
        cyclicConverters.push(new Set(Object.values(g.converterOfGroup)));
      }
    });
    if (cyclicConverters.length > 0) {
      return {
        type: CheckResultType.Warning,
        errorMsg: "found cyclic converters",
        cyclicConverters,
      };
    } else {
      return {
        type: CheckResultType.NoError,
      };
    }
  }

  public clone(): Graph {
    return new Graph(this);
  }

  public static fromJSON(json: object): Graph {
    const graph = new Graph();
    Object.assign(graph, json);
    Object.entries(graph.elements).forEach(([id, e]) => {
      switch (e.type) {
        case ElementType.Edge:
          graph.elements[id] = Edge.fromJson(e);
          break;
        case ElementType.Converter:
          graph.elements[id] = Converter.fromJson(e);
          break;
        case ElementType.Pool:
          graph.elements[id] = Pool.fromJson(e);
          break;
        case ElementType.Gate:
          graph.elements[id] = Gate.fromJson(e);
          break;
      }
    });
    return graph;
  }

  // node.output = edge.from
  private setNodeOutputToEdge(
    from: Element,
    edgeId: ElementId,
    swapInputIndex?: number,
  ) {
    switch (from.type) {
      case ElementType.Edge: {
        throw Error("edge must not start from `Edge`");
      }
      case ElementType.Gate: {
        from._setOutput(edgeId, DEFAULT_WEIGHT);
        break;
      }
      case ElementType.Swap: {
        if (swapInputIndex === undefined) {
          throw Error("missing swap input index");
        }
        const pipe = from._getOrCreatePipe(swapInputIndex);
        const [_, pipe_out] = pipe;
        if (pipe_out !== undefined) {
          this.deleteElement(pipe_out);
        }
        pipe[1] = edgeId;
        break;
      }
      default: {
        // delete current output edge if Pool, Converter
        const currentOutputEdge = from._getOutput();
        if (currentOutputEdge !== undefined) {
          this.deleteElement(currentOutputEdge);
        }
        from._setOutput(edgeId);
        break;
      }
    }
  }

  // node.input = edge.to
  private setNodeInputToEdge(
    to: Element,
    edgeId: ElementId,
    swapInputIndex?: number,
  ) {
    switch (to.type) {
      case ElementType.Edge: {
        throw Error("edge must not point to `Edge`");
      }
      case ElementType.Pool:
      case ElementType.Gate: {
        const currentOutputEdge = to._getInput();
        // delete current input edge if Pool, Gate
        if (currentOutputEdge !== undefined) {
          this.deleteElement(currentOutputEdge);
        }
        to._setInput(edgeId);
        break;
      }
      case ElementType.Swap: {
        if (swapInputIndex === undefined) {
          throw Error("missing swap input index");
        }
        const pipe = to._getOrCreatePipe(swapInputIndex);
        const [pipe_in, _] = pipe;
        if (pipe_in !== undefined) {
          this.deleteElement(pipe_in);
        }
        pipe[0] = edgeId;
        break;
      }
      default: {
        to._setInput(edgeId);
        break;
      }
    }
  }

  // delete an edge id from the outputs edges of a node
  private static deleteNodeOutput(from: Element, edgeId: ElementId) {
    switch (from.type) {
      case ElementType.Edge:
        throw Error("cannot delete output of edge (edge-edge connection not allowed)");
      default:
        from._deleteOutput(edgeId);
        break;
    }
  }

  // delete an edge id from the input edges of a node
  private static deleteNodeInput(to: Element, edgeId: ElementId) {
    switch (to.type) {
      case ElementType.Edge:
        throw Error("cannot delete output of edge (edge-edge connection not allowed)");
      default:
        to._deleteInput(edgeId);
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
      case ElementType.Swap:
        return `swap$${this.autoLabelCounter.swap++}`;
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
  private readonly graph;
  private readonly localCache: { [key: Label]: any };

  constructor(graph: Graph) {
    this.graph = graph;
    this.localCache = {};
  }

  get(label: Label): any {
    const checkLocal = this.localCache[label];
    if (checkLocal !== undefined) {
      return floatToBigNumber(checkLocal);
    }
    const fromGraph = this.graph.getStateByLabel(label);
    if (fromGraph !== undefined) {
      this.localCache[label] = fromGraph;
    }
    return floatToBigNumber(fromGraph);
  }

  // always check localCache first
  has(label: Label): boolean {
    return this.get(label) !== undefined;
  }

  keys(): Iterator<Label> {
    const vars = new Set(Object.keys(this.localCache));
    for (const label of Object.keys(this.graph.labels)) {
      if (this.has(label)) {
        vars.add(label);
      }
    }
    return vars.keys();
  }

  set(label: Label, value: any): void {
    this.localCache[label] = value;
  }
}

function floatToBigNumber(value: any) {
  if (typeof value === "number") {
    return math.bignumber(value);
  }
  return value;
}

export { Graph };
