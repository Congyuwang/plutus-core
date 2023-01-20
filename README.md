# Plutus-core Algorithm Doc

Author: 王聪雨

Note: pseudocodes, might be different from actual implementation in details.

## Data Structure

`Graph := List[Element] `

`Element := Node | Edge`

`Node := Pool | Gate | Converter | Swap`

`Pool` 1-in 1-out.

`Gate` 1-in N-out 1-randomly-selected-out.

`Converter` N-in 1-out.

`Swap` N-in N-out.

## Execution Algorithm

### Step 0: Activate Pools and Gates

- Loop over the graph.
- Update Pool state.
- Activate gate, and mark disabled edges.

```pseudocode
# Input: Graph graph
# Output: List[Element] active_elements

edges_disabled = new Set()
active_elements = new List()

for element of graph:
    if element is Pool:
        element.nextTick()             # compute the next state of Pool
    else if element is Gate:
        element.nextTick()             # randomly activate an output edge:
        chosen_edge = element.output   # mark edge as disabled if not chosen
        for output_edge of element.outputs:
            if output_edge != chosen_edge:
                edges_disabled.add(output_edge)
            end if
        end for
    end if
end for

for element of graph:
    if !(element in edges_disabled):
        active_elements.append(element)
    end if
end for
```

Related JS
Code: https://github.com/Congyuwang/plutus-core/blob/b09c46c7cee71f1b94b9e7b4366df3971af913d2/src/compiler.ts#L46:L85

### Step 1: Cut At Pool Input

Group graph into connected components, but ignoring `Edge --> Pool` connections.

Note:

- Treatment of Gate: Gate is viewed as if it is a single-in-single-out component (only the selected output exists).

- Treatment of Swap: Swap is viewed as if it is a multi-component. Each valid input-output pair is viewed as if it is a
  single-in-single-out component. Skipping DFS search from Swap because we need to know which in-out pair of this Swap
  is of our current concern.

```pseudocode
# Input: List[Element] active_elements
# Output: List[List[Element]] parallel_groups

parallel_groups = new List()

visited = new Set()
for element of active_elements:
    if element in visited:
        continue               # DFS, skip visited elements
    end if
    if element is Swap:
        continue               # skip searching starting from Swap
    end if
    new_group = DFS_ignore_pool_input(element, visited)
    parallel_groups.push(new_group)
end for
```

Related JS
Code: https://github.com/Congyuwang/plutus-core/blob/b09c46c7cee71f1b94b9e7b4366df3971af913d2/src/compiler.ts#L87:L110

DFS JS
Code: https://github.com/Congyuwang/plutus-core/blob/b09c46c7cee71f1b94b9e7b4366df3971af913d2/src/compiler.ts#L208:L405

Note: Elements are indexed by ElementId, whereas 'Swaps in-out Pairs' are indexed by a two-element tuple (ElementId,
SwapIndex), where SwapIndex index the nth in-out pair.

### Step 2: Cut At Converter Output

Similar to Step 1, but ignoring `Converter --> Edge` connections.

```pseudocode
# Input: List[List[Element]] parallel_groups
# Output: List[List[List[Element]]] groups_of_subgroups

groups_of_subgroups = new List()

for group of parallel_groups:
    visited = new Set()
    sub_group = new List()
    for element of active_elements:
        if visited.has(element):
            continue               # DFS, skip visited elements
        end if
        if element is Swap:
            continue               # skip searching starting from Swap
        end if
        new_group = DFS_ignore_converter_output(element, visited)
        subgroup.push(new_group)
    end for
    groups_of_subgroups.push(subgroup)
end for
```

Related JS
Code: https://github.com/Congyuwang/plutus-core/blob/b09c46c7cee71f1b94b9e7b4366df3971af913d2/src/compiler.ts#L39:L42

### Comment on Step 1 & 2

**After step 1 and 2, each subgroup consists of at most one Pool, and at most one Converter. All remaining element
types (Edge / Gate / Swap) are essentially single-in-single-out**.

There are two cases:

- Alive subgroup, where we have entry points.

  ```
       +-----------------------------------------+
       |                                         |
  in? -+-> [entry1] ---> [] --------+            |
       |                             \           |
  in? -+-> [entry2] ---> [] ---> [] ---> [last] -+-> out?
       |                                         |
       +-----------------------------------------+
  ```

- Dead subgroup, where we have a cycle consiting of Edge / Gate / Swap (can't have Converter or Pool).

  ```
  +------------+
  |  []<---[]  |
  |   |    |   |
  |  []--->[]  |
  +------------+
  ```

Since the dead groups consist of only edges (Edge / Gate) and swaps (which is a passive element), it does nothing during
execution. So, we focus on alive subgroups.

There are three cases regarding the entry points:

- A Pool is the entry point.
- A dangling edge (connected to nothing) is the entry point.
- An edge connected to a Converter is the entry point, **in which case the current subgroup needs to be executed after
  the subgroup containing that particular Converter is executed**.

There are three cases regarding the output side of the pipeline:

- The last element is a converter.
- The last element is a dangling edge.
- The last element is an edge connected to a Pool.

### Step 3: Subgroup Order

**Because of the case where a subgroup pipeline input might depend on the Converter output of another subgroup,
subgroups needs to be executed in proper orders**. To decide the execution orders, we construct the dependency graph of
subgroups, and sort subgroups using topological sort.

```pseudocode
# Input: List[List[Element]] subgroups
# Output: List[number]? order

order = null

# find out Converters to subgroups, Subgroups to Converters
groupToConverter = new Map()
converterToGroup = new Map()
for groupId, subgroup of enumerate(subgroups):
    for element of subgroup:
        if element is Converter:
            groupToConverter[groupId] = element    # at most one Converter
        else if element is Edge:
            from = the_upstream_node_of(<Edge>element)
            if from is Converter:
                converterToGroup[from] = groupId   # maybe multiple
            end if
        end if
    end for
end for

# topological sort
directedGraph = new DirectedGraph()
for i of subgroups:
    directedGraph.addNode(i)
end for
for groupId, converter of groupToConverter:
    dependentGroup = converterToGroup[converter];
    directedGraph.addEdge(groupId, dependentGroup) # add edge
end for
if !hasCycle(directedGraph):                       # if has no cycle
    order = topologicalSort(directedGraph)
else
    order = null
end if
```

Related JS
Code: https://github.com/Congyuwang/plutus-core/blob/b09c46c7cee71f1b94b9e7b4366df3971af913d2/src/compiler.ts#L136:L206

### Step 4: Entry Points of Subgraphs

Find the entry points of each subgraphs.

```pseudocode
# Input: List[Element] subgroup
# Output: List[Element] entryPoints

entryPoints = List()

for element of subgroup:
    if element is Edge:
        from = the_upstream_node_of(<Edge>element)
        if from is Converter or Pool:
            entryPoints.push(from)
        end if
    end if
end for
```

Related JS
Code: https://github.com/Congyuwang/plutus-core/blob/b09c46c7cee71f1b94b9e7b4366df3971af913d2/src/compiler.ts#L136:L206

### Step 5: Execute Graph

Each subgraph consists of one or multiple (if 'last' is Converter) input pipelines.

```
     +-----------------------------------------+
     |   pipeline 1                            |
in? -+-> [entry1] ---> [] -------+             |
     |                            \            |
     |   pipeline 2                \           |
in? -+-> [entry2] ---> [] ---> [] ---> [last] -+-> out?
     |                                         |
     +-----------------------------------------+
```

#### Execute a single pipeline

```pseudocode
type Packet = {
    number value,
    string token,
}

def RunEdge:
# Inputs: 
# - Edge entryPoint
# - &Map<Element, List<Packet>> outputs
# - number? value
# - string? token

    number nextValue
    string nextToken
    
    # input node of edge
    from = the_upstream_node_of(<Edge>edge)
    if from is Converter:
        nextValue = from.convert()
        nextToken = from.token()
    else if from is Pool:
        nextValue = from.take(edge.rate())
        nextToken = from.token()
    else if from is Gate:
        if value is undefined or token is undefined:
            return
        else:
            nextValue = value                            # simple forwarding
            nextToken = token
        end if
    else if from is Swap:
        if value is undefined or token is undefined:
            return
        else:
            nextToken, nextValue = from.swap(value, token)
        end if
    end if
    
    # output node of edge
    to = the_downstream_node_of(<Edge>edge)
    if nextValue <= 0:                                   # skip if empty
        return
    end if
    if to is Gate:
        nextEdge = to.output()
        runEdge(nextEdge, outputs, nextValue, nextToken) # recurse
    else if to is Swap:
        nextEdge = get_output_edge_of_this_swap_pair(to)
        runEdge(nextEdge, outputs, nextValue, nextToken) # recurse
    else if to is Pool or Converter:
        if !(to in outputs):
            outputs[to] = new List()
        end if
        outputs[to].push({value: nextValue, token: nextToken})
    end if
end def
```

Related JS
Code: https://github.com/Congyuwang/plutus-core/blob/b09c46c7cee71f1b94b9e7b4366df3971af913d2/src/executor.ts#L145:L259

#### Execute a subgroup

```pseudocode
def executeSubgroup:
# Input: List[Element] entryPoints
# Output: Map<Element, List<Packet>> output

    output = new Map()

    for edge of entryPoints:
        runEdge(edge, output)
    end for

    return output
end def
```

Related JS
Code: https://github.com/Congyuwang/plutus-core/blob/b09c46c7cee71f1b94b9e7b4366df3971af913d2/src/executor.ts#L122:L143

#### Execute a group

Execute cyclic group and ordered group with different strategy:

- For ordered group, execute each subgroup according to the topological order.

- For cyclic group, execute each subgroup parallelly.

```pseudocode
def executeGroup:
# Input: List[List[Element]] groupEntryPoints, List[number]? order

    outputs = new Map()

    if order is undefined:                        # cyclc subgroups
        for entryPoints of groupEntryPoints:
            output = executeSubgroup(entryPoints)
            mergeInto(&outputs, output)
        end for
    else:                                         # ordered subgroups
        for i of order:
            entryPoints = groupEntryPoints[i]
            output = executeSubgroup(entryPoints)
            converter = converterOfSubgroup(i)
            remainingOutput = writeToConverterBuffer(converter, output)
            mergeInto(&outputs, remainingOutput)
        end for
    end if
    
    return outputs
end def
```

Related JS
Code: https://github.com/Congyuwang/plutus-core/blob/b09c46c7cee71f1b94b9e7b4366df3971af913d2/src/executor.ts#L58:L120

#### Execute graph

```pseudocode
# Input: List[List[List[Element]]] groups_of_subgroups

allOutputs = new Map()

# execute parallel groups
for group of groups_of_subgroups:
    outputs = executeGroup(group)
    mergeInto(&allOutputs, outputs)
end for

for element, packets of allOutputs:
    # write to Pools (in case of Ordered group)
    # write to Pools or Converter Buffer (in case of Cyclic group)
    for packet of packets:
       writePacket(packet, element)
    end for
end for
```

Related JS
Code: https://github.com/Congyuwang/plutus-core/blob/b09c46c7cee71f1b94b9e7b4366df3971af913d2/src/executor.ts#L30:L56
