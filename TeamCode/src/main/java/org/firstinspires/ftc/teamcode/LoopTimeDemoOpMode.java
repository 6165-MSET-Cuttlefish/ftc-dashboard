package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.FtcDashboard;
import com.acmerobotics.dashboard.config.Config;
import com.acmerobotics.dashboard.telemetry.LoopTimer;
import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

/**
 * Feeds the dashboard's Loop Time view a synthetic loop breakdown so it can be
 * tested on a bare Control Hub with no mechanisms attached.
 *
 * <p>Each loop is split into four "stages" that just burn the configured number
 * of milliseconds. Every {@link #SPIKE_EVERY} loops the vision stage takes
 * {@link #SPIKE_MS} instead, so the sparkline and the segment table's Max
 * column have something to show.
 *
 * <p>In the dashboard: add a <b>Loop Time</b> view, open its gear icon, and use
 * <b>Auto-add matching</b> (filter "loop") — it will pick up
 * {@code loop/sensors}, {@code loop/vision}, {@code loop/control},
 * {@code loop/hardware} and claim {@code loop/total} as the loop total.
 *
 * <p>All four stage durations and the spike are {@code @Config} fields, so you
 * can retune them live from the Config view while this runs.
 */
@Config
@TeleOp(name = "Loop Time Demo", group = "dash-test")
public class LoopTimeDemoOpMode extends LinearOpMode {
    public static double SENSORS_MS = 2.0;
    public static double VISION_MS = 6.0;
    public static double CONTROL_MS = 2.5;
    public static double HARDWARE_MS = 4.0;

    /**
     * Every Nth loop, the vision stage takes {@link #SPIKE_MS}. 0 disables.
     */
    public static int SPIKE_EVERY = 40;
    public static double SPIKE_MS = 22.0;

    /**
     * How often to push a telemetry packet, in milliseconds.
     */
    public static long REPORT_PERIOD_MS = 50;

    @Override
    public void runOpMode() {
        FtcDashboard dashboard = FtcDashboard.getInstance();
        LoopTimer timer = new LoopTimer();

        telemetry.addLine("Add a Loop Time view, then press start.");
        telemetry.update();

        waitForStart();

        long lastReport = System.currentTimeMillis();
        int iteration = 0;

        while (opModeIsActive()) {
            timer.startLoop();

            timer.beginSegment("sensors");
            busyWaitMillis(SENSORS_MS);

            timer.beginSegment("vision");
            boolean spiking = SPIKE_EVERY > 0 && iteration % SPIKE_EVERY == 0;
            busyWaitMillis(spiking ? SPIKE_MS : VISION_MS);

            timer.beginSegment("control");
            busyWaitMillis(CONTROL_MS);

            timer.beginSegment("hardware");
            busyWaitMillis(HARDWARE_MS);

            timer.endLoop();
            iteration++;

            long now = System.currentTimeMillis();
            if (now - lastReport >= REPORT_PERIOD_MS) {
                TelemetryPacket packet = new TelemetryPacket(false);
                timer.addTo(packet);
                packet.put("loop/worst (ms)", timer.getWorstLoopMillis());
                dashboard.sendTelemetryPacket(packet);
                lastReport = now;
            }
        }
    }

    /**
     * Consumes roughly {@code millis} of wall-clock time without yielding.
     */
    private static void busyWaitMillis(double millis) {
        if (millis <= 0) {
            return;
        }
        long deadline = System.nanoTime() + (long) (millis * 1e6);
        while (System.nanoTime() < deadline) {
            // Spin. A real op mode would be doing work here.
        }
    }
}
