package com.acmerobotics.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Calendar;
import java.util.GregorianCalendar;
import org.junit.jupiter.api.Test;

public class LogcatTimestampTests {
    @Test
    public void readsTheLocalWallClockTime() {
        Calendar expected = new GregorianCalendar(2026, Calendar.JANUARY, 15, 10, 30, 45);
        expected.set(Calendar.MILLISECOND, 123);

        long parsed = new LogcatTimestamp(2026).parse("01-15", "10:30:45.123", 0);

        assertEquals(expected.getTimeInMillis(), parsed);
    }

    @Test
    public void keepsMillisecondsBetweenLines() {
        LogcatTimestamp timestamp = new LogcatTimestamp(2026);

        long first = timestamp.parse("01-15", "10:30:45.123", 0);
        long second = timestamp.parse("01-15", "10:30:46.000", 0);

        assertEquals(877, second - first);
    }

    @Test
    public void ordersLinesAcrossMidnight() {
        LogcatTimestamp timestamp = new LogcatTimestamp(2026);

        long before = timestamp.parse("01-15", "23:59:59.900", 0);
        long after = timestamp.parse("01-16", "00:00:00.100", 0);

        assertEquals(200, after - before);
    }

    @Test
    public void usesTheGivenYear() {
        long thisYear = new LogcatTimestamp(2026).parse("06-01", "12:00:00.000", 0);
        long lastYear = new LogcatTimestamp(2025).parse("06-01", "12:00:00.000", 0);

        assertEquals(365L * 24 * 60 * 60 * 1000, thisYear - lastYear);
    }

    @Test
    public void fallsBackWhenTheLineHasNoTimestamp() {
        long parsed = new LogcatTimestamp(2026).parse("---------", "beginning", 42);

        assertEquals(42, parsed);
    }
}
