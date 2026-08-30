import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import BaseView, { BaseViewHeading } from '@/components/views/BaseView';
import ReplayBadge from '@/components/views/ReplayBadge';
import Field from './Field';
import AutoFitCanvas from '@/components/Canvas/AutoFitCanvas';

class FieldView extends React.Component {
  constructor(props) {
    super(props);

    this.canvasRef = React.createRef();

    this.renderField = this.renderField.bind(this);

    this.overlay = {
      bg: [],
      ops: [],
    };
  }

  componentDidMount() {
    this.field = new Field(this.canvasRef.current);
    // Seeded from the store, or a tile added while the stream is idle (paused
    // replay, stalled socket) stays blank until the next batch arrives.
    this.syncOverlay();
  }

  componentDidUpdate(prevProps) {
    if (
      this.props.telemetry === prevProps.telemetry &&
      this.props.replay === prevProps.replay
    )
      return;

    this.syncOverlay();
  }

  syncOverlay() {
    const replayOps = this.props.replay.ops;

    // Background (`field`) and drawing (`fieldOverlay`) kept apart so the ghost
    // can layer between them. An empty `field.ops` means the packet carried no
    // background, not that there is none, and one only ever arrives in a packet.
    this.overlay = this.props.telemetry.reduce(
      (acc, { field, fieldOverlay }) =>
        fieldOverlay.ops.length === 0
          ? acc
          : {
              bg: field.ops.length > 0 ? field.ops : acc.bg ?? [],
              ops: fieldOverlay.ops,
            },
      this.overlay,
    );

    // Every op Field.js carries across ops, reset as if the ghost had not drawn:
    // transforms accumulate and fill/stroke sit on the context, so a recording
    // that sets any of them re-colours or moves the live robot drawn after it.
    const GHOST_RESET = [
      { type: 'alpha', alpha: 1 },
      { type: 'translate', x: 0, y: 0 },
      { type: 'rotation', rotation: 0 },
      { type: 'scale', scaleX: 1, scaleY: 1 },
      { type: 'fill', color: '#000' },
      { type: 'stroke', color: '#000' },
      { type: 'strokeWidth', width: 1 },
    ];

    this.field.setOverlay({
      ...this.overlay,
      ops: [
        ...(this.overlay.bg ?? []),
        ...replayOps,
        ...(replayOps.length > 0 ? GHOST_RESET : []),
        ...this.overlay.ops,
      ],
    });
    this.renderField();
  }

  renderField() {
    if (this.field) {
      this.field.render();
    }
  }

  render() {
    return (
      <BaseView isUnlocked={this.props.isUnlocked}>
        <BaseViewHeading isDraggable={this.props.isDraggable}>
          Field
          {this.props.playbackMode === 'playback' && (
            <ReplayBadge source="replacing" />
          )}
          {this.props.playbackMode === 'ghost' && (
            <ReplayBadge source="alongside" />
          )}
        </BaseViewHeading>
        <AutoFitCanvas
          ref={this.canvasRef}
          onResize={this.renderField}
          containerHeight="calc(100% - 3em)"
        />
      </BaseView>
    );
  }
}

FieldView.propTypes = {
  telemetry: PropTypes.arrayOf(PropTypes.object).isRequired,
  replay: PropTypes.object.isRequired,
  playbackMode: PropTypes.string.isRequired,
  isDraggable: PropTypes.bool,
  isUnlocked: PropTypes.bool,
};

const mapStateToProps = ({ telemetry, replay, playback }) => ({
  telemetry,
  replay,
  playbackMode: playback.mode,
});

export default connect(mapStateToProps)(FieldView);
