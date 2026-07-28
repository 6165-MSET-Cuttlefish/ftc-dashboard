import {
  ADD_GRAPH_EXPORT,
  GraphExportsAction,
  GraphExportsState,
} from '@/store/types/graphExports';

const initialState: GraphExportsState = [];

const graphExportsReducer = (
  state = initialState,
  action: GraphExportsAction,
) => {
  switch (action.type) {
    case ADD_GRAPH_EXPORT:
      return [...state, action.graphExport];

    default:
      return state;
  }
};

export default graphExportsReducer;
