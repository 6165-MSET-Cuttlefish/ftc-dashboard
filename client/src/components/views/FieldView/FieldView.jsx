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
    // Seed from whatever is already in the store. Without this a tile added while
    // the stream is idle (a paused replay, or a stalled socket) stays blank until
    // the next batch arrives, even though the state already holds a full frame.
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

    // Background and drawing kept apart so the ghost can layer between them.
    // `field` is what the dashboard seeds (image and grid), `fieldOverlay` what
    // the op mode draws. A packet with no background ops did not carry one; it
    // does not mean there is none. The background only ever arrives inside a
    // packet, so taking an empty `field.ops` literally leaves the panel blank
    // until the next op mode runs.
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

    // Everything Field.js carries from one op to the next, put back as if the
    // ghost had not drawn. alpha is not the only sticky op: scale, rotation and
    // translate accumulate into a user transform and fill/stroke/strokeWidth sit
    // on the context, so a recording setting any of them re-colours, moves or
    // rotates the LIVE robot drawn after it.
    const GHOST_RESET = [
      { type: 'alpha', alpha: 1 },
      { type: 'translate', x: 0, y: 0 },
      { type: 'rotation', rotation: 0 },
      { type: 'scale', scaleX: 1, scaleY: 1 },
      { type: 'fill', color: '#000' },
      { type: 'stroke', color: '#000' },
      { type: 'strokeWidth', width: 1 },
    ];

    // Field image, then the recording, then the live robot on top. The ghost is
    // reference material and belongs behind, which is what the panel claims.
    // The trailing GHOST_RESET is load-bearing: Field.js applies these ops
    // absolutely and they persist, so without it every live op after the ghost
    // inherits the ghost's state.
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
