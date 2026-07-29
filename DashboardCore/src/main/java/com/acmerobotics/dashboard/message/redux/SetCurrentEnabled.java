package com.acmerobotics.dashboard.message.redux;

import com.acmerobotics.dashboard.message.Message;
import com.acmerobotics.dashboard.message.MessageType;

/**
 * Toggles battery current monitoring. Reading the current draw off each hub costs an extra
 * round trip on the Lynx bus, so it stays off until a client asks for it.
 */
public class SetCurrentEnabled extends Message {
    private boolean currentEnabled;

    public SetCurrentEnabled(boolean currentEnabled) {
        super(MessageType.SET_CURRENT_ENABLED);

        this.currentEnabled = currentEnabled;
    }

    public boolean isCurrentEnabled() {
        return currentEnabled;
    }
}
