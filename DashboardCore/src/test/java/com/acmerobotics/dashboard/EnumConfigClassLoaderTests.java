package com.acmerobotics.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.acmerobotics.dashboard.config.ConstantProvider;
import com.acmerobotics.dashboard.config.VariableProvider;
import com.acmerobotics.dashboard.config.reflection.ReflectionConfig;
import com.acmerobotics.dashboard.config.variable.CustomVariable;
import com.acmerobotics.dashboard.message.Message;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

public class EnumConfigClassLoaderTests {
    public enum Mode {
        A,
        B
    }

    public enum Level {
        LOW,
        HIGH;

        @Override
        public String toString() {
            return name().toLowerCase();
        }
    }

    public enum Gait {
        WALK {
            @Override
            public String toString() {
                return "walking";
            }
        },
        RUN
    }

    public static class GaitHolder {
        public static Gait gait = Gait.WALK;
    }

    public static class Holder {
        public static Mode mode = Mode.A;
        public static Mode unset;
        public static Mode[] modes = {Mode.A, Mode.A};
        public static Level level = Level.LOW;
        public static int count = 1;
    }

    @TempDir Path tmp;

    @BeforeEach
    public void resetHolder() {
        Holder.mode = Mode.A;
        Holder.unset = null;
        Holder.modes = new Mode[] {Mode.A, Mode.A};
        Holder.level = Level.LOW;
        Holder.count = 1;
        GaitHolder.gait = Gait.WALK;
    }

    @Test
    public void updatesAnEnumFromTheSameLoader() {
        save(register(Holder.class), "mode", enumValue("B", Mode.class));
        assertSame(Mode.B, Holder.mode);
    }

    @Test
    public void updatesAFieldWhoseEnumCameFromAnotherLoader() throws Exception {
        try (URLClassLoader loader = isolatedTestClasses()) {
            Class<?> holder = loader.loadClass(Holder.class.getName());
            assertNotSame(Mode.class, holder.getField("mode").getType());

            save(register(holder), "mode", enumValue("B", Mode.class));

            assertConstant(holder, "mode", "B");
        }
    }

    @Test
    public void resolvesAConstantTheDashboardsCopyLacks() throws Exception {
        String reloaded =
                "package com.acmerobotics.dashboard;\n"
                        + "public class EnumConfigClassLoaderTests {\n"
                        + "  public enum Mode { A, B, C }\n"
                        + "  public static class Holder { public static Mode mode = Mode.A; }\n"
                        + "}\n";
        try (URLClassLoader loader = compile("EnumConfigClassLoaderTests", reloaded)) {
            Class<?> holder = loader.loadClass(Holder.class.getName());

            save(register(holder), "mode", enumValue("C", Mode.class));

            assertConstant(holder, "mode", "C");
        }
    }

    @Test
    public void resolvesAnEnumTheDashboardCannotSee() throws Exception {
        String reloaded =
                "package reload;\n"
                        + "public class Tuning {\n"
                        + "  public enum Gear { LOW, HIGH }\n"
                        + "  public static Gear mode = Gear.LOW;\n"
                        + "}\n";
        try (URLClassLoader loader = compile("Tuning", reloaded)) {
            Class<?> holder = loader.loadClass("reload.Tuning");
            assertThrows(ClassNotFoundException.class, () -> Class.forName("reload.Tuning$Gear"));

            save(register(holder), "mode", enumValue("HIGH", "reload.Tuning$Gear"));

            assertConstant(holder, "mode", "HIGH");
        }
    }

    @Test
    public void resolvesAProviderValueByItsCurrentClass() throws Exception {
        try (URLClassLoader loader = isolatedTestClasses()) {
            Class<?> holder = loader.loadClass(Holder.class.getName());
            VariableProvider<Object> provider =
                    new VariableProvider<>(holder.getField("mode").get(null));
            DashboardCore core = new DashboardCore();
            core.enabled = true;
            core.addConfigVariable("Holder", "mode", provider);

            save(core, "mode", enumValue("B", Mode.class));

            Enum<?> value = (Enum<?>) provider.get();
            assertEquals("B", value.name());
            assertSame(holder.getField("mode").getType(), value.getDeclaringClass());
        }
    }

    @Test
    public void setsANullFieldFromItsDeclaredType() throws Exception {
        try (URLClassLoader loader = isolatedTestClasses()) {
            Class<?> holder = loader.loadClass(Holder.class.getName());

            save(register(holder), "unset", enumValue("B", Mode.class));

            assertConstant(holder, "unset", "B");
        }
    }

    @Test
    public void updatesAnEnumArrayElementFromAnotherLoader() throws Exception {
        try (URLClassLoader loader = isolatedTestClasses()) {
            Class<?> holder = loader.loadClass(Holder.class.getName());

            save(
                    register(holder),
                    "modes",
                    "{\"__type\":\"custom\",\"__value\":{\"1\":"
                            + enumValue("B", Mode.class)
                            + "}}");

            Enum<?>[] modes = (Enum<?>[]) holder.getField("modes").get(null);
            assertEquals("A", modes[0].name());
            assertEquals("B", modes[1].name());
            assertSame(holder.getField("modes").getType().getComponentType(), modes[1].getClass());
        }
    }

    @Test
    public void acceptsTheValuesTheClientIsOffered() {
        DashboardCore core = register(Holder.class);

        save(core, "level", enumValue("high", Level.class));
        assertSame(Level.HIGH, Holder.level);

        save(core, "level", enumValue("LOW", Level.class));
        assertSame(Level.LOW, Holder.level);
    }

    @Test
    public void leavesTheFieldForAConstantTheEnumLacks() {
        save(register(Holder.class), "mode", enumValue("Z", Mode.class));
        assertSame(Mode.A, Holder.mode);
    }

    @Test
    public void leavesTheFieldForAValueOfAnotherEnum() {
        save(register(Holder.class), "mode", enumValue("B", Level.class));
        assertSame(Mode.A, Holder.mode);
    }

    @Test
    public void leavesANonEnumFieldForAnEnumValue() {
        save(register(Holder.class), "count", enumValue("B", Mode.class));
        assertEquals(1, Holder.count);
    }

    @Test
    public void reserializesASavedEnumValue() {
        String json = enumValue("B", Mode.class);
        CustomVariable diff =
                DashboardCore.GSON.fromJson(
                        "{\"__type\":\"custom\",\"__value\":{\"mode\":" + json + "}}",
                        CustomVariable.class);
        assertEquals(json, DashboardCore.GSON.toJson(diff.getVariable("mode")));
    }

    @Test
    public void snapshotsEnumValuesForTheBaseline() {
        DashboardCore core = register(Holder.class);
        core.addConfigVariable("Extra", "count", new ConstantProvider<>(1));

        List<Message> sent = new ArrayList<>();
        core.newSocket(sent::add)
                .onMessage(
                        DashboardCore.GSON.fromJson(
                                "{\"type\":\"GET_CONFIG_BASELINE\"}", Message.class));

        String baseline = DashboardCore.GSON.toJson(sent.get(0));
        assertTrue(baseline.contains("\"mode\":{\"__type\":\"enum\",\"__value\":\"A\""), baseline);
    }

    @Test
    public void servesAnEnumWhoseConstantsHaveBodies() {
        List<Message> sent = new ArrayList<>();
        register(GaitHolder.class).newSocket(sent::add).onOpen();

        String config = DashboardCore.GSON.toJson(sent.get(0));
        assertTrue(config.contains("\"__enumClass\":\"" + Gait.class.getName() + "\""), config);
        assertTrue(config.contains("\"__enumValues\":[\"walking\",\"RUN\"]"), config);
    }

    @Test
    public void savesAnEnumWhoseConstantsHaveBodies() {
        DashboardCore core = register(GaitHolder.class);

        save(core, "gait", enumValue("RUN", Gait.class));
        assertSame(Gait.RUN, GaitHolder.gait);

        save(core, "gait", enumValue("walking", Gait.class));
        assertSame(Gait.WALK, GaitHolder.gait);
    }

    @Test
    public void detectsAProviderEnumWhoseConstantsHaveBodies() {
        DashboardCore core = new DashboardCore();
        core.enabled = true;
        VariableProvider<Gait> provider = new VariableProvider<>(Gait.WALK);
        core.addConfigVariable("Holder", "gait", provider);

        save(core, "gait", enumValue("RUN", Gait.class));
        assertSame(Gait.RUN, provider.get());
    }

    private static String enumValue(String value, Class<?> enumClass) {
        return enumValue(value, enumClass.getName());
    }

    private static String enumValue(String value, String enumClass) {
        return "{\"__type\":\"enum\",\"__value\":\""
                + value
                + "\",\"__enumClass\":\""
                + enumClass
                + "\"}";
    }

    private static DashboardCore register(Class<?> configClass) {
        DashboardCore core = new DashboardCore();
        core.enabled = true;
        core.withConfigRoot(
                root ->
                        root.putVariable(
                                "Holder", ReflectionConfig.createVariableFromClass(configClass)));
        return core;
    }

    private static void save(DashboardCore core, String field, String variableJson) {
        String json =
                "{\"type\":\"SAVE_CONFIG\",\"configDiff\":{\"__type\":\"custom\",\"__value\":"
                        + "{\"Holder\":{\"__type\":\"custom\",\"__value\":{\""
                        + field
                        + "\":"
                        + variableJson
                        + "}}}}}";
        core.newSocket(message -> {}).onMessage(DashboardCore.GSON.fromJson(json, Message.class));
    }

    private static void assertConstant(Class<?> holder, String field, String name)
            throws Exception {
        Enum<?> value = (Enum<?>) holder.getField(field).get(null);
        assertEquals(name, value.name());
        assertSame(holder.getField(field).getType(), value.getDeclaringClass());
    }

    private static URLClassLoader isolatedTestClasses() {
        URL classes =
                EnumConfigClassLoaderTests.class
                        .getProtectionDomain()
                        .getCodeSource()
                        .getLocation();
        return new URLClassLoader(new URL[] {classes}, null);
    }

    private URLClassLoader compile(String simpleName, String source) throws Exception {
        Path src = Files.createDirectories(tmp.resolve("src")).resolve(simpleName + ".java");
        Files.write(src, source.getBytes(StandardCharsets.UTF_8));
        Path out = Files.createDirectories(tmp.resolve("classes"));
        int status =
                ToolProvider.getSystemJavaCompiler()
                        .run(null, null, null, "-d", out.toString(), src.toString());
        assertEquals(0, status);
        return new URLClassLoader(new URL[] {out.toUri().toURL()}, null);
    }
}
