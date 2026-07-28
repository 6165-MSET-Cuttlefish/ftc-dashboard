import { v4 as uuidv4 } from 'uuid';

import {
  ADD_GRAPH_EXPORT,
  AddGraphExportAction,
} from '@/store/types/graphExports';

export const addGraphExport = (
  name: string,
  csv: string,
): AddGraphExportAction => ({
  type: ADD_GRAPH_EXPORT,
  graphExport: { id: uuidv4(), name, csv, timestamp: Date.now() },
});
