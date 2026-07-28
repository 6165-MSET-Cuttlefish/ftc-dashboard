import { ChangeEvent, useState } from 'react';
import { useSelector } from 'react-redux';

import { RootState } from '@/store/reducers';
import BaseView, {
  BaseViewHeading,
  BaseViewProps,
  BaseViewHeadingProps,
} from '@/components/views/BaseView';
import downloadBlob from '@/util/downloadBlob';

import { ReactComponent as DownloadSVG } from '@/assets/icons/file_download.svg';

type GraphExportViewProps = BaseViewProps & BaseViewHeadingProps;

const GraphExportView = ({
  isUnlocked = false,
  isDraggable = false,
}: GraphExportViewProps) => {
  const graphExports = useSelector((state: RootState) => state.graphExports);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selected = [...event.target.selectedOptions].map(
      (option) => option.value,
    );
    setSelectedIds(selected);
  };

  const handleDownloadSelected = () => {
    selectedIds.forEach((id) => {
      const graphExport = graphExports.find((e) => e.id === id);
      if (!graphExport) return;

      downloadBlob(graphExport.csv, `${graphExport.name}.csv`, 'text/csv');
    });
  };

  return (
    <BaseView isUnlocked={isUnlocked}>
      <BaseViewHeading isDraggable={isDraggable}>Graph Export</BaseViewHeading>

      <div className="controls-container" style={{ textAlign: 'center' }}>
        <div style={{ marginTop: '1em' }}>
          <label
            htmlFor="graphExportSelector"
            style={{ fontWeight: 'bold', marginRight: '0.5em' }}
          >
            Select Graph CSV:
          </label>

          <div style={{ position: 'relative' }}>
            <select
              id="graphExportSelector"
              multiple
              value={selectedIds}
              onChange={handleSelectChange}
              style={{
                padding: '0.5em',
                fontSize: '14px',
                color: 'black',
                borderRadius: '4px',
                border: '1px solid #ccc',
                cursor: 'pointer',
                marginRight: '0.5em',
                height: `${Math.min(graphExports.length, 5) * 20 + 4}px`,
                width: '260px',
              }}
            >
              {graphExports.map((graphExport) => (
                <option
                  key={graphExport.id}
                  value={graphExport.id}
                  title={graphExport.name}
                >
                  {new Date(graphExport.timestamp).toLocaleTimeString()} —{' '}
                  {graphExport.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleDownloadSelected}
            disabled={selectedIds.length === 0}
            style={{
              padding: '0.5em 1em',
              backgroundColor: selectedIds.length > 0 ? '#5bc0de' : '#ccc',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 'bold',
              border: 'none',
              borderRadius: '4px',
              cursor: selectedIds.length > 0 ? 'pointer' : 'not-allowed',
              transition: 'background-color 0.3s ease',
              marginLeft: '0.5em',
            }}
          >
            <DownloadSVG className="h-6 w-6" />
          </button>
        </div>

        {graphExports.length === 0 && (
          <p style={{ marginTop: '1em', color: '#888' }}>
            No graph exports yet. Graph telemetry, then stop graphing or end the
            OpMode to create one.
          </p>
        )}
      </div>
    </BaseView>
  );
};

export default GraphExportView;
