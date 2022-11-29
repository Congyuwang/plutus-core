import { BooleanFn, NumericFn, VariableScope } from "./formula";
import { min, sum } from "mathjs";

type Node = Pool | Gate | Converter;
type Element = Node | Edge;
type ElementId = string;
type Label = string;

/**
 * Pool, Gate, Converter types
 */
enum NodeType {
  Pool = "pool",
  Gate = "gate",
  Converter = "converter",
}

/**
 * Pool, Gate, Converter, Edge types
 */
enum ElementType {
  Pool = "pool",
  Gate = "gate",
  Converter = "converter",
  Edge = "edge",
}

/**
 * Check label validity of element labels.
 * Use the same standard as js variables.
 * @param label
 */
function isValidLabel(label: Label): boolean {
  return /^([a-zA-Z_$][a-zA-Z\d_$]*)$/.test(label);
}

function _checkLabelValidity(label: Label): Label {
  if (!isValidLabel(label))
    throw Error("`label` must follow javascript variable naming format");
  return label;
}

// Edges to connect nodes
interface Edge {
  readonly type: ElementType.Edge;
}

class Edge {
  readonly type = ElementType.Edge;
  readonly fromNode: ElementId;
  readonly toNode: ElementId;
  private condition: BooleanFn;
  private label: Label;
  private rate: number;

  /**
   * Edge constructor, not intended for direct use.
   * Use `Graph.addEdge()` instead.
   * @param label globally unique edge label
   * @param fromNode from which Node
   * @param toNode to which Node
   * @param rate default to 1, negative means unlimited rate.
   */
  constructor(label: Label, fromNode: ElementId, toNode: ElementId, rate = 1) {
    this.label = _checkLabelValidity(label);
    this.fromNode = fromNode;
    this.toNode = toNode;
    this.condition = new BooleanFn(["true"]);
    this.rate = rate >= 0 ? rate : -1;
  }

  getLabel(): Label {
    return this.label;
  }

  getRate(): number {
    return this.rate;
  }

  getCondition(): string {
    return this.condition.toString();
  }

  evaluateCondition(scope: VariableScope): boolean {
    return this.condition.evaluate(scope);
  }

  // label must follow valid js variable naming, else throw Error
  _setLabel(label: Label) {
    this.label = _checkLabelValidity(label);
  }

  /**
   * Negative value means unlimited rate.
   * Default value is 0.
   * @param rate new rate.
   */
  setRate(rate: number) {
    this.rate = rate >= 0 ? rate : -1;
  }

  setCondition(condition: string) {
    this.condition = BooleanFn.fromString(condition);
  }

  isUnlimited(): boolean {
    return this.rate < 0;
  }

  clone(): Edge {
    return new Edge(this.label, this.fromNode, this.toNode, this.rate);
  }

  static fromJson(json: any): Edge {
    const edge = new Edge("edge", "", "", 0);
    Object.assign(edge, json);
    edge.setCondition(json.condition);
    return edge;
  }
}

/**
 * Pools store and reproduce values.
 */
interface Pool {
  readonly type: ElementType.Pool;
}

class Pool {
  readonly type = ElementType.Pool;
  private label: Label;
  private action: NumericFn;
  private condition: BooleanFn;
  private state: number;
  private capacity: number;
  private fromEdge?: ElementId;
  private toEdge?: ElementId;

  constructor(arg: Label | Pool) {
    if (typeof arg === "string") {
      this.label = _checkLabelValidity(arg);
      this.action = NumericFn.fromString("x");
      this.condition = BooleanFn.fromString("true");
      this.state = 0;
      this.capacity = -1; // means infinite
    } else {
      this.label = arg.label;
      this.action = NumericFn.fromString(arg.action.toString());
      this.condition = BooleanFn.fromString(arg.condition.toString());
      this.state = arg.state;
      this.capacity = arg.capacity;
      this.fromEdge = arg.fromEdge;
      this.toEdge = arg.toEdge;
    }
  }

  getLabel(): Label {
    return this.label;
  }

  getAction(): string {
    return this.action.toString();
  }

  getCondition(): string {
    return this.condition.toString();
  }

  getState(): number {
    return this.state;
  }

  getCapacity(): number {
    return this.capacity;
  }

  _getInput(): ElementId | undefined {
    return this.fromEdge;
  }

  _getOutput(): ElementId | undefined {
    return this.toEdge;
  }

  /**
   * label must follow valid js variable naming
   * @param label
   */
  _setLabel(label: Label) {
    this.label = _checkLabelValidity(label);
  }

  /**
   * Might set multiline mathematical expression.
   * The last line of expressions will be used as the return value.
   * `x` represents the current state.
   *
   * Example: `setAction('y = x ^ 2\n y + 1')`, or:
   *    ```
   *    y = x ^ 2
   *    y + 1
   *    ```
   * This will return `x^2 + 1`
   * @param action
   */
  setAction(action: string) {
    this.action = NumericFn.fromString(action);
  }

  /**
   * Might set multiline mathematical expression.
   * The last expression should return a boolean value.
   *
   * Example: `'y=x^2 \n y==4'`, or:
   *    ```
   *    y = x ^ 2
   *    y == 4
   *    ```
   * This will return `x^2+1`
   * @param condition
   */
  setCondition(condition: string) {
    this.condition = BooleanFn.fromString(condition);
  }

  // return the actual number added to this pool
  _addToPool(delta: number): number {
    if (delta < 0) {
      throw Error("must add a non-negative number");
    }
    const oldState = this.state;
    this.setState(this.state + delta);
    return this.state - oldState;
  }

  // return the actual number subtracted from this pool
  _takeFromPool(amount: number): number {
    if (amount < 0) {
      throw Error("must subtract a non-negative number");
    }
    const oldState = this.state;
    this.setState(this.state - amount);
    return oldState - this.state;
  }

  /**
   * Set upper cap of state.
   * Negative capacity represents unlimited (might be limited by data type).
   * Truncate state immediately on capacity change.
   * @param capacity new capacity
   */
  setCapacity(capacity: number) {
    if (capacity < 0) {
      this.capacity = -1;
    } else {
      this.capacity = capacity;
      // truncate state
      if (this.state > this.capacity) {
        this.state = this.capacity;
      }
    }
  }

  _setInput(edgeId: ElementId) {
    this.fromEdge = edgeId;
  }

  _setOutput(edgeId: ElementId) {
    this.toEdge = edgeId;
  }

  _deleteInput() {
    this.fromEdge = undefined;
  }

  _deleteOutput() {
    this.toEdge = undefined;
  }

  /**
   * State update follows the following logic:
   * ```
   * if `state < 0`: set to 0;
   * else if `capacity < 0`: set to state;
   * else: set to `min(capacity, state)`
   * ```
   * @param state
   */
  setState(state: number) {
    this.state =
      this.capacity < 0
        ? Math.max(0, state)
        : Math.max(0, Math.min(this.capacity, state));
  }

  /**
   * Update state to next tick.
   * Provide scope for evaluating condition.
   * `x` will be added as the state of this node into conditional `scope`.
   * @param scope VariableScope to provide information for
   *              evaluating `condition expression`
   */
  _nextTick(scope: VariableScope) {
    // check condition
    scope.set("x", this.state);
    if (this.condition.evaluate(scope)) {
      this.setState(this.action.evaluate(scope));
    }
  }

  clone(): Pool {
    return new Pool(this);
  }

  static fromJson(json: any): Pool {
    const pool = new Pool("pool");
    Object.assign(pool, json);
    pool.condition = BooleanFn.fromString(json.condition);
    pool.action = NumericFn.fromString(json.action);
    return pool;
  }
}

// Gate to distribute between edges
interface Gate {
  readonly type: ElementType.Gate;
}

class Gate {
  readonly type = ElementType.Gate;
  private label: Label;
  private fromEdge?: ElementId;
  private condition: BooleanFn;
  private selectedToEdge?: ElementId;
  private readonly toEdges: { [key: ElementId]: number };

  constructor(arg: Label | Gate) {
    if (typeof arg === "string") {
      this.toEdges = {};
      this.condition = new BooleanFn(["true"]);
      this.label = _checkLabelValidity(arg);
    } else {
      this.label = arg.label;
      this.fromEdge = arg.fromEdge;
      this.condition = BooleanFn.fromString(arg.condition.toString());
      this.selectedToEdge = arg.selectedToEdge;
      this.toEdges = { ...arg.toEdges };
    }
  }

  getLabel(): Label {
    return this.label;
  }

  getCondition(): string {
    return this.condition.toString();
  }

  setCondition(condition: string) {
    this.condition = BooleanFn.fromString(condition);
  }

  evaluateCondition(scope: VariableScope): boolean {
    return this.condition.evaluate(scope);
  }

  _getInput(): ElementId | undefined {
    return this.fromEdge;
  }

  /**
   * Get the currently selected edge id.
   */
  _getOutput(): ElementId | undefined {
    return this.selectedToEdge;
  }

  /**
   * Get all output and their weights
   */
  _getOutputs(): { [key: ElementId]: number } {
    return this.toEdges;
  }

  /**
   * For public client, must use `Graph.setLabel()` api.
   * @param label
   */
  _setLabel(label: Label) {
    this.label = _checkLabelValidity(label);
  }

  _setInput(edgeId: ElementId) {
    this.fromEdge = edgeId;
  }

  // add another output or update weight of a certain output
  _setOutput(edgeId: ElementId, weight: number) {
    if (weight < 0) {
      throw Error("output weight must be >= 0");
    }
    this.toEdges[edgeId] = weight;
  }

  _deleteInput() {
    this.fromEdge = undefined;
  }

  _deleteOutput(id: ElementId) {
    delete this.toEdges[id];
  }

  /**
   * Update selected output element id
   * by random selection.
   */
  _nextTick() {
    this.selectedToEdge = this._randomSelect();
  }

  // return undefined if no outputs defined
  _randomSelect(): ElementId | undefined {
    const weights = [...Object.values(this.toEdges)];
    if (this.toEdges.length === 0 || sum(weights) === 0) {
      return undefined;
    }
    let i;
    for (i = 0; i < weights.length; i++) {
      weights[i] += weights[i - 1] || 0;
    }
    const random = Math.random() * weights[weights.length - 1];
    for (i = 0; i < weights.length; i++) {
      if (weights[i] > random) {
        break;
      }
    }
    return [...Object.keys(this.toEdges)][i];
  }

  clone(): Gate {
    return new Gate(this);
  }

  static fromJson(json: any): Gate {
    const gate = new Gate("gate");
    Object.assign(gate, json);
    gate.setCondition(json.condition);
    return gate;
  }
}

// Converter to convert tokens
interface Converter {
  readonly type: ElementType.Converter;
}

class Converter {
  readonly type = ElementType.Converter;
  private label: Label;
  private readonly fromEdges: { [key: ElementId]: boolean };
  private toEdge?: ElementId;
  private condition: BooleanFn;
  private readonly requiredInputPerUnit: { [key: ElementId]: number };
  private readonly buffer: { [key: ElementId]: number };

  constructor(arg: Label | Converter) {
    if (typeof arg === "string") {
      this.label = arg;
      this.fromEdges = {};
      this.condition = new BooleanFn(["true"]);
      this.requiredInputPerUnit = {};
      this.buffer = {};
    } else {
      this.label = arg.label;
      this.fromEdges = { ...arg.fromEdges };
      this.condition = BooleanFn.fromString(arg.condition.toString());
      this.requiredInputPerUnit = { ...arg.requiredInputPerUnit };
      this.buffer = { ...arg.buffer };
    }
  }

  // add new input element from edges
  _addToBuffer(elementId: ElementId, amount: number) {
    if (amount < 0) {
      throw Error("must add non-negative amount to element buffer");
    }
    const currentAmount = this.buffer[elementId] || 0;
    this.buffer[elementId] = currentAmount + amount;
  }

  getLabel(): Label {
    return this.label;
  }

  _getRequiredInputPerUnit(): { [key: ElementId]: number } {
    return this.requiredInputPerUnit;
  }

  /**
   * Return a copy of the converter buffer.
   */
  getBuffer(): { [key: ElementId]: number } {
    return { ...this.buffer };
  }

  /**
   * Add one more required element to produce one unit of
   * converted element.
   * @param elementId elementId representing the id.
   * @param value amount required.
   */
  _setRequiredInputPerUnit(elementId: ElementId, value: number) {
    if (value <= 0) {
      throw Error("must have positive element value requirement");
    }
    this.requiredInputPerUnit[elementId] = value;
  }

  _getInputs(): { [key: ElementId]: boolean } {
    return this.fromEdges;
  }

  _getOutput(): ElementId | undefined {
    return this.toEdge;
  }

  // label must follow valid js variable naming
  _setLabel(label: Label) {
    this.label = _checkLabelValidity(label);
  }

  _setInput(edgeId: ElementId) {
    this.fromEdges[edgeId] = true;
  }

  _setOutput(edgeId: ElementId) {
    this.toEdge = edgeId;
  }

  // Return the actual number subtracted from this pool.
  // Feed a scope for checking if the condition is satisfied.
  _takeFromState(amount: number, scope: VariableScope): number {
    if (amount < 0) {
      throw Error("must subtract a non-negative number");
    }
    const maxConvertable = this.maximumConvertable(scope);
    const taken = Math.min(amount, maxConvertable);
    this.consumeBuffer(taken);
    return taken;
  }

  deleteRequiredInputPerUnit(elementId: ElementId) {
    delete this.requiredInputPerUnit[elementId];
  }

  _deleteInput(edgeId: ElementId) {
    delete this.fromEdges[edgeId];
  }

  _deleteOutput() {
    this.toEdge = undefined;
  }

  /**
   * The maximum amount of output value that can be produced from
   * this `Converter`.
   *
   * @param scope the variable scope containing values for evaluating
   *        condition
   */
  maximumConvertable(scope: VariableScope): number {
    // must reach condition to convert
    if (!this.condition.evaluate(scope)) {
      return 0;
    }

    // compute units produced
    const ratio = [] as number[];
    for (const [id, value] of Object.entries(this.requiredInputPerUnit)) {
      if (!(id in this.buffer)) {
        // lack material
        return 0;
      }
      if (value > 0) {
        ratio.push(this.buffer[id]! / value);
      }
    }
    if (ratio.length === 0) {
      return 0;
    }
    return min(ratio);
  }

  clone(): Converter {
    return new Converter(this);
  }

  static fromJson(json: any): Converter {
    const converter = new Converter("converter");
    Object.assign(converter, json);
    converter.condition = BooleanFn.fromString(json.condition);
    return converter;
  }

  private consumeBuffer(unitsProduced: number) {
    if (unitsProduced <= 0) return;
    for (const [id, value] of Object.entries(this.requiredInputPerUnit)) {
      const inputConsumed = value * unitsProduced;
      this.buffer[id] = this.buffer[id]! - inputConsumed;
    }
  }
}

export {
  Pool,
  Gate,
  Edge,
  Converter,
  Element,
  ElementType,
  Node,
  NodeType,
  ElementId,
  isValidLabel,
  Label,
};
