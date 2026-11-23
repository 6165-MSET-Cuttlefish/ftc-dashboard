package com.acmerobotics.dashboard;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Locale;

public final class LogcatTimestamp {
    private final SimpleDateFormat format =
            new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US);
    private final String year;

    public LogcatTimestamp(int year) {
        this.year = String.valueOf(year);
    }

    public long parse(String date, String time, long fallbackMillis) {
        try {
            return format.parse(year + "-" + date + " " + time).getTime();
        } catch (ParseException e) {
            return fallbackMillis;
        }
    }
}
