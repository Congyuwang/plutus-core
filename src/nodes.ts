import { BooleanFn, NumericFn, VariableScope } from "./formula";
import { min, sum } from "mathjs";

type Node = Pool | Gate | Converter | Swap;
type Element = Node | Edge;
type ElementId = string;
type Label = string;
type Token = string;

/**
 * Pool, Gate, Converter types
 */
enum NodeType {
  Pool = "pool",
  Gate = "gate",
  Converter = "converter",
  Swap = "swap",
}

/**
 * Pool, Gate, Converter, Edge types
 */
enum ElementType {
  Pool = "pool",
  Gate = "gate",
  Converter = "converter",
  Swap = "swap",
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

function isValidToken(token: Token): boolean {
  return /^([a-zA-Z_$][a-zA-Z\d_$]*)$/.test(token);
}

function _checkLabelValidity(label: Label): Label {
  if (!isValidLabel(label)) throw Error("`label` must follow javascript variable naming format");
  return label;
}

function _checkTokenValidity(token: Token): Token {
  if (!isValidToken(token)) throw Error("`token` must follow javascript variable naming format");
  return token;
}

function defaultToken(label: Label): Token {
  return `${label}_token`;
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
// interface Pool {
//   readonly type: ElementType.Pool;
// }

class Pool {
  readonly type = ElementType.Pool;
  private label: Label;
  private token: Token;
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
      this.condition = new BooleanFn(["true"]);
      this.token = defaultToken(this.label);
      this.state = 0;
      this.capacity = -1; // means infinite
    } else {
      this.label = arg.label;
      this.action = NumericFn.fromString(arg.action.toString());
      this.condition = BooleanFn.fromString(arg.condition.toString());
      this.state = arg.state;
      this.token = arg.token;
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

  getToken(): Token {
    return this.token;
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

  _setToken(token: Token) {
    this.token = _checkTokenValidity(token);
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
      this.capacity < 0 ? Math.max(0, state) : Math.max(0, Math.min(this.capacity, state));
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
    pool.setCondition(json.condition);
    pool.setAction(json.action);
    return pool;
  }
}

// Gate to distribute between edges
// interface Gate {
//   readonly type: ElementType.Gate;
// }

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
    const random = Math.random() * weights[weights.length - 1]!;
    for (i = 0; i < weights.length; i++) {
      if (weights[i]! > random) {
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
// interface Converter {
//   readonly type: ElementType.Converter;
// }

class Converter {
  readonly type = ElementType.Converter;
  private label: Label;
  private token: Token;
  private readonly fromEdges: { [key: ElementId]: boolean };
  private toEdge?: ElementId;
  private condition: BooleanFn;
  private readonly requiredInputPerUnit: { [key: Token]: number };
  private readonly buffer: { [key: Token]: number };

  constructor(arg: Label | Converter) {
    if (typeof arg === "string") {
      this.label = _checkLabelValidity(arg);
      this.fromEdges = {};
      this.token = defaultToken(this.label);
      this.condition = new BooleanFn(["true"]);
      this.requiredInputPerUnit = {};
      this.buffer = {};
    } else {
      this.label = arg.label;
      this.fromEdges = { ...arg.fromEdges };
      this.token = arg.token;
      this.condition = BooleanFn.fromString(arg.condition.toString());
      this.requiredInputPerUnit = { ...arg.requiredInputPerUnit };
      this.buffer = { ...arg.buffer };
    }
  }

  // add new input element from edges
  _addToBuffer(token: Token, amount: number) {
    if (amount < 0) {
      throw Error("must add non-negative amount to element buffer");
    }
    const currentAmount = this.buffer[token] || 0;
    this.buffer[token] = currentAmount + amount;
  }

  getLabel(): Label {
    return this.label;
  }

  getToken(): Token {
    return this.token;
  }

  _getRequiredInputPerUnit(): { [key: Token]: number } {
    return this.requiredInputPerUnit;
  }

  /**
   * Return a copy of the converter buffer.
   */
  getBuffer(): { [key: Token]: number } {
    return { ...this.buffer };
  }

  /**
   * Add one more required element to produce one unit of
   * converted element.
   * @param elementId elementId representing the id.
   * @param value amount required.
   */
  _setRequiredInputPerUnit(elementId: Token, value: number) {
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

  getCondition(): string {
    return this.condition.toString();
  }

  _setToken(token: Token) {
    this.token = _checkTokenValidity(token);
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

  setCondition(condition: string) {
    this.condition = BooleanFn.fromString(condition);
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
    converter.setCondition(json.condition);
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

// interface Swap {
//   readonly type: ElementType.Swap;
// }

type LiquidityPool = {
  token: Token | undefined,
  amount: number,
}

class Swap {
  readonly type = ElementType.Swap;
  private label: Label;
  private pipes: [ElementId | undefined, ElementId | undefined][];
  private readonly tokenA: LiquidityPool;
  private readonly tokenB: LiquidityPool;
  private condition: BooleanFn;
  private constraint: number;

  constructor(arg: Label | Swap) {
    if (typeof arg === "string") {
      this.label = _checkLabelValidity(arg);
      this.tokenA = { token: undefined, amount: 100.0 };
      this.tokenB = { token: undefined, amount: 100.0 };
      this.pipes = [];
      this.condition = new BooleanFn(["true"]);
      this.constraint = this.tokenA.amount * this.tokenB.amount;
    } else {
      this.label = arg.label;
      this.tokenA = { ...arg.tokenA };
      this.tokenB = { ...arg.tokenB };
      this.pipes = arg.pipes.map(p => [...p]);
      this.condition = BooleanFn.fromString(arg.condition.toString());
      this.constraint = arg.constraint;
    }
  }

  validateSwapConfig() {
    if (this.tokenA.token === undefined || this.tokenB.token === undefined) {
      throw Error("not all token names are defined");
    }
    if (this.tokenA.amount <= 0 || this.tokenB.amount <= 0) {
      throw Error("all tokens must have positive amount");
    }
    if (this.constraint <= 0) {
      throw Error("must have positive constraint");
    }
  }

  getLabel(): Label {
    return this.label;
  }

  getTokenA(): LiquidityPool {
    return { ...this.tokenA };
  }

  getTokenB(): LiquidityPool {
    return { ...this.tokenB };
  }

  _getPipe(index: number): [ElementId | undefined, ElementId | undefined] {
    const pipe = this.pipes[index];
    if (pipe === undefined) {
      throw Error("Swap pipe index out of range");
    }
    return pipe;
  }

  _getOrCreatePipe(index: number): [ElementId | undefined, ElementId | undefined] {
    if (index > this.pipes.length) {
      throw Error("swap index out of range");
    }
    let pipe = this.pipes[index];
    if (pipe === undefined) {
      pipe = [undefined, undefined];
      this.pipes[index] = pipe;
    }
    return pipe;
  }

  _getPipes(): [ElementId | undefined, ElementId | undefined][] {
    return this.pipes;
  }

  _setLabel(label: Label) {
    this.label = _checkLabelValidity(label);
  }

  setTokenA(token: Token) {
    const tokenType = _checkTokenValidity(token);
    if (tokenType === this.tokenB.token) {
      throw Error("duplicate token types not allowed");
    }
    this.tokenA.token = token;
  }

  setTokenB(token: Token) {
    const tokenType = _checkTokenValidity(token);
    if (tokenType === this.tokenA.token) {
      throw Error("duplicate token types not allowed");
    }
    this.tokenB.token = tokenType;
  }

  setTokenAAmount(amount: number) {
    if (amount <= 0) {
      throw Error("negative amount not allowed");
    }
    this.tokenA.amount = amount;
    this.constraint = this.tokenA.amount * this.tokenB.amount;
  }

  setTokenBAmount(amount: number) {
    if (amount <= 0) {
      throw Error("negative amount not allowed");
    }
    this.tokenB.amount = amount;
    this.constraint = this.tokenA.amount * this.tokenB.amount;
  }

  setCondition(condition: string) {
    this.condition = BooleanFn.fromString(condition);
  }

  /**
   * Swap a certain token.
   *
   * @param amount the input amount
   * @param token the token type
   * @param scope variable scope for evaluating `Condition`
   *
   * @return undefined if the swapping cannot proceed
   */
  swap(amount: number, token: Token, scope: VariableScope): [Token, number] | undefined {
    try {
      this.validateSwapConfig();
    } catch (_) {
      return undefined;
    }
    if (amount < 0) {
      throw Error("cannot swap negative amount of token");
    }
    if (amount === 0
      || !this.condition.evaluate(scope)
      || (token !== this.tokenA.token && token !== this.tokenB.token)) {
      return undefined;
    }
    if (token === this.tokenA.token) {
      this.tokenA.amount += amount;
      const oldBAmount = this.tokenB.amount;
      this.tokenB.amount = this.constraint / this.tokenA.amount;
      return [this.tokenB.token!, oldBAmount - this.tokenB.amount];
    } else {
      this.tokenB.amount += amount;
      const oldAAmount = this.tokenA.amount;
      this.tokenA.amount = this.constraint / this.tokenB.amount;
      return [this.tokenA.token!, oldAAmount - this.tokenA.amount];
    }
  }

  _deleteInput(edgeId: ElementId) {
    const pipe = this.pipes.find(p => p[0] === edgeId);
    if (pipe !== undefined) {
      const [_, pipe_out] = pipe;
      if (pipe_out === undefined) {
        this.pipes = this.pipes.filter(p => p[0] !== edgeId);
      } else {
        pipe[0] = undefined;
      }
    }
  }

  _deleteOutput(edgeId: ElementId) {
    const pipe = this.pipes.find(p => p[1] === edgeId);
    if (pipe !== undefined) {
      const [pipe_in, _] = pipe;
      if (pipe_in === undefined) {
        // do not store [undefined undefined docks]
        this.pipes = this.pipes.filter(p => p[1] !== edgeId);
      } else {
        pipe[1] = undefined;
      }
    }
  }

  clone(): Swap {
    return new Swap(this);
  }

  static fromJson(json: any): Swap {
    const swap = new Swap("swap");
    Object.assign(swap, json);
    swap.setCondition(json.condition);
    return swap;
  }
}

export {
  Pool,
  Gate,
  Edge,
  Swap,
  Converter,
  Element,
  ElementType,
  Node,
  NodeType,
  ElementId,
  LiquidityPool,
  isValidLabel,
  Label,
  Token,
};
