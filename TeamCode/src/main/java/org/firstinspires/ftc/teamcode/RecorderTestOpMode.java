package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.FtcDashboard;
import com.acmerobotics.dashboard.config.Config;
import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;

/**
 * Drives the Recorder feature through everything worth testing on real hardware.
 *
 * Supplies the data patterns that only real hardware exercises: SDK status
 * semantics, real packet rates and jitter, a link that can drop. Narrates each
 * phase on the driver station, so there is nothing to memorize.
 *
 * Run RecorderTestA, then RecorderTestB. They draw deliberately different paths
 * so compare mode has something to disagree about, and they are separate op mode
 * names so switching between them exercises the recorder's session boundary.
 */
public abstract class RecorderTestOpMode extends LinearOpMode {
    /**
     * Minutes to keep running after the scripted phases finish.
     *
     * Zero by default: the script itself is about a minute. Set this to 10 for
     * one run if you want to prove the status track survives past 8m20s, which
     * is where a bad cap used to start silently discarding it. Nothing else
     * needs the long run.
     */
    @Config
    public static class RecorderTestConfig {
        public static double EXTRA_MINUTES = 0;
        public static long PACKET_INTERVAL_MS = 20;
    }

    /** Which way the path curves, so the two runs visibly diverge. */
    protected abstract double pathSign();

    /** Colour of this run's path, so a ghost is distinguishable from live. */
    protected abstract String pathColor();

    private FtcDashboard dashboard;
    private double phaseStartedAt;
    private String phaseName = "";
    private int phaseIndex;

    private boolean phase(String name, double seconds) {
        if (!phaseName.equals(name)) {
            phaseName = name;
            phaseIndex++;
            phaseStartedAt = getRuntime();
        }
        return getRuntime() - phaseStartedAt < seconds;
    }

    private void nextPhase() {
        phaseName = "";
    }

    @Override
    public void runOpMode() throws InterruptedException {
        dashboard = FtcDashboard.getInstance();

        telemetry.addLine("Recorder hardware test");
        telemetry.addLine("The dashboard should already be open in a browser.");
        telemetry.addLine("Press START. It narrates itself from here.");
        telemetry.update();

        waitForStart();
        if (isStopRequested()) {
            return;
        }

        resetRuntime();

        // 1. Ordinary telemetry. Establishes the keys and gives the graph
        //    something continuous to plot.
        while (opModeIsActive() && phase("keys", 8)) {
            TelemetryPacket p = basePacket();
            double t = getRuntime();
            p.put("x", 40 * Math.cos(t) * pathSign());
            p.put("y", 40 * Math.sin(t * 0.7));
            p.put("heading", Math.sin(t) * 3);
            p.put("target", 34);
            drawPath(p, t);
            narrate(p, "1/8 keys: x, y, heading, target should all be graphable.");
            send(p);
        }
        nextPhase();

        // 2. A key stops being sent. TelemetryView accumulates keys, so it
        //    keeps showing its last value -- live and replayed alike. What is
        //    worth checking is that the two agree, since the codec reaches the
        //    same state by delta-encoding rather than by carrying the map.
        while (opModeIsActive() && phase("drop", 8)) {
            TelemetryPacket p = basePacket();
            double t = getRuntime();
            p.put("x", 40 * Math.cos(t) * pathSign());
            p.put("y", 40 * Math.sin(t * 0.7));
            p.put("heading", Math.sin(t) * 3);
            // `target` is deliberately absent from here on.
            p.put("phase", "DROPPED_TARGET");
            drawPath(p, t);
            narrate(p, "2/8 stopped sending 'target'. It stays on screen; that is by design.");
            send(p);
        }
        nextPhase();

        // 3. The same log line over and over, then silence, then the same line
        //    again. The encoder used to compare each log against the last
        //    non-empty one and drop the repeats, so a fault seen three times
        //    replayed once. Download the CSV afterwards and count.
        while (opModeIsActive() && phase("repeat", 6)) {
            TelemetryPacket p = basePacket();
            double t = getRuntime();
            p.put("x", 40 * Math.cos(t) * pathSign());
            p.put("y", 40 * Math.sin(t * 0.7));
            p.put("heading", Math.sin(t) * 3);
            p.addLine("STALL DETECTED");
            drawPath(p, t);
            narrate(p, "3/8 emitting the SAME log line repeatedly.");
            send(p);
        }
        nextPhase();

        while (opModeIsActive() && phase("quiet", 4)) {
            TelemetryPacket p = basePacket();
            double t = getRuntime();
            p.put("x", 40 * Math.cos(t) * pathSign());
            p.put("y", 40 * Math.sin(t * 0.7));
            p.put("heading", Math.sin(t) * 3);
            drawPath(p, t);
            narrate(p, "4/8 log silent.");
            send(p);
        }
        nextPhase();

        while (opModeIsActive() && phase("repeat2", 4)) {
            TelemetryPacket p = basePacket();
            double t = getRuntime();
            p.put("x", 40 * Math.cos(t) * pathSign());
            p.put("y", 40 * Math.sin(t * 0.7));
            p.put("heading", Math.sin(t) * 3);
            p.addLine("STALL DETECTED");
            drawPath(p, t);
            narrate(p, "5/8 the SAME line again after silence. Must appear twice.");
            send(p);
        }
        nextPhase();

        // 4. Values the graph must refuse rather than plot. A single Infinity
        //    rescales an auto-ranged axis so hard that every real sample
        //    collapses onto one line.
        while (opModeIsActive() && phase("nonfinite", 5)) {
            TelemetryPacket p = basePacket();
            double t = getRuntime();
            p.put("x", 40 * Math.cos(t) * pathSign());
            p.put("y", 40 * Math.sin(t * 0.7));
            p.put("heading", Math.sin(t) * 3);
            p.put("bad", (getRuntime() % 1.0) < 0.5 ? Double.NaN : Double.POSITIVE_INFINITY);
            drawPath(p, t);
            narrate(p, "6/8 emitting NaN/Infinity as 'bad'. The graph must stay readable.");
            send(p);
        }
        nextPhase();

        // 5. Every sticky canvas op at once: translation, rotation, scale,
        //    alpha, fill and stroke. In compare mode these are the ops that
        //    used to leak out of the ghost and re-colour, move and rotate the
        //    LIVE robot drawn after it.
        while (opModeIsActive() && phase("transforms", 8)) {
            TelemetryPacket p = basePacket();
            double t = getRuntime();
            p.put("x", 40 * Math.cos(t) * pathSign());
            p.put("y", 40 * Math.sin(t * 0.7));
            p.put("heading", Math.sin(t) * 3);
            drawPath(p, t);

            p.fieldOverlay()
                .setTranslation(10 * pathSign(), -10)
                .setRotation(Math.toRadians(35))
                .setScale(0.6, 0.6)
                .setAlpha(0.5)
                .setStroke("magenta")
                .setFill("magenta")
                .setStrokeWidth(3)
                .fillRect(-8, -8, 16, 16);

            narrate(p, "7/8 transform + alpha + colour stress.");
            send(p);
        }
        nextPhase();

        // 6. Background layer. `field()` is what the dashboard core seeds into
        //    every packet; drawing to it explicitly checks that the background
        //    and the op mode's own drawing stay separate through record and
        //    replay, which is what keeps a recording from painting a second
        //    field over the live one.
        while (opModeIsActive() && phase("background", 6)) {
            TelemetryPacket p = new TelemetryPacket(false);
            double t = getRuntime();
            p.field()
                .drawImage("/dash/decode.webp", -72, -72, 144, 144)
                .drawGrid(0, 0, 144, 144, 7, 7);
            p.put("x", 40 * Math.cos(t) * pathSign());
            p.put("y", 40 * Math.sin(t * 0.7));
            p.put("heading", Math.sin(t) * 3);
            drawPath(p, t);
            narrate(p, "8/8 explicit background layer.");
            send(p);
        }
        nextPhase();

        // 7. The clearing primitive, which is also the op mode pre-init reset.
        //    A recorded clear must reset the replayed telemetry keys without
        //    wiping anything it should not.
        TelemetryPacket clear = basePacket();
        clear.clearLines();
        clear.addLine("CLEARED");
        send(clear);

        double extraSeconds = RecorderTestConfig.EXTRA_MINUTES * 60;
        while (opModeIsActive() && phase("tail", extraSeconds)) {
            TelemetryPacket p = basePacket();
            double t = getRuntime();
            p.put("x", 40 * Math.cos(t) * pathSign());
            p.put("y", 40 * Math.sin(t * 0.7));
            p.put("heading", Math.sin(t) * 3);
            drawPath(p, t);
            narrate(p, "Long tail: proving the status track survives past 8m20s.");
            send(p);
        }

        telemetry.addLine("Script complete. Press STOP.");
        telemetry.addLine("Then open the Recorder panel and hit Review.");
        telemetry.update();

        while (opModeIsActive()) {
            sleep(50);
        }
    }

    private TelemetryPacket basePacket() {
        return new TelemetryPacket();
    }

    /** A path that differs between the two runs, so compare mode has contrast. */
    private void drawPath(TelemetryPacket p, double t) {
        double x = 40 * Math.cos(t) * pathSign();
        double y = 40 * Math.sin(t * 0.7);

        p.fieldOverlay()
            .setStroke(pathColor())
            .setStrokeWidth(2)
            .strokeCircle(x, y, 6)
            .strokeLine(x, y, x + 10 * Math.cos(t), y + 10 * Math.sin(t));
    }

    private void narrate(TelemetryPacket p, String line) {
        p.put("phaseIndex", phaseIndex);
        // Which run's ink is which, when both are on the field at once.
        p.put("pathColor", pathColor());
        telemetry.addData("phase", line);
        telemetry.addData("runtime", "%.1fs", getRuntime());
        telemetry.update();
    }

    private void send(TelemetryPacket p) throws InterruptedException {
        dashboard.sendTelemetryPacket(p);
        sleep(RecorderTestConfig.PACKET_INTERVAL_MS);
    }

    /** First of the pair. Run this one, stop it, then run B. */
    @Autonomous(name = "RecorderTestA", group = "recorder-test")
    public static class RecorderTestA extends RecorderTestOpMode {
        @Override
        protected double pathSign() {
            return 1;
        }

        @Override
        protected String pathColor() {
            return "#3F51B5";
        }
    }

    /** Second of the pair. Curves the other way so a ghost is obvious. */
    @Autonomous(name = "RecorderTestB", group = "recorder-test")
    public static class RecorderTestB extends RecorderTestOpMode {
        @Override
        protected double pathSign() {
            return -1;
        }

        @Override
        protected String pathColor() {
            return "#E91E63";
        }
    }
}
