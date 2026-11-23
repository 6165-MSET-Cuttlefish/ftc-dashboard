package com.acmerobotics.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.acmerobotics.dashboard.config.ValueProvider;
import com.acmerobotics.dashboard.config.reflection.ReflectionConfig;
import com.acmerobotics.dashboard.message.Message;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

public class ConfigBaselineTests {
    public static class Arm {
        public static double kP = 0.1;
    }

    public static class Lift {
        public static int height = 10;
    }

    @BeforeEach
    public void resetTuning() {
        Arm.kP = 0.1;
        Lift.height = 10;
    }

    @Test
    public void keepsTheValuesFromWhenItWasCaptured() {
        DashboardCore core = register();
        core.captureConfigBaseline();

        save(core, "Arm", "kP", "{\"__type\":\"double\",\"__value\":0.35}");

        assertEquals(0.35, Arm.kP);
        String baseline = baseline(core);
        assertTrue(baseline.contains("\"kP\":{\"__type\":\"double\",\"__value\":0.1}"), baseline);
        assertTrue(baseline.contains("\"height\":{\"__type\":\"int\",\"__value\":10}"), baseline);
    }

    @Test
    public void addingAVariableLeavesEarlierBaselinesAlone() {
        DashboardCore core = register();
        core.captureConfigBaseline();
        save(core, "Arm", "kP", "{\"__type\":\"double\",\"__value\":0.35}");

        core.addConfigVariable(
                "Extra",
                "x",
                new ValueProvider<Double>() {
                    @Override
                    public Double get() {
                        return 1.0;
                    }

                    @Override
                    public void set(Double value) {}
                });

        String baseline = baseline(core);
        assertTrue(baseline.contains("\"kP\":{\"__type\":\"double\",\"__value\":0.1}"), baseline);
        assertTrue(baseline.contains("\"x\":{\"__type\":\"double\",\"__value\":1.0}"), baseline);
    }

    @Test
    public void addingAVariableToACapturedCategoryKeepsItsSiblings() {
        DashboardCore core = register();
        core.captureConfigBaseline();
        save(core, "Arm", "kP", "{\"__type\":\"double\",\"__value\":0.35}");

        core.addConfigVariable(
                "Arm",
                "kD",
                new ValueProvider<Double>() {
                    @Override
                    public Double get() {
                        return 0.02;
                    }

                    @Override
                    public void set(Double value) {}
                });

        String baseline = baseline(core);
        assertTrue(baseline.contains("\"kP\":{\"__type\":\"double\",\"__value\":0.1}"), baseline);
        assertTrue(baseline.contains("\"kD\":{\"__type\":\"double\",\"__value\":0.02}"), baseline);
    }

    private static DashboardCore register() {
        DashboardCore core = new DashboardCore();
        core.enabled = true;
        core.withConfigRoot(
                root -> {
                    root.putVariable("Arm", ReflectionConfig.createVariableFromClass(Arm.class));
                    root.putVariable("Lift", ReflectionConfig.createVariableFromClass(Lift.class));
                });
        return core;
    }

    private static String baseline(DashboardCore core) {
        List<Message> sent = new ArrayList<>();
        core.newSocket(sent::add)
                .onMessage(
                        DashboardCore.GSON.fromJson(
                                "{\"type\":\"GET_CONFIG_BASELINE\"}", Message.class));
        return DashboardCore.GSON.toJson(sent.get(0));
    }

    private static void save(DashboardCore core, String category, String field, String json) {
        String message =
                "{\"type\":\"SAVE_CONFIG\",\"configDiff\":{\"__type\":\"custom\",\"__value\":{\""
                        + category
                        + "\":{\"__type\":\"custom\",\"__value\":{\""
                        + field
                        + "\":"
                        + json
                        + "}}}}}";
        core.newSocket(m -> {}).onMessage(DashboardCore.GSON.fromJson(message, Message.class));
    }
}
