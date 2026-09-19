package com.acmerobotics.dashboard.telemetry;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * Measures how long each part of an op mode loop takes and reports the breakdown as telemetry the
 * dashboard's Loop Time view can chart.
 *
 * <p>Typical use:
 *
 * <pre>{@code
 * private final LoopTimer timer = new LoopTimer();
 *
 * public void loop() {
 *     timer.startLoop();
 *
 *     timer.beginSegment("sensors");
 *     readSensors();
 *
 *     timer.beginSegment("vision");
 *     processVision();
 *
 *     timer.beginSegment("drive");
 *     updateDrive();
 *
 *     timer.endLoop();
 *
 *     TelemetryPacket packet = new TelemetryPacket();
 *     timer.addTo(packet);
 *     FtcDashboard.getInstance().sendTelemetryPacket(packet);
 * }
 * }</pre>
 *
 * <p>Segments can also be scoped with try-with-resources:
 *
 * <pre>{@code
 * try (LoopTimer.Segment s = timer.segment("vision")) {
 *     processVision();
 * }
 * }</pre>
 *
 * <p>Loops usually run far faster than telemetry is sent, so timings are accumulated across every
 * loop since the last {@link #addTo} and reported as a per-loop mean. Nothing that happens between
 * packets is dropped.
 *
 * <p>Values are emitted in milliseconds under {@code <prefix>/<segment>}, with the whole loop under
 * {@code <prefix>/total}. This class is not thread-safe; drive it from the op mode thread only.
 */
public class LoopTimer {
    /** Key under which the whole loop's duration is reported, appended to the prefix. */
    public static final String TOTAL_KEY = "total";

    private static final double NANOS_PER_MILLI = 1e6;

    private final String prefix;
    private final LongSupplier clock;

    /** Nanoseconds accumulated per segment since the last report, cleared by addTo. */
    private final Map<String, Long> windowNanos = new LinkedHashMap<>();

    private String openSegment;
    private long openSegmentStart;

    private long loopStart;
    private boolean loopOpen;

    private int loopCount;
    private long windowTotalNanos;
    private long worstLoopNanos;

    /** Creates a timer that reports its segments under the "loop" telemetry key prefix. */
    public LoopTimer() {
        this("loop");
    }

    /**
     * Creates a timer reporting under the given telemetry key prefix.
     *
     * @param prefix key prefix, e.g. {@code loop} to report {@code loop/vision}
     */
    public LoopTimer(String prefix) {
        this(prefix, System::nanoTime);
    }

    /**
     * Creates a timer with an explicit nanosecond time source. Intended for tests.
     *
     * @param prefix key prefix
     * @param clock monotonic nanosecond source
     */
    public LoopTimer(String prefix, LongSupplier clock) {
        this.prefix = prefix;
        this.clock = clock;
    }

    /**
     * Marks the start of a loop iteration. Any segment left open by the previous iteration is
     * discarded.
     */
    public void startLoop() {
        openSegment = null;
        loopStart = clock.getAsLong();
        loopOpen = true;
    }

    /**
     * Closes the segment currently being timed, if any, and starts timing a new one. Calling this
     * repeatedly is the simplest way to walk through a loop.
     *
     * <p>Re-using a name within one iteration adds to that segment rather than replacing it, so a
     * step that runs twice is counted once in total.
     *
     * @param name segment name, used as the telemetry key suffix
     */
    public void beginSegment(String name) {
        if (!loopOpen) {
            startLoop();
        }

        closeOpenSegment();

        openSegment = name;
        openSegmentStart = clock.getAsLong();
    }

    /**
     * Closes the segment currently being timed. Optional when the next call is {@link
     * #beginSegment} or {@link #endLoop}.
     */
    public void endSegment() {
        closeOpenSegment();
    }

    /**
     * Marks the end of a loop iteration and folds its timings into the current reporting window.
     * Does nothing if no loop is open.
     */
    public void endLoop() {
        if (!loopOpen) {
            return;
        }

        closeOpenSegment();

        long elapsed = clock.getAsLong() - loopStart;
        windowTotalNanos += elapsed;
        worstLoopNanos = Math.max(worstLoopNanos, elapsed);
        loopCount++;
        loopOpen = false;
    }

    /**
     * Times a segment for the duration of a try-with-resources block. Segments are sequential, not
     * nested: opening one inside another closes the outer one, and the outer handle then closes as
     * a no-op.
     *
     * @param name segment name
     * @return a handle that closes the segment
     */
    public Segment segment(String name) {
        beginSegment(name);
        return new Segment(name);
    }

    /**
     * Writes the breakdown into the packet and starts a fresh reporting window.
     *
     * <p>Each segment is reported as its mean milliseconds per loop, alongside {@code
     * <prefix>/total}. Nothing is written when no loop has completed since the last call.
     *
     * @param packet packet to add the timings to
     */
    public void addTo(TelemetryPacket packet) {
        if (loopCount == 0) {
            return;
        }

        for (Map.Entry<String, Long> entry : windowNanos.entrySet()) {
            packet.put(prefix + "/" + entry.getKey(), millisPerLoop(entry.getValue()));
        }
        packet.put(prefix + "/" + TOTAL_KEY, millisPerLoop(windowTotalNanos));

        reset();
    }

    /**
     * Returns the mean loop duration over the current window in milliseconds, or 0 if no loop has
     * completed since the last {@link #addTo}.
     */
    public double getMeanLoopMillis() {
        return loopCount == 0 ? 0 : millisPerLoop(windowTotalNanos);
    }

    /**
     * Returns the longest single loop in the current window in milliseconds. Useful for catching
     * spikes that a mean hides.
     */
    public double getWorstLoopMillis() {
        return worstLoopNanos / NANOS_PER_MILLI;
    }

    /** Returns how many loops have completed since the last reported window. */
    public int getLoopCount() {
        return loopCount;
    }

    /** Discards the current window without reporting it. */
    public void reset() {
        windowNanos.clear();
        windowTotalNanos = 0;
        worstLoopNanos = 0;
        loopCount = 0;
    }

    private double millisPerLoop(long nanos) {
        return nanos / NANOS_PER_MILLI / loopCount;
    }

    private void closeOpenSegment() {
        if (openSegment == null) {
            return;
        }

        long elapsed = clock.getAsLong() - openSegmentStart;
        Long previous = windowNanos.get(openSegment);
        windowNanos.put(openSegment, previous == null ? elapsed : previous + elapsed);

        openSegment = null;
    }

    /** Scope handle returned by the segment method, for use in a try-with-resources block. */
    public class Segment implements AutoCloseable {
        private final String name;

        private Segment(String name) {
            this.name = name;
        }

        /** Ends this segment, unless something else has already replaced it as the open one. */
        @Override
        public void close() {
            if (name.equals(openSegment)) {
                endSegment();
            }
        }
    }
}
