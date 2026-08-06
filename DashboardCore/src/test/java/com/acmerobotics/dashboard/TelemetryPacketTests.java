package com.acmerobotics.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.acmerobotics.dashboard.telemetry.TelemetryPacket;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

public class TelemetryPacketTests {
    // The real serializer, so these pin what actually goes on the wire. Notably it serializes
    // nulls, so a bare line is sent as "caption":null rather than omitting the key.
    private static JsonObject serialize(TelemetryPacket packet) {
        return DashboardCore.GSON.toJsonTree(packet).getAsJsonObject();
    }

    private static String items(TelemetryPacket packet) {
        return serialize(packet).get("items").toString();
    }

    @Test
    public void itemsFollowInsertionOrder() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.put("zebra", 1);
        packet.put("apple", 2);
        packet.put("Middle", 3);

        assertEquals(
                "[{\"caption\":\"zebra\",\"value\":\"1\"},"
                        + "{\"caption\":\"apple\",\"value\":\"2\"},"
                        + "{\"caption\":\"Middle\",\"value\":\"3\"}]",
                items(packet));
    }

    @Test
    public void numericCaptionsAreNotReordered() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.put("2", "two");
        packet.put("10", "ten");

        assertEquals(
                "[{\"caption\":\"2\",\"value\":\"two\"},{\"caption\":\"10\",\"value\":\"ten\"}]",
                items(packet));
    }

    @Test
    public void linesInterleaveWithItems() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.put("a", 1);
        packet.addLine("--- drive ---");
        packet.put("b", 2);

        assertEquals(
                "[{\"caption\":\"a\",\"value\":\"1\"},"
                        + "{\"caption\":null,\"value\":\"--- drive ---\"},"
                        + "{\"caption\":\"b\",\"value\":\"2\"}]",
                items(packet));
    }

    @Test
    public void repeatedKeyIsReplacedInPlace() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.put("a", 1);
        packet.put("b", 2);
        packet.put("a", 3);

        assertEquals(
                "[{\"caption\":\"a\",\"value\":\"3\"},{\"caption\":\"b\",\"value\":\"2\"}]",
                items(packet));
    }

    @Test
    public void nullValuesBecomeTheStringNull() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.put("a", null);
        packet.addLine(null);

        assertEquals(
                "[{\"caption\":\"a\",\"value\":\"null\"}," + "{\"caption\":null,\"value\":\"\"}]",
                items(packet));
    }

    @Test
    public void addItemReturnsAnAppendableHandle() {
        TelemetryPacket packet = new TelemetryPacket(false);
        TelemetryPacket.Item line = packet.addItem("sticks");
        line.appendValue(" | x: 0.5");
        line.appendValue(" | y: -0.25");
        packet.put("after", 1);

        assertEquals(
                "[{\"caption\":null,\"value\":\"sticks | x: 0.5 | y: -0.25\"},"
                        + "{\"caption\":\"after\",\"value\":\"1\"}]",
                items(packet));
    }

    // The SDK renders a null caption as the text "null" rather than failing, and the data map
    // cannot hold a null key at all.
    @Test
    public void nullCaptionIsRenderedRatherThanThrowing() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.put(null, 5);

        assertEquals("[{\"caption\":\"null\",\"value\":\"5\"}]", items(packet));
        assertEquals("{\"null\":\"5\"}", serialize(packet).get("data").toString());
    }

    @Test
    public void nullCaptionDoesNotOverwriteABareLine() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.addLine("a bare line");
        packet.put(null, 5);

        assertEquals(
                "[{\"caption\":null,\"value\":\"a bare line\"},"
                        + "{\"caption\":\"null\",\"value\":\"5\"}]",
                items(packet));
    }

    @Test
    public void putDataToleratesANullKey() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.putData(null, 5);

        assertEquals("{\"null\":\"5\"}", serialize(packet).get("data").toString());
    }

    @Test
    public void putDataIsNotDisplayed() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.addLine("sticks");
        packet.putData("x", 0.5);

        assertEquals("[{\"caption\":null,\"value\":\"sticks\"}]", items(packet));
        assertEquals("{\"x\":\"0.5\"}", serialize(packet).get("data").toString());
    }

    @Test
    public void clearLinesLeavesKeyedItemsAndLogAlone() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.put("a", 1);
        packet.addLine("gone");
        packet.addLogEntry("kept");
        packet.clearLines();

        assertEquals("[{\"caption\":\"a\",\"value\":\"1\"}]", items(packet));
        assertEquals("[\"kept\"]", serialize(packet).get("log").toString());
    }

    @Test
    public void clearLogLeavesItemsAlone() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.addLine("kept");
        packet.addLogEntry("gone");
        packet.clearLog();

        assertEquals("[{\"caption\":null,\"value\":\"kept\"}]", items(packet));
        assertEquals("[]", serialize(packet).get("log").toString());
    }

    @Test
    public void dataRemainsAKeyedMirror() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.put("zebra", 1);
        packet.put("apple", 2);
        packet.addLine("not data");

        assertEquals("{\"apple\":\"2\",\"zebra\":\"1\"}", serialize(packet).get("data").toString());
    }

    // A packet built directly has no Telemetry to call setDisplayFormat on, and never reaches a
    // Driver Station, so it keeps rendering markup the way the dashboard always has.
    @Test
    public void displayFormatDefaultsToHtml() {
        TelemetryPacket packet = new TelemetryPacket(false);

        assertEquals(TelemetryPacket.DisplayFormat.HTML, packet.getDisplayFormat());
        assertEquals("\"HTML\"", serialize(packet).get("displayFormat").toString());
    }

    @Test
    public void displayFormatIsSerializedByName() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.setDisplayFormat(TelemetryPacket.DisplayFormat.CLASSIC);

        assertEquals("\"CLASSIC\"", serialize(packet).get("displayFormat").toString());
    }

    @Test
    public void nullDisplayFormatFallsBackToTheDefault() {
        TelemetryPacket packet = new TelemetryPacket(false);
        packet.setDisplayFormat(TelemetryPacket.DisplayFormat.MONOSPACE);
        packet.setDisplayFormat(null);

        assertEquals(TelemetryPacket.DisplayFormat.HTML, packet.getDisplayFormat());
    }
}
