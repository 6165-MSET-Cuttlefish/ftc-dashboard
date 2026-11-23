package com.acmerobotics.dashboard;

import com.acmerobotics.dashboard.message.redux.ReceiveLogcatErrors;

public final class UserCodeCrash {
    public static final String MESSAGE = "User code threw an uncaught exception";

    private long since;
    private String message = "";
    private String awaitingTag;

    public UserCodeCrash(long sinceMillis) {
        since = sinceMillis;
    }

    public synchronized void reset(long sinceMillis) {
        since = sinceMillis;
        message = "";
        awaitingTag = null;
    }

    public synchronized void accept(ReceiveLogcatErrors.LogcatError entry) {
        if (entry.getTimestamp() < since) {
            return;
        }

        if (entry.getMessage().endsWith(MESSAGE)) {
            message = entry.getTag() + ": " + MESSAGE;
            awaitingTag = entry.getTag();
        } else if (entry.getTag().equals(awaitingTag)) {
            message += ": " + entry.getMessage();
            awaitingTag = null;
        }
    }

    public synchronized String getMessage() {
        return message;
    }
}
