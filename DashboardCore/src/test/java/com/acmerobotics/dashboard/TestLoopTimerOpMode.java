package com.acmerobotics.dashboard;

import com.acmerobotics.dashboard.telemetry.LoopTimer;
import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import com.acmerobotics.dashboard.testopmode.TestOpMode;

/**
 * Drives the Loop Time view without a robot. Simulates a loop made of four stages, one of which
 * spikes periodically so the breakdown visibly shifts.
 */
public class TestLoopTimerOpMode extends TestOpMode {
    private LoopTimer timer;
    private TestDashboardInstance dashboard;

    private long lastReport;
    private int iteration;

    public TestLoopTimerOpMode() {
        super("TestLoopTimerOpMode");
    }

    @Override
    protected void init() {
        dashboard = TestDashboardInstance.getInstance();
        timer = new LoopTimer();
        lastReport = System.currentTimeMillis();
        iteration = 0;
    }

    @Override
    protected void loop() throws InterruptedException {
        timer.startLoop();

        timer.beginSegment("sensors");
        busyWait(1.5 + 0.5 * Math.sin(iteration / 20.0));

        timer.beginSegment("vision");
        // Every 40th iteration takes a long detour, the kind of spike that
        // averages hide but the max column and sparkline should surface.
        busyWait(iteration % 40 == 0 ? 22 : 6);

        timer.beginSegment("control");
        busyWait(2.5);

        timer.beginSegment("hardware writes");
        busyWait(3 + 2 * Math.random());

        timer.endLoop();
        iteration++;

        // Report at roughly the rate a real op mode sends telemetry, so the
        // view exercises the "mean over many loops" path.
        long now = System.currentTimeMillis();
        if (now - lastReport >= 50) {
            TelemetryPacket packet = new TelemetryPacket();
            timer.addTo(packet);
            dashboard.sendTelemetryPacket(packet);
            lastReport = now;
        }

        Thread.sleep(1);
    }

    /** Burns CPU for approximately the given number of milliseconds. */
    private static void busyWait(double millis) {
        long deadline = System.nanoTime() + (long) (millis * 1e6);
        while (System.nanoTime() < deadline) {
            // Spin; the point is to consume wall clock the way real work does.
        }
    }
}
