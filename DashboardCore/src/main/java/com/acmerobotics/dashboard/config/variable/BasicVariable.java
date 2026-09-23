package com.acmerobotics.dashboard.config.variable;

import com.acmerobotics.dashboard.config.ValueProvider;

public class BasicVariable<T> extends ConfigVariable<T> {
    private VariableType type;
    private ValueProvider<T> provider;

    private static <T> VariableType inferType(ValueProvider<T> provider) {
        Class<?> providerClass = provider.get().getClass();
        return VariableType.fromClass(providerClass);
    }

    public BasicVariable(ValueProvider<T> provider) {
        this(inferType(provider), provider);
    }

    public BasicVariable(VariableType type, ValueProvider<T> provider) {
        this.type = type;
        this.provider = provider;
    }

    @Override
    public VariableType getType() {
        return type;
    }

    @Override
    public T getValue() {
        return provider.get();
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    @Override
    public void update(ConfigVariable<T> newVariable) {
        T value = newVariable.getValue();
        T current = provider.get();
        // The incoming constant is resolved by class name, which can find a different copy of the
        // enum class than the field's (e.g. under a hot-reloading class loader); match it by name.
        if (type == VariableType.ENUM && value instanceof Enum && current instanceof Enum) {
            Class target = ((Enum<?>) current).getDeclaringClass();
            if (((Enum<?>) value).getDeclaringClass() != target) {
                value = (T) Enum.valueOf(target, ((Enum<?>) value).name());
            }
        }
        provider.set(value);
    }
}
