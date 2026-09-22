package com.acmerobotics.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.acmerobotics.dashboard.telemetry.LoopTimer;
import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import com.google.gson.JsonObject;
import java.util.function.LongSupplier;
import org.junit.jupiter.api.Test;

public class LoopTimerTest {
    private static final double EPSILON = 1e-6;
    private static final long MILLI = 1_000_000L;

    /** Nanosecond clock the test advances by hand. */
    private static class FakeClock implements LongSupplier {
        private long nanos;

        void advanceMillis(long millis) {
            nanos += millis * MILLI;
        }

        @Override
        public long getAsLong() {
            return nanos;
        }
    }

    /** TelemetryPacket exposes its data only through serialization. */
    private static JsonObject dataOf(TelemetryPacket packet) {
        return DashboardCore.GSON.toJsonTree(packet).getAsJsonObject().getAsJsonObject("data");
    }

    private static double millis(TelemetryPacket packet, String key) {
        return Double.parseDouble(dataOf(packet).get(key).getAsString());
    }

    @Test
    public void reportsEachSegmentAndTheTotal() {
        FakeClock clock = new FakeClock();
        LoopTimer timer = new LoopTimer("loop", clock);

        timer.startLoop();
        timer.beginSegment("sensors");
        clock.advanceMillis(2);
        timer.beginSegment("vision");
        clock.advanceMillis(8);
        timer.beginSegment("drive");
        clock.advanceMillis(5);
        timer.endLoop();

        TelemetryPacket packet = new TelemetryPacket(false);
        timer.addTo(packet);

        assertEquals(2.0, millis(packet, "loop/sensors"), EPSILON);
        assertEquals(8.0, millis(packet, "loop/vision"), EPSILON);
        assertEquals(5.0, millis(packet, "loop/drive"), EPSILON);
        assertEquals(15.0, millis(packet, "loop/total"), EPSILON);
    }

    @Test
    public void averagesEveryLoopSinceTheLastReport() {
        FakeClock clock = new FakeClock();
        LoopTimer timer = new LoopTimer("loop", clock);

        for (long millis : new long[] {10, 20}) {
            timer.startLoop();
            timer.beginSegment("work");
            clock.advanceMillis(millis);
            timer.endLoop();
        }

        assertEquals(2, timer.getLoopCount());
        assertEquals(15.0, timer.getMeanLoopMillis(), EPSILON);
        assertEquals(20.0, timer.getWorstLoopMillis(), EPSILON);

        TelemetryPacket packet = new TelemetryPacket(false);
        timer.addTo(packet);

        assertEquals(15.0, millis(packet, "loop/work"), EPSILON);
    }

    @Test
    public void countsTimeOutsideAnySegmentAsUnaccounted() {
        FakeClock clock = new FakeClock();
        LoopTimer timer = new LoopTimer("loop", clock);

        timer.startLoop();
        clock.advanceMillis(3); // before the first segment
        timer.beginSegment("work");
        clock.advanceMillis(4);
        timer.endSegment();
        clock.advanceMillis(5); // after the last segment
        timer.endLoop();

        TelemetryPacket packet = new TelemetryPacket(false);
        timer.addTo(packet);

        assertEquals(4.0, millis(packet, "loop/work"), EPSILON);
        // The total covers the whole iteration, so 8 ms shows as unaccounted.
        assertEquals(12.0, millis(packet, "loop/total"), EPSILON);
    }

    @Test
    public void reusingASegmentNameAccumulates() {
        FakeClock clock = new FakeClock();
        LoopTimer timer = new LoopTimer("loop", clock);

        timer.startLoop();
        timer.beginSegment("io");
        clock.advanceMillis(3);
        timer.beginSegment("compute");
        clock.advanceMillis(1);
        timer.beginSegment("io");
        clock.advanceMillis(4);
        timer.endLoop();

        TelemetryPacket packet = new TelemetryPacket(false);
        timer.addTo(packet);

        assertEquals(7.0, millis(packet, "loop/io"), EPSILON);
    }

    @Test
    public void tryWithResourcesTimesTheBlock() {
        FakeClock clock = new FakeClock();
        LoopTimer timer = new LoopTimer("loop", clock);

        timer.startLoop();
        try (LoopTimer.Segment segment = timer.segment("vision")) {
            clock.advanceMillis(6);
        }
        timer.endLoop();

        TelemetryPacket packet = new TelemetryPacket(false);
        timer.addTo(packet);

        assertEquals(6.0, millis(packet, "loop/vision"), EPSILON);
    }

    @Test
    public void reportingStartsAFreshWindow() {
        FakeClock clock = new FakeClock();
        LoopTimer timer = new LoopTimer("loop", clock);

        timer.startLoop();
        timer.beginSegment("work");
        clock.advanceMillis(10);
        timer.endLoop();

        timer.addTo(new TelemetryPacket(false));
        assertEquals(0, timer.getLoopCount());

        TelemetryPacket second = new TelemetryPacket(false);
        timer.addTo(second);
        assertFalse(dataOf(second).has("loop/work"));
    }

    @Test
    public void discardsAnIterationThatNeverEnds() {
        FakeClock clock = new FakeClock();
        LoopTimer timer = new LoopTimer("loop", clock);

        timer.startLoop();
        timer.beginSegment("sensors");
        clock.advanceMillis(2);
        timer.beginSegment("vision");
        clock.advanceMillis(6);

        timer.startLoop();
        timer.beginSegment("sensors");
        clock.advanceMillis(2);
        timer.beginSegment("vision");
        clock.advanceMillis(6);
        timer.beginSegment("control");
        clock.advanceMillis(2);
        timer.endLoop();

        TelemetryPacket packet = new TelemetryPacket(false);
        timer.addTo(packet);

        assertEquals(2.0, millis(packet, "loop/sensors"), EPSILON);
        assertEquals(6.0, millis(packet, "loop/vision"), EPSILON);
        assertEquals(2.0, millis(packet, "loop/control"), EPSILON);
        assertEquals(10.0, millis(packet, "loop/total"), EPSILON);
    }

    @Test
    public void reportingClosesAnOpenLoop() {
        FakeClock clock = new FakeClock();
        LoopTimer timer = new LoopTimer("loop", clock);

        timer.startLoop();
        timer.beginSegment("work");
        clock.advanceMillis(9);

        TelemetryPacket packet = new TelemetryPacket(false);
        timer.addTo(packet);

        assertEquals(9.0, millis(packet, "loop/work"), EPSILON);
        assertEquals(9.0, millis(packet, "loop/total"), EPSILON);
    }

    @Test
    public void rejectsSegmentNamesItWritesItself() {
        LoopTimer timer = new LoopTimer("loop", new FakeClock());

        assertThrows(IllegalArgumentException.class, () -> timer.beginSegment("total"));
        assertThrows(IllegalArgumentException.class, () -> timer.beginSegment("worst"));
        assertThrows(IllegalArgumentException.class, () -> timer.segment("total"));
    }

    @Test
    public void reportsTheWorstLoopAndStartsOver() {
        FakeClock clock = new FakeClock();
        LoopTimer timer = new LoopTimer("loop", clock);

        for (long millis : new long[] {10, 30, 20}) {
            timer.startLoop();
            timer.beginSegment("work");
            clock.advanceMillis(millis);
            timer.endLoop();
        }

        TelemetryPacket packet = new TelemetryPacket(false);
        timer.addTo(packet);
        assertEquals(20.0, millis(packet, "loop/total"), EPSILON);
        assertEquals(30.0, millis(packet, "loop/worst"), EPSILON);

        timer.startLoop();
        timer.beginSegment("work");
        clock.advanceMillis(5);
        timer.endLoop();

        TelemetryPacket second = new TelemetryPacket(false);
        timer.addTo(second);
        assertEquals(5.0, millis(second, "loop/worst"), EPSILON);
    }

    @Test
    public void honorsACustomPrefix() {
        FakeClock clock = new FakeClock();
        LoopTimer timer = new LoopTimer("auto", clock);

        timer.startLoop();
        timer.beginSegment("path");
        clock.advanceMillis(1);
        timer.endLoop();

        TelemetryPacket packet = new TelemetryPacket(false);
        timer.addTo(packet);

        assertTrue(dataOf(packet).has("auto/path"));
        assertTrue(dataOf(packet).has("auto/total"));
    }
}
