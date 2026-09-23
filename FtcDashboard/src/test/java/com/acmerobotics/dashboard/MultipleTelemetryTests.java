package com.acmerobotics.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.acmerobotics.dashboard.telemetry.MultipleTelemetry;
import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.firstinspires.ftc.robotcore.external.Telemetry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

public class MultipleTelemetryTests {
    private final List<TelemetryPacket> sentA = new ArrayList<>();
    private final List<TelemetryPacket> sentB = new ArrayList<>();
    private MultipleTelemetry telemetry;

    private static DashboardTelemetry delegate(List<TelemetryPacket> sent) {
        return new DashboardTelemetry(
                new DashboardTelemetry.Host() {
                    @Override
                    public void sendTelemetryPacket(TelemetryPacket packet) {
                        sent.add(packet);
                    }

                    @Override
                    public int getTelemetryTransmissionInterval() {
                        return 100;
                    }

                    @Override
                    public void setTelemetryTransmissionInterval(int interval) {}
                });
    }

    private static List<String> linesOf(List<TelemetryPacket> sent) {
        List<String> lines = new ArrayList<>();
        for (TelemetryPacket.Item item : sent.get(sent.size() - 1).getItems()) {
            lines.add(
                    item.getCaption() == null
                            ? item.getValue()
                            : item.getCaption() + ": " + item.getValue());
        }
        return lines;
    }

    @BeforeEach
    public void setUp() {
        telemetry = new MultipleTelemetry(delegate(sentA), delegate(sentB));
    }

    @Test
    public void removeItemRemovesEachDelegatesOwnItem() {
        Telemetry.Item gone = telemetry.addData("gone", 1);
        telemetry.addData("kept", 2);

        assertTrue(telemetry.removeItem(gone));
        telemetry.update();

        assertEquals(Arrays.asList("kept: 2"), linesOf(sentA));
        assertEquals(Arrays.asList("kept: 2"), linesOf(sentB));
    }

    @Test
    public void removeItemReachesAnItemInsideALine() {
        Telemetry.Line line = telemetry.addLine("pose ");
        Telemetry.Item gone = line.addData("x", 1);
        line.addData("y", 2);

        assertTrue(telemetry.removeItem(gone));
        telemetry.update();

        assertEquals(Arrays.asList("pose y : 2"), linesOf(sentA));
        assertEquals(Arrays.asList("pose y : 2"), linesOf(sentB));
    }

    @Test
    public void removeLineRemovesEachDelegatesOwnLine() {
        Telemetry.Line gone = telemetry.addLine("gone");
        gone.addData("x", 1);
        telemetry.addData("kept", 2);

        assertTrue(telemetry.removeLine(gone));
        telemetry.update();

        assertEquals(Arrays.asList("kept: 2"), linesOf(sentA));
        assertEquals(Arrays.asList("kept: 2"), linesOf(sentB));
    }

    @Test
    public void delegateAddedLaterDoesNotFailTheRemoval() {
        Telemetry.Item gone = telemetry.addData("gone", 1);
        List<TelemetryPacket> sentC = new ArrayList<>();
        telemetry.addTelemetry(delegate(sentC));

        assertTrue(telemetry.removeItem(gone));
    }
}
