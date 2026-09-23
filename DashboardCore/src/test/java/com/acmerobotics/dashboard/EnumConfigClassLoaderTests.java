package com.acmerobotics.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;

import com.acmerobotics.dashboard.config.ConstantProvider;
import com.acmerobotics.dashboard.config.reflection.FieldProvider;
import com.acmerobotics.dashboard.config.variable.BasicVariable;
import com.acmerobotics.dashboard.config.variable.VariableType;
import java.lang.reflect.Field;
import java.net.URL;
import java.net.URLClassLoader;
import org.junit.jupiter.api.Test;

public class EnumConfigClassLoaderTests {
    public enum Mode {
        A,
        B
    }

    public static class Holder {
        public static Mode mode = Mode.A;
    }

    @Test
    public void updatesEnumFieldWhoseClassCameFromAnotherLoader() throws Exception {
        URL classes =
                EnumConfigClassLoaderTests.class
                        .getProtectionDomain()
                        .getCodeSource()
                        .getLocation();
        try (URLClassLoader isolated = new URLClassLoader(new URL[] {classes}, null)) {
            Field field = isolated.loadClass(Holder.class.getName()).getField("mode");
            assertNotSame(Mode.class, field.getType());

            BasicVariable<Object> target =
                    new BasicVariable<>(VariableType.ENUM, new FieldProvider<>(field, null));
            target.update(
                    new BasicVariable<>(VariableType.ENUM, new ConstantProvider<Object>(Mode.B)));

            Enum<?> value = (Enum<?>) field.get(null);
            assertEquals("B", value.name());
            assertSame(field.getType(), value.getDeclaringClass());
        }
    }

    @Test
    public void updatesEnumFieldFromTheSameLoader() throws Exception {
        Holder.mode = Mode.A;
        BasicVariable<Object> target =
                new BasicVariable<>(
                        VariableType.ENUM,
                        new FieldProvider<>(Holder.class.getField("mode"), null));
        target.update(new BasicVariable<>(VariableType.ENUM, new ConstantProvider<Object>(Mode.B)));
        assertSame(Mode.B, Holder.mode);
    }
}
