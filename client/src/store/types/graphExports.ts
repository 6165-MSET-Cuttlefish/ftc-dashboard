export const ADD_GRAPH_EXPORT = 'ADD_GRAPH_EXPORT';

export type GraphExport = {
  id: string;
  name: string;
  csv: string;
  timestamp: number;
};

export type GraphExportsState = GraphExport[];

export type AddGraphExportAction = {
  type: typeof ADD_GRAPH_EXPORT;
  graphExport: GraphExport;
};

export type GraphExportsAction = AddGraphExportAction;
