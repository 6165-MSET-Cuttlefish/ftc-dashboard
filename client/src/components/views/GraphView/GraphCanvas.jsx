import React from 'react';
import PropTypes from 'prop-types';

import Graph from './Graph';
import AutoFitCanvas from '@/components/Canvas/AutoFitCanvas';
import { isEqual } from 'lodash';

class GraphCanvas extends React.Component {
  constructor(props) {
    super(props);

    this.canvasRef = React.createRef();

    this.renderGraph = this.renderGraph.bind(this);

    this.unsubs = []; // unsub functions to be called to cleanup

    this.reportedBounds = null;

    this.state = {
      graphEmpty: false,
    };
  }

  componentDidMount() {
    this.graph = new Graph(this.canvasRef.current, this.props.options);

    // draw once up front: with no telemetry arriving (op mode over) nothing
    // would ever change props, leaving an empty canvas and no explanation
    this.renderGraph();
  }

  componentWillUnmount() {
    if (this.requestId) {
      cancelAnimationFrame(this.requestId);
    }
  }

  // TODO: Regretably, the current design requires that this.graph.add() only be called
  // once for each batch of telemetry. Violations of this contract cause artifacts in the
  // graph from out-of-order samples. (The graph code could be made more robust here, but
  // mitigating the issue here works just as well.)
  componentDidUpdate(prevProps) {
    let graphIsDirty = false;

    if (!isEqual(this.props.options, prevProps.options)) {
      this.graph.setOptions({
        ...this.graph.getOptions(),
        ...this.props.options,
      });
      graphIsDirty = true;
    }

    // a new op mode run starts the history over
    if (this.props.runId !== prevProps.runId) {
      this.graph.reset();
      this.reportBounds();
      graphIsDirty = true;
    }

    // samples are recorded even while paused so that the full history remains
    // available for scrubbing
    if (!isEqual(this.props.data, prevProps.data)) {
      this.graph.add(Date.now(), this.props.data);
      this.reportBounds();
      graphIsDirty = true;
    }

    if (prevProps.paused && !this.props.paused) {
      // pick playback back up at the newest sample rather than replaying the
      // stretch of telemetry time that elapsed while paused
      this.graph.resync(Date.now());
    }

    if (this.props.scrubMs !== prevProps.scrubMs) graphIsDirty = true;

    if (!this.props.paused && !this.requestId) graphIsDirty = true;

    if (graphIsDirty) this.renderGraph();
  }

  // the parent needs the extent of the history to drive the scrub slider
  reportBounds() {
    if (!this.props.onTimeBounds) return;

    const bounds = this.graph.getTimeBounds();
    if (isEqual(bounds, this.reportedBounds)) return;

    this.reportedBounds = bounds;
    this.props.onTimeBounds(bounds);
  }

  renderGraph() {
    const time = this.props.paused ? this.props.pausedTime : Date.now();

    this.setState(() => ({
      graphEmpty: !this.graph.render(time, this.props.scrubMs),
    }));

    if (this.props.paused) {
      this.requestId = 0;
    } else {
      this.requestId = requestAnimationFrame(this.renderGraph);
    }
  }

  render() {
    return (
      <div className="flex-center h-full">
        <div
          className={`${this.state.graphEmpty ? 'hidden' : ''} h-full w-full`}
        >
          <AutoFitCanvas
            ref={this.canvasRef}
            onResize={() => {
              if (this.graph && this.props.paused)
                this.graph.render(this.props.pausedTime, this.props.scrubMs);
            }}
          />
        </div>
        <div className="flex-center pointer-events-none absolute top-0 left-0 h-full w-full">
          {this.state.graphEmpty && (
            <p className="text-center">No content to graph</p>
          )}
        </div>
      </div>
    );
  }
}

GraphCanvas.defaultProps = {
  scrubMs: null,
  runId: 0,
};

GraphCanvas.propTypes = {
  data: PropTypes.arrayOf(PropTypes.any).isRequired,
  options: PropTypes.object.isRequired,
  paused: PropTypes.bool.isRequired,
  pausedTime: PropTypes.number.isRequired,
  // telemetry time shown at the right edge, or null to follow live data
  scrubMs: PropTypes.number,
  // changes to reset the recorded history (new op mode run)
  runId: PropTypes.number,
  onTimeBounds: PropTypes.func,
};

export default GraphCanvas;
