import { useState, useCallback, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { isEqual } from 'lodash';
import { GamepadState } from '@/store/types';
import { sendGamepadState } from '@/store/actions/gamepad';
import { AppThunkDispatch } from '@/store/reducers';

const createInitialGamepadState = (): GamepadState => ({
  left_stick_x: 0,
  left_stick_y: 0,
  right_stick_x: 0,
  right_stick_y: 0,
  dpad_up: false,
  dpad_down: false,
  dpad_left: false,
  dpad_right: false,
  a: false,
  b: false,
  x: false,
  y: false,
  guide: false,
  start: false,
  back: false,
  left_bumper: false,
  right_bumper: false,
  left_stick_button: false,
  right_stick_button: false,
  left_trigger: 0,
  right_trigger: 0,
});

const REST_GAMEPAD_STATE = createInitialGamepadState();

export const useGamepadState = (hardwareConnected: boolean) => {
  const dispatch = useDispatch<AppThunkDispatch>();
  const [gamepad1State, setGamepad1State] = useState<GamepadState>(
    createInitialGamepadState(),
  );
  const [gamepad2State, setGamepad2State] = useState<GamepadState>(
    createInitialGamepadState(),
  );

  // Use refs to track the latest state for the interval
  const gamepad1StateRef = useRef(gamepad1State);
  const gamepad2StateRef = useRef(gamepad2State);

  useEffect(() => {
    if (hardwareConnected) return;

    let restSent = true;
    const intervalId = setInterval(() => {
      const atRest =
        isEqual(gamepad1StateRef.current, REST_GAMEPAD_STATE) &&
        isEqual(gamepad2StateRef.current, REST_GAMEPAD_STATE);
      if (atRest && restSent) return;

      restSent = atRest;
      dispatch(
        sendGamepadState(gamepad1StateRef.current, gamepad2StateRef.current),
      );
    }, 100);

    return () => clearInterval(intervalId);
  }, [dispatch, hardwareConnected]);

  const updateGamepadState = useCallback(
    (gamepadNum: 1 | 2, newState: Partial<GamepadState>) => {
      if (gamepadNum === 1) {
        setGamepad1State((prev) => {
          const updatedState = { ...prev, ...newState };
          gamepad1StateRef.current = updatedState;
          return updatedState;
        });
        dispatch(
          sendGamepadState(
            { ...gamepad1StateRef.current, ...newState },
            gamepad2StateRef.current,
          ),
        );
      } else {
        setGamepad2State((prev) => {
          const updatedState = { ...prev, ...newState };
          gamepad2StateRef.current = updatedState;
          return updatedState;
        });
        dispatch(
          sendGamepadState(gamepad1StateRef.current, {
            ...gamepad2StateRef.current,
            ...newState,
          }),
        );
      }
    },
    [dispatch],
  );

  return {
    gamepad1State,
    gamepad2State,
    updateGamepadState,
  };
};

export const createButtonToggleHandler = (
  gamepadState: GamepadState,
  gamepadNum: 1 | 2,
  buttonKey: keyof GamepadState,
  updateGamepadState: (
    gamepadNum: 1 | 2,
    newState: Partial<GamepadState>,
  ) => void,
) => {
  return () => {
    const currentValue = gamepadState[buttonKey];
    const newValue =
      typeof currentValue === 'number'
        ? currentValue > 0
          ? 0
          : 1
        : !currentValue;
    updateGamepadState(gamepadNum, { [buttonKey]: newValue });
  };
};

export const resetGamepad = (
  gamepadNum: 1 | 2,
  updateGamepadState: (
    gamepadNum: 1 | 2,
    newState: Partial<GamepadState>,
  ) => void,
) => {
  const neutralState = createInitialGamepadState();
  updateGamepadState(gamepadNum, neutralState);
};
