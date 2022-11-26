// /**
//  * Clone, serialization and deserialization
//  */
// import { ElementId, ElementType, Label } from "./nodes";
// import { Graph } from "./graph";
//
// type ElementTypeData = string;
//
// interface ElementData {
//     type: ElementTypeData;
// }
//
// interface GraphData {
//     elements: { [key: ElementId]: ElementData };
//     labels: { [key: Label]: ElementId };
//     autoLabelCounter:;
// }
//
// function toGraphData(graph: Graph): GraphData {
//     const data: GraphData = {
//         elements: {},
//         labels: {},
//         autoLabelCounter: {...graph.autoLabelCounter}
//     };
//     for (const [label, id] of graph.labels.entries()) {
//         data.labels[label] = id;
//     }
//     return
// }
//
// function fromGraphData(data: GraphData): Graph {
//     const graph = new Graph();
//     graph.autoLabelCounter = {...data.autoLabelCounter};
//     for (const [label, id] of Object.entries(data.labels)) {
//         graph.labels.set(label, id);
//     }
//     for (const [id, elementData] of Object.entries(data.elements)) {
//         graph.elements.
//     }
// }
