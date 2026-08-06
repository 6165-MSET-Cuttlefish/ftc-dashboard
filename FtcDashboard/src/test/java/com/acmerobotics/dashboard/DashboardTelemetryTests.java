package com.acmerobotics.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.firstinspires.ftc.robotcore.external.Telemetry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Exercises the telemetry model against the semantics the SDK's own implementation has, which is
 * what the dashboard is trying to match.
 */
public class DashboardTelemetryTests {
    private final List<TelemetryPacket> sent = new ArrayList<>();
    private int interval;
    private DashboardTelemetry telemetry;

    @BeforeEach
    public void setUp() {
        sent.clear();
        interval = 100;
        telemetry =
                new DashboardTelemetry(
                        new DashboardTelemetry.Host() {
                            @Override
                            public void sendTelemetryPacket(TelemetryPacket packet) {
                                sent.add(packet);
                            }

                            @Override
                            public int getTelemetryTransmissionInterval() {
                                return interval;
                            }

                            @Override
                            public void setTelemetryTransmissionInterval(int newInterval) {
                                interval = newInterval;
                            }
                        });
    }

    private List<String> linesOf(TelemetryPacket packet) {
        List<String> lines = new ArrayList<>();
        for (TelemetryPacket.Item item : packet.getItems()) {
            lines.add(
                    item.getCaption() == null
                            ? item.getValue()
                            : item.getCaption() + ": " + item.getValue());
        }
        return lines;
    }

    private List<String> update() {
        telemetry.update();
        return linesOf(sent.get(sent.size() - 1));
    }

    @Test
    public void itemsAndLinesDisplayInTheOrderTheyWereAdded() {
        telemetry.addData("zebra", 1);
        telemetry.addLine("--- drive ---");
        telemetry.addData("apple", 2);

        assertEquals(Arrays.asList("zebra: 1", "--- drive ---", "apple: 2"), update());
    }

    @Test
    public void floatingPointValuesAreRoundedTheWayTheSdkRoundsThem() {
        telemetry.addData("Heading", 37.51234567);
        telemetry.addData("Power", 1.0);

        assertEquals(Arrays.asList("Heading: 37.5123", "Power: 1"), update());
    }

    @Test
    public void theKeyedDataKeepsFullPrecisionForTheGraph() {
        telemetry.addData("Heading", 37.51234567);
        telemetry.update();

        assertEquals("37.51234567", sent.get(0).getData().get("Heading"));
    }

    @Test
    public void setNumDecimalPlacesChangesTheRounding() {
        telemetry.setNumDecimalPlaces(0, 1);
        telemetry.addData("Heading", 37.51234567);

        assertEquals(Arrays.asList("Heading: 37.5"), update());
    }

    @Test
    public void nullValueRendersEmptyAsInTheSdk() {
        telemetry.addData("nothing", null);

        assertEquals(Arrays.asList("nothing: "), update());
    }

    @Test
    public void addDataReturnsAUsableItem() {
        Telemetry.Item item = telemetry.addData("count", 0);
        item.setValue(5);

        assertEquals(Arrays.asList("count: 5"), update());
    }

    @Test
    public void lineComposesItsItemsLikeTheSdk() {
        telemetry.addLine("sticks").addData("x", 0.5).addData("y", -0.25);

        assertEquals(Arrays.asList("sticks" + "x: 0.5 | y: -0.25"), update());
    }

    @Test
    public void chainingOffALineItemStaysInThatLine() {
        Telemetry.Item x = telemetry.addLine("sticks").addData("x", 1);
        x.addData("y", 2);

        assertEquals(Arrays.asList("sticks" + "x: 1 | y: 2"), update());
    }

    @Test
    public void chainingOffATopLevelItemAddsAnotherTopLevelLine() {
        telemetry.addData("a", 1).addData("b", 2);

        assertEquals(Arrays.asList("a: 1", "b: 2"), update());
    }

    @Test
    public void autoClearReplacesTelemetryEachUpdate() {
        telemetry.addData("a", 1);
        update();

        telemetry.addData("b", 2);
        assertEquals(Arrays.asList("b: 2"), update());
    }

    @Test
    public void autoClearOffAccumulatesAcrossUpdates() {
        telemetry.setAutoClear(false);
        telemetry.addData("a", 1);
        update();

        telemetry.addData("b", 2);
        assertEquals(Arrays.asList("a: 1", "b: 2"), update());
    }

    @Test
    public void producerIsRetainedAndReEvaluatedEachUpdate() {
        int[] reads = {0};
        telemetry.addData("count", () -> ++reads[0]);

        assertEquals(Arrays.asList("count: 1"), update());
        assertEquals(Arrays.asList("count: 2"), update());
        assertEquals(2, reads[0], "the producer must be read exactly once per update");
    }

    @Test
    public void retainedItemSurvivesClear() {
        telemetry.addData("kept", 1).setRetained(true);
        telemetry.addData("gone", 2);
        telemetry.clear();

        assertEquals(Arrays.asList("kept: 1"), update());
    }

    @Test
    public void clearAllDropsRetainedItemsButKeepsTheLog() {
        telemetry.addData("kept", 1).setRetained(true);
        telemetry.log().add("event");
        telemetry.clearAll();
        telemetry.update();

        assertEquals(Collections.<String>emptyList(), linesOf(sent.get(0)));
        assertEquals(Arrays.asList("event"), sent.get(0).getLog());
    }

    @Test
    public void theLogPersistsAcrossUpdatesAndSitsBelowTheItems() {
        telemetry.log().add("started");
        telemetry.addData("a", 1);
        telemetry.update();
        telemetry.addData("a", 2);
        telemetry.update();

        assertEquals(Arrays.asList("started"), sent.get(1).getLog());
    }

    @Test
    public void theLogIsCappedAtTheSdkCapacity() {
        for (int i = 0; i < 15; i++) {
            telemetry.log().add("entry " + i);
        }
        telemetry.update();

        assertEquals(9, sent.get(0).getLog().size());
        assertEquals("entry 6", sent.get(0).getLog().get(0));
    }

    @Test
    public void removeItemRemovesATopLevelItemAndOneInsideALine() {
        Telemetry.Item top = telemetry.addData("top", 1);
        Telemetry.Item nested = telemetry.addLine("line").addData("nested", 2);

        assertTrue(telemetry.removeItem(top));
        assertTrue(telemetry.removeItem(nested));
        assertEquals(Arrays.asList("line"), update());
    }

    @Test
    public void anActionRunsOnceBeforeEachUpdate() {
        int[] runs = {0};
        telemetry.addAction(() -> runs[0]++);

        telemetry.update();
        telemetry.update();

        assertEquals(2, runs[0]);
    }

    @Test
    public void resetRestoresTheDefaultsForANewOpMode() {
        telemetry.setAutoClear(false);
        telemetry.setDisplayFormat(Telemetry.DisplayFormat.HTML);
        telemetry.addData("stale", 1);
        telemetry.log().add("stale");

        telemetry.reset();
        telemetry.update();

        assertTrue(telemetry.isAutoClear());
        assertEquals(Collections.<String>emptyList(), linesOf(sent.get(0)));
        assertEquals(Collections.<String>emptyList(), sent.get(0).getLog());
        assertEquals(TelemetryPacket.DisplayFormat.CLASSIC, sent.get(0).getDisplayFormat());
    }

    @Test
    public void theDisplayFormatIsStampedOnEveryPacket() {
        telemetry.setDisplayFormat(Telemetry.DisplayFormat.HTML);
        telemetry.addData("a", 1);
        telemetry.update();
        telemetry.update();

        assertEquals(TelemetryPacket.DisplayFormat.HTML, sent.get(1).getDisplayFormat());
    }

    @Test
    public void everyPacketDeclaresItselfATelemetryFrame() {
        telemetry.update();

        assertTrue(sent.get(0).isTelemetryFrame());
    }
}
