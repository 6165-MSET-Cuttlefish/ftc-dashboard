import {
  StatusState,
  ReceiveOpModeListAction,
  ReceiveRobotStatusAction,
  RECEIVE_OP_MODE_LIST,
  RECEIVE_ROBOT_STATUS,
  SET_CURRENT_ENABLED,
  SetCurrentEnabledAction,
  OpModeInfo,
} from '@/store/types/status';

export const receiveRobotStatus = (
  status: StatusState,
): ReceiveRobotStatusAction => ({
  type: RECEIVE_ROBOT_STATUS,
  status,
});

export const receiveOpModeList = (
  opModeInfoList: OpModeInfo[],
): ReceiveOpModeListAction => ({
  type: RECEIVE_OP_MODE_LIST,
  opModeInfoList,
});

export const setCurrentEnabled = (
  currentEnabled: boolean,
): SetCurrentEnabledAction => ({
  type: SET_CURRENT_ENABLED,
  currentEnabled,
});
