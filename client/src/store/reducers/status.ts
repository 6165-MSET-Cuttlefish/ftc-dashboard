import OpModeStatus from '@/enums/OpModeStatus';
import {
  ReceiveOpModeListAction,
  ReceiveRobotStatusAction,
  GamepadSupportedStatus,
  SetCurrentEnabledAction,
  RECEIVE_OP_MODE_LIST,
  RECEIVE_ROBOT_STATUS,
  GAMEPAD_SUPPORTED_STATUS,
  SET_CURRENT_ENABLED,
  StatusState,
} from '@/store/types';

const initialState: StatusState = {
  enabled: true,
  available: false,
  activeOpMode: '',
  activeOpModeStatus: OpModeStatus.STOPPED,
  warningMessage: '',
  errorMessage: '',
  opModeInfoList: [],
  gamepadsSupported: true,
  batteryVoltage: -1.0,
  batteryCurrent: -1.0,
  currentEnabled: false,
};

const statusReducer = (
  state = initialState,
  action:
    | ReceiveRobotStatusAction
    | ReceiveOpModeListAction
    | GamepadSupportedStatus
    | SetCurrentEnabledAction,
) => {
  switch (action.type) {
    case RECEIVE_ROBOT_STATUS:
      return {
        ...state,
        ...action.status,
      };
    case RECEIVE_OP_MODE_LIST:
      return {
        ...state,
        opModeInfoList: action.opModeInfoList,
      };
    case GAMEPAD_SUPPORTED_STATUS:
      return {
        ...state,
        gamepadsSupported: action.gamepadsSupported,
      };
    case SET_CURRENT_ENABLED:
      return {
        ...state,
        currentEnabled: action.currentEnabled,
        // drop the stale reading so nothing lingers on screen until the robot replies
        batteryCurrent: -1.0,
      };
    default:
      return state;
  }
};

export default statusReducer;
