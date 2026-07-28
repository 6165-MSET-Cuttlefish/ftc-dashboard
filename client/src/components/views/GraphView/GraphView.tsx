import React, { Component } from 'react';
import { connect, ConnectedProps } from 'react-redux';

import BaseView, {
  BaseViewHeading,
  BaseViewBody,
  BaseViewIcons,
  BaseViewIconButton,
  BaseViewProps,
  BaseViewHeadingProps,
} from '@/components/views/BaseView';
import MultipleCheckbox from './MultipleCheckbox';
import GraphCanvas from './GraphCanvas';
import TextInput from '@/components/views/ConfigView/inputs/TextInput';

import { ReactComponent as ChartIcon } from '@/assets/icons/chart.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as PlayIcon } from '@/assets/icons/play_arrow.svg';
import { ReactComponent as PauseIcon } from '@/assets/icons/pause.svg';

import { RootState } from '@/store/reducers';
import { STOP_OP_MODE_TAG } from '@/store/types';
import { addGraphExport } from '@/store/actions/graphExports';
import { OpModeStatus } from '@/enums/OpModeStatus';
import { colors, ThemeConsumer } from '@/hooks/useTheme';
import { DEFAULT_OPTIONS } from './Graph';
import { validateInt, ValResult } from '@/components/inputs/validation';

type RecordedRow = {
  timestamp: number;
  values: (string | null)[];
};

type GraphViewState = {
  graphing: boolean;
  opmodePaused: boolean;
  userPaused: boolean;
  pausedTime: number;
  availableKeys: string[];
  selectedKeys: string[];
  windowMs: ValResult<number>;
  recordedKeys: string[];
  recordedRows: RecordedRow[];
  currentOpModeName: string;
};

const mapStateToProps = (state: RootState) => ({
  telemetry: state.telemetry,
  status: state.status,
});

const mapDispatchToProps = {
  addGraphExport,
};

const connector = connect(mapStateToProps, mapDispatchToProps);

type GraphViewProps = ConnectedProps<typeof connector> &
  BaseViewProps &
  BaseViewHeadingProps;

class GraphView extends Component<GraphViewProps, GraphViewState> {
  containerRef: React.RefObject<HTMLDivElement>;

  constructor(props: GraphViewProps) {
    super(props);

    this.state = {
      graphing: false,
      opmodePaused: false,
      userPaused: false,
      pausedTime: 0,
      availableKeys: [],
      selectedKeys: [],
      windowMs: {
        value: DEFAULT_OPTIONS.windowMs,
        valid: true,
      },
      recordedKeys: [],
      recordedRows: [],
      currentOpModeName: '',
    };

    this.containerRef = React.createRef();

    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);

    this.userPlay = this.userPlay.bind(this);
    this.userPause = this.userPause.bind(this);

    this.commitRecording = this.commitRecording.bind(this);

    this.handleDocumentKeydown = this.handleDocumentKeydown.bind(this);
  }

  componentDidMount() {
    if (this.containerRef.current) {
      this.containerRef.current.addEventListener(
        'keydown',
        this.handleDocumentKeydown,
      );
    }
  }

  componentWillUnmount() {
    if (this.containerRef.current) {
      this.containerRef.current.removeEventListener(
        'keydown',
        this.handleDocumentKeydown,
      );
    }
  }

  componentDidUpdate(prevProps: GraphViewProps) {
    if (this.noOpmodeRunning(this.props) && !this.noOpmodeRunning(prevProps)) {
      this.opmodePause();
    }
    if (!this.noOpmodeRunning(this.props) && this.noOpmodeRunning(prevProps)) {
      this.opmodePlay();
    }

    if (
      this.props.status.activeOpModeStatus === OpModeStatus.RUNNING &&
      this.props.status.activeOpMode !== STOP_OP_MODE_TAG &&
      this.props.status.activeOpMode !== this.state.currentOpModeName
    ) {
      this.setState({ currentOpModeName: this.props.status.activeOpMode });
    }

    if (this.props.telemetry === prevProps.telemetry) return;

    this.setState((state) => {
      if (this.props.telemetry.length === 0) {
        return {
          availableKeys: [],
          selectedKeys: state.selectedKeys,
          recordedRows: state.recordedRows,
        };
      }

      const availableKeys = [...state.availableKeys];
      for (const { data } of this.props.telemetry) {
        for (const k of Object.keys(data)) {
          if (isNaN(parseFloat(data[k]))) continue;

          if (availableKeys.includes(k)) continue;

          availableKeys.push(k);
        }
      }

      let { recordedRows } = state;
      if (state.graphing) {
        const newRows = this.props.telemetry
          .filter(({ data }) =>
            state.recordedKeys.some((k) =>
              Object.prototype.hasOwnProperty.call(data, k),
            ),
          )
          .map(({ timestamp, data }) => ({
            timestamp,
            values: state.recordedKeys.map((k) =>
              Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null,
            ),
          }));
        recordedRows = [...state.recordedRows, ...newRows];
      }

      return {
        availableKeys,
        selectedKeys: state.selectedKeys,
        recordedRows,
      };
    });
  }

  handleDocumentKeydown(evt: KeyboardEvent) {
    if (evt.code === 'Space' || evt.key === 'k') {
      this.setState({
        ...this.state,
        userPaused: !this.state.userPaused,
        pausedTime: Date.now(),
      });
    }
  }

  noOpmodeRunning(props: GraphViewProps) {
    return (
      props.status.opModeInfoList?.length === 0 ||
      props.status.activeOpMode === STOP_OP_MODE_TAG ||
      props.status.activeOpModeStatus === OpModeStatus.STOPPED
    );
  }

  start() {
    this.setState({
      ...this.state,
      graphing: true,
      userPaused: false,
      recordedKeys: [...this.state.selectedKeys],
      recordedRows: [],
    });
  }

  stop() {
    this.commitRecording();
    this.setState({
      ...this.state,
      graphing: false,
      recordedRows: [],
    });
  }

  userPause() {
    this.setState({
      ...this.state,
      userPaused: true,
      pausedTime:
        this.state.userPaused || this.state.opmodePaused
          ? this.state.pausedTime
          : Date.now(),
    });
  }

  opmodePause() {
    if (this.state.graphing) {
      this.commitRecording();
    }

    this.setState({
      ...this.state,
      opmodePaused: true,
      pausedTime:
        this.state.userPaused || this.state.opmodePaused
          ? this.state.pausedTime
          : Date.now(),
      recordedRows: this.state.graphing ? [] : this.state.recordedRows,
    });
  }

  userPlay() {
    this.setState({
      ...this.state,
      userPaused: false,
    });
  }

  opmodePlay() {
    this.setState({
      ...this.state,
      opmodePaused: false,
      recordedRows: this.state.graphing ? [] : this.state.recordedRows,
    });
  }

  commitRecording() {
    if (
      this.state.recordedRows.length === 0 ||
      this.state.recordedKeys.length === 0
    ) {
      return;
    }

    const rowsCopy = [...this.state.recordedRows].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    const t0 = rowsCopy[0].timestamp;

    const header = ['time (ms)', ...this.state.recordedKeys];
    const body = rowsCopy
      .map((row) => [row.timestamp - t0, ...row.values].join(','))
      .join('\r\n');
    const csv = `${header.join(',')}\r\n${body}`;

    const fileDate = new Date(rowsCopy[0].timestamp);
    const year = fileDate.getFullYear();
    const month = `0${fileDate.getMonth() + 1}`.slice(-2);
    const date = `0${fileDate.getDate()}`.slice(-2);
    const hours = `0${fileDate.getHours()}`.slice(-2);
    const minutes = `0${fileDate.getMinutes()}`.slice(-2);
    const seconds = `0${fileDate.getSeconds()}`.slice(-2);

    const name = `${
      this.state.currentOpModeName || 'graph'
    } ${year}-${month}-${date}_${hours}-${minutes}-${seconds}`;

    this.props.addGraphExport(name, csv);
  }

  render() {
    const showNoNumeric =
      !this.state.graphing && this.state.availableKeys.length === 0;
    const showEmpty =
      this.state.graphing && this.state.selectedKeys.length === 0;
    const showText = showNoNumeric || showEmpty;

    const graphData = this.props.telemetry.map((packet) => [
      {
        name: 'time',
        value: packet.timestamp,
      },
      ...Object.keys(packet.data)
        .filter((key) => this.state.selectedKeys.includes(key))
        .map((key) => {
          return {
            name: key,
            value: parseFloat(packet.data[key]),
          };
        }),
    ]);

    return (
      <BaseView
        className="flex flex-col overflow-auto"
        isUnlocked={this.props.isUnlocked}
        ref={this.containerRef}
        tabIndex={0}
      >
        <div className="flex">
          <BaseViewHeading isDraggable={this.props.isDraggable}>
            Graph
          </BaseViewHeading>
          <BaseViewIcons>
            {this.state.graphing && this.state.selectedKeys.length !== 0 && (
              <BaseViewIconButton
                title={
                  this.state.userPaused
                    ? 'Resume Graphing'
                    : this.noOpmodeRunning(this.props)
                    ? 'Graphing will restart when an OpMode starts'
                    : 'Pause Graphing'
                }
                className="icon-btn h-8 w-8"
              >
                {this.state.userPaused ? (
                  <PlayIcon className="h-6 w-6" onClick={this.userPlay} />
                ) : (
                  <PauseIcon className="h-6 w-6" onClick={this.userPause} />
                )}
              </BaseViewIconButton>
            )}

            <BaseViewIconButton
              title={this.state.graphing ? 'Stop Graphing' : 'Start Graphing'}
            >
              {this.state.graphing ? (
                <CloseIcon className="h-6 w-6" onClick={this.stop} />
              ) : (
                <ChartIcon className="h-6 w-6" onClick={this.start} />
              )}
            </BaseViewIconButton>
          </BaseViewIcons>
        </div>
        <BaseViewBody className={showText ? 'flex-center' : ''}>
          {!this.state.graphing ? (
            showNoNumeric ? (
              <p className="justify-self-center text-center">
                Send number-valued telemetry data to graph them over time
              </p>
            ) : (
              <>
                <p className="my-2 text-center">
                  Press the upper-right button to graph selected keys over time
                </p>
                <h3 className="mt-6 font-medium">Telemetry to graph:</h3>
                <div className="ml-3">
                  <MultipleCheckbox
                    arr={this.state.availableKeys}
                    onChange={(selectedKeys: string[]) =>
                      this.setState({ selectedKeys })
                    }
                    selected={this.state.selectedKeys}
                  />
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Options:</h3>
                  </div>
                  <div className="ml-3">
                    <table>
                      <tbody>
                        <tr>
                          <td>Window (ms)</td>
                          <td>
                            <TextInput
                              value={this.state.windowMs.value}
                              valid={this.state.windowMs.valid}
                              validate={validateInt}
                              onChange={(arg) =>
                                this.setState({
                                  windowMs: arg,
                                })
                              }
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )
          ) : showEmpty ? (
            <p className="justify-self-center text-center">
              No telemetry selected to graph
            </p>
          ) : (
            <ThemeConsumer>
              {({ isDarkMode }) => (
                <GraphCanvas
                  data={graphData}
                  options={{
                    windowMs: this.state.windowMs.valid
                      ? this.state.windowMs.value
                      : DEFAULT_OPTIONS.windowMs,
                    gridLineColor: isDarkMode
                      ? colors.slate[500]
                      : colors.gray[300],
                    textColor: isDarkMode
                      ? colors.slate[100]
                      : colors.gray[900],
                  }}
                  paused={this.state.userPaused || this.state.opmodePaused}
                  pausedTime={this.state.pausedTime}
                />
              )}
            </ThemeConsumer>
          )}
        </BaseViewBody>
      </BaseView>
    );
  }
}

export default connector(GraphView);
