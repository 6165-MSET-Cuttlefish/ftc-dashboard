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

    /** Set only while a paused replay is being scrubbed. See onResize. */
    this.lastRenderMs = undefined;

    this.state = {
      graphEmpty: false,
    };
  }

  componentDidMount() {
    this.graph = new Graph(this.canvasRef.current, this.props.options);
  }

  componentWillUnmount() {
    if (this.requestId) {
      cancelAnimationFrame(this.requestId);
      this.requestId = 0;
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

    if (prevProps.paused && !this.props.paused) {
      this.graph.reset();
    }

    // A load, seek, mode change or playback exit invalidates the accumulated
    // samples and the beginGraphNowMs anchor: replay timestamps run on a virtual
    // clock, live ones on the robot's, and a seek re-sends history that predates
    // what is already plotted. Must happen before the add below.
    const didReset = prevProps.resetToken !== this.props.resetToken;
    if (didReset) {
      this.graph.reset();
      this.lastRenderMs = undefined;
    } else if (prevProps.showRecorded && !this.props.showRecorded) {
      this.graph.dropRecorded();
      graphIsDirty = true;
    }

    const dataChanged = !isEqual(this.props.data, prevProps.data);

    if (!this.props.paused && dataChanged) {
      this.graph.add(Date.now(), this.props.data);
    }

    // Scrubbing a paused replay still has to redraw: the RAF loop is stopped,
    // so this is the only place a paused plot adds samples or repaints. On
    // dataChanged as well as the reset, since a seek arrives as several commits
    // and only one carries the token. Gated on replayDriven because `paused` is
    // also the panel's own Pause, which must actually pause a live graph.
    if (
      this.props.replayDriven &&
      this.props.paused &&
      (didReset || dataChanged)
    ) {
      const now = Date.now();
      // Remembered for onResize below, which otherwise re-renders a scrubbed
      // replay against pausedTime -- the instant the transport was paused,
      // which after any scrub is nowhere near what is on screen, so resizing
      // the panel threw the trace outside the window.
      this.lastRenderMs = now;
      this.graph.add(now, this.props.data);
      this.setState(() => ({
        graphEmpty: !this.graph.render(now),
      }));
    }

    if (!this.props.paused && !this.requestId) graphIsDirty = true;

    if (graphIsDirty) this.renderGraph();
  }

  renderGraph() {
    // Idempotent. This both schedules the next frame and stores its id, so
    // calling it while a chain is already running started a second chain and
    // overwrote the first one's id. The orphan then ran forever: unmount can
    // only cancel the id it can see, so the lost chain kept rendering into a
    // detached canvas and setting state on an unmounted component.
    if (this.requestId) cancelAnimationFrame(this.requestId);

    if (this.props.paused) {
      this.requestId = 0;
    } else {
      this.setState(() => ({
        graphEmpty: !this.graph.render(Date.now()),
      }));

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
              if (this.graph && this.props.paused) {
                // A live graph freezes at the moment it was paused; a scrubbed
                // replay is showing wherever the playhead was left.
                this.graph.render(this.lastRenderMs ?? this.props.pausedTime);
              }
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

GraphCanvas.propTypes = {
  showRecorded: PropTypes.bool,
  replayDriven: PropTypes.bool,
  data: PropTypes.arrayOf(PropTypes.any).isRequired,
  options: PropTypes.object.isRequired,
  paused: PropTypes.bool.isRequired,
  pausedTime: PropTypes.number.isRequired,
  resetToken: PropTypes.number,
};

export default GraphCanvas;
