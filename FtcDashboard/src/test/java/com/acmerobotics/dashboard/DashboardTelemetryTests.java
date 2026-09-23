package com.acmerobotics.dashboard;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
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
    public void repeatedCaptionIsDisplayedEachTimeItIsAdded() {
        telemetry.addData("Motor", "fl %.2f", 0.5);
        telemetry.addData("Motor", "fr %.2f", 0.25);
        telemetry.addData("Motor", "bl %.2f", 0.75);

        assertEquals(Arrays.asList("Motor: fl 0.50", "Motor: fr 0.25", "Motor: bl 0.75"), update());
        assertEquals("bl 0.75", sent.get(0).getData().get("Motor"));
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
    public void valuesAreRoundedWhenAddedNotWhenSent() {
        telemetry.addData("early", 1.23456789).setRetained(true);
        assertEquals(Arrays.asList("early: 1.2346"), update());

        telemetry.setNumDecimalPlaces(0, 1);
        telemetry.addData("late", 1.23456789);

        assertEquals(Arrays.asList("early: 1.2346", "late: 1.2"), update());
    }

    @Test
    public void producerValuesAreNotRoundedAsInTheSdk() {
        telemetry.addData("heading", () -> 1.23456789);

        assertEquals(Arrays.asList("heading: 1.23456789"), update());
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

        assertEquals(Arrays.asList("sticks" + "x : 0.5 | y : -0.25"), update());
    }

    @Test
    public void lineItemsReachTheKeyedDataLikeTopLevelItems() {
        telemetry.addLine("pose ").addData("x", "%.2f", 1.5).addData("heading", 90.123456);
        telemetry.addData("y", "%.2f", 2.5);
        telemetry.update();

        assertEquals("1.50", sent.get(0).getData().get("x"));
        assertEquals("90.123456", sent.get(0).getData().get("heading"));
        assertEquals("2.50", sent.get(0).getData().get("y"));
    }

    @Test
    public void chainingOffALineItemStaysInThatLine() {
        Telemetry.Item x = telemetry.addLine("sticks").addData("x", 1);
        x.addData("y", 2);

        assertEquals(Arrays.asList("sticks" + "x : 1 | y : 2"), update());
    }

    @Test
    public void lineProducersRunOutsideTheMonitor() throws InterruptedException {
        CountDownLatch reading = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        telemetry
                .addLine("slow ")
                .addData(
                        "x",
                        () -> {
                            reading.countDown();
                            try {
                                release.await();
                            } catch (InterruptedException e) {
                                Thread.currentThread().interrupt();
                            }
                            return 1;
                        });

        Thread updater = new Thread(telemetry::update);
        updater.start();
        try {
            assertTrue(reading.await(5, TimeUnit.SECONDS));

            Thread adder = new Thread(() -> telemetry.addData("other", 2));
            adder.start();
            adder.join(1000);

            assertFalse(adder.isAlive(), "addData must not wait for a line's producer");
        } finally {
            release.countDown();
            updater.join();
        }
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
    public void logEntriesAreNumberedInTheOrderTheyAreAdded() {
        telemetry.log().add("a");
        telemetry.log().add("b");
        telemetry.log().add("%d", 3);
        telemetry.update();

        assertEquals(Arrays.asList("a", "b", "3"), sent.get(0).getLog());
        assertArrayEquals(new long[] {1, 3}, sent.get(0).getLogRange());
    }

    @Test
    public void anEmptyLogIsUnnumbered() {
        telemetry.update();

        assertNull(sent.get(0).getLogRange());
    }

    @Test
    public void newestFirstLogIsNumberedFromItsNewestEntry() {
        telemetry.log().setDisplayOrder(Telemetry.Log.DisplayOrder.NEWEST_FIRST);
        telemetry.log().add("a");
        telemetry.log().add("b");
        telemetry.log().add("c");
        telemetry.update();

        assertEquals(Arrays.asList("c", "b", "a"), sent.get(0).getLog());
        assertArrayEquals(new long[] {3, 1}, sent.get(0).getLogRange());
    }

    // The text alone cannot show this entry is new: the log already held nine like it.
    @Test
    public void anEntryPushingOutAnIdenticalOneGetsTheNextNumber() {
        for (int i = 0; i < 9; i++) {
            telemetry.log().add("tick");
        }
        telemetry.update();
        telemetry.log().add("tick");
        telemetry.update();

        assertEquals(sent.get(0).getLog(), sent.get(1).getLog());
        assertArrayEquals(new long[] {1, 9}, sent.get(0).getLogRange());
        assertArrayEquals(new long[] {2, 10}, sent.get(1).getLogRange());
    }

    @Test
    public void prunedEntriesTakeTheirNumbersWithThemInEitherOrder() {
        for (int i = 0; i < 15; i++) {
            telemetry.log().add("entry " + i);
        }
        telemetry.update();
        telemetry.log().setCapacity(3);
        telemetry.log().setDisplayOrder(Telemetry.Log.DisplayOrder.NEWEST_FIRST);
        telemetry.update();

        assertArrayEquals(new long[] {7, 15}, sent.get(0).getLogRange());
        assertEquals(Arrays.asList("entry 14", "entry 13", "entry 12"), sent.get(1).getLog());
        assertArrayEquals(new long[] {15, 13}, sent.get(1).getLogRange());
    }

    @Test
    public void numberingContinuesAfterClear() {
        telemetry.log().add("a");
        telemetry.log().add("b");
        telemetry.log().clear();
        telemetry.update();
        telemetry.log().add("a");
        telemetry.update();

        assertEquals(Collections.<String>emptyList(), sent.get(0).getLog());
        assertNull(sent.get(0).getLogRange());
        assertArrayEquals(new long[] {3, 3}, sent.get(1).getLogRange());
    }

    // A client that misses the op mode change must still see the new entry as new.
    @Test
    public void numberingContinuesIntoTheNextOpMode() {
        telemetry.log().add("a");
        telemetry.update();
        telemetry.reset();
        telemetry.log().add("a");
        telemetry.update();

        assertArrayEquals(new long[] {2, 2}, sent.get(1).getLogRange());
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
    public void captionsAndValuesAreSeparatedAsInTheSdk() {
        telemetry.update();

        assertEquals(" : ", sent.get(0).getCaptionValueSeparator());
        assertEquals(" : ", telemetry.getCaptionValueSeparator());
    }

    @Test
    public void resetRestoresTheSdkSeparators() {
        telemetry.setCaptionValueSeparator("=");
        telemetry.setItemSeparator(", ");

        telemetry.reset();

        assertEquals(" : ", telemetry.getCaptionValueSeparator());
        assertEquals(" | ", telemetry.getItemSeparator());
    }

    @Test
    public void everyPacketDeclaresItselfATelemetryFrame() {
        telemetry.update();

        assertTrue(sent.get(0).isTelemetryFrame());
    }
}
