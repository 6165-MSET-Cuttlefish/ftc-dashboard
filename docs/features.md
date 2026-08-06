---
layout: default
---

# Features

## Telemetry

FTC apps keep the dashboard updated through periodic telemetry transmissions. Telemetry packets contain text key-value pairs like the provided SDK interfaces. They also store graphics to be displayed over the field image.

Packets have a map-like interface for adding unstructured data.

```java
TelemetryPacket packet = new TelemetryPacket();
packet.put("x", 3.7);
packet.put("status", "alive");
```

### Ordering

Telemetry is displayed in the order it was added, matching the Driver Station. `addLine()` adds a
line in place, between the items added before and after it.

```java
packet.put("x", 3.7);
packet.addLine("--- drive ---");
packet.put("status", "alive");
```

```
x: 3.7
--- drive ---
status: alive
```

Unlike the SDK's `Telemetry.addData()`, which appends a new line every call, `put()` overwrites a
key that is already present, leaving it in the position it was first given.

`addLogEntry()` adds to the packet's log, which is displayed below all telemetry items. Entries
added through the `Telemetry` interface below, with `telemetry.log().add(...)`, behave like the
SDK's: they persist across updates, hold nine entries and are retransmitted with every packet.

The display is rebuilt from each transmission rather than accumulated, so telemetry that stops
being sent stops being shown.

### Display format

Packets render a subset of HTML, as the dashboard always has.

```java
packet.setDisplayFormat(TelemetryPacket.DisplayFormat.HTML); // the default
packet.put("status", "<font color='green'><b>alive</b></font>");
```

The `Telemetry` interface below defaults to `DisplayFormat.CLASSIC` instead, matching the Driver
Station: markup is displayed verbatim, so `<b>` and `a < b` both show up as written. Opt in with
`setDisplayFormat()`, as you would to get rich text on the Driver Station. The setting carries over
to later packets until the next op mode.

```java
telemetry.setDisplayFormat(Telemetry.DisplayFormat.HTML);
```

`DisplayFormat.MONOSPACE` keeps text verbatim in a monospace font, which is useful for aligning
columns with spaces.

The format belongs to the packet rather than the view, so telemetry sent from several places at
once is each rendered the way its sender asked for. The Telemetry View's menu overrides the format
for every line without redeploying the op mode, which helps when reading the markup behind a line
that renders oddly. It starts on Auto, follows each packet, and names the active override next to
the heading. The override is not remembered across reloads.

The supported tags are the ones AOSP's `Html.fromHtml` handles, which is what the Driver Station
uses: `b`, `strong`, `i`, `em`, `cite`, `dfn`, `u`, `s`, `strike`, `del`, `sup`, `sub`, `big`,
`small`, `tt`, `br`, `p`, `div`, `blockquote`, `ul`, `li`, `h1`-`h6`, `font` (`color` and `face`)
and `span` (`color`, `background-color`, `text-decoration: line-through`, and `text-align` on block
elements). Color names resolve to the values Android uses, so `green` is the same brightness here
as on the Driver Station. Any other tag is dropped and its text kept. Because telemetry is rendered
in a browser rather than a text view, tags that can execute code or load resources, such as
`script`, `iframe` and `img`, are discarded along with all event handler attributes.

The accessor `fieldOverlay()` returns a `Canvas` that records a sequence of drawing operations that show up in the Field View.

```java
packet.fieldOverlay()
    .setFill("blue")
    .fillRect(-20, -20, 40, 40);
```

Check out [this page](fieldview) for more information on Field View drawing.

Use `FtcDashboard#sendTelemetryPacket()` to dispatch complete packets.

```java
FtcDashboard dashboard = FtcDashboard.getInstance();
dashboard.sendTelemetryPacket(packet);
```

For convenience, the dashboard offers an implementation of `Telemetry`.

```java
FtcDashboard dashboard = FtcDashboard.getInstance();
Telemetry dashboardTelemetry = dashboard.getTelemetry();

dashboardTelemetry.addData("x", 3.7);
dashboardTelemetry.update();
```

It follows the SDK's semantics: the `Item` returned by `addData()` stays addressable, `Func` values
are re-evaluated on every update, retained items survive a `clear()`, `setAutoClear(false)`
accumulates telemetry across updates, and `Double` and `Float` values are rounded as the Driver
Station rounds them (`setNumDecimalPlaces()` adjusts this). The exception is `speak()`, which does
nothing here because the dashboard has no speaker.

Each call to `update()` composes a packet from the telemetry currently set and sends it. Be careful: this indirection can mask the presence of multiple `sendTelemetryPacket()` calls in a single loop iteration.

A common idiom combines DS and dashboard telemetry together.

```java
public class MultipleTelemetryExampleOpMode extends OpMode {
    @Override
    public void init() {
        telemetry = new MultipleTelemetry(telemetry, FtcDashboard.getInstance().getTelemetry());

        // ...
    }

    // ...
}
```

## Configuration Variables

Configuration variables are special fields that the dashboard client can seamlessly modify while the app is running. To mark a field as a config variable, declare it `static` and not `final` and annotate the enclosing class with `@Config`.

```java
@Config
public class RobotConstants {
    public static int MAGIC_NUMBER = 32;
    public static PIDCoefficients TURNING_PID = new PIDCoefficients();
    // other constants
}
```

It's conventional to name variables in uppercase and treat them as constants inside the code. While saved dashboard changes instantly apply to the code fields, code-side changes only propagate to the client on explicit refresh.

Also, keep the copy semantics of Java primitives in mind when using this feature. Why does the following op mode fail to observe position offset changes during operation?

```java
public class ServoArm {
    private Servo servo;
    private double posOffset;

    public ServoArm(HardwareMap hardwareMap, double posOffset) {
        this.servo = hardwareMap.get(Servo.class, "servo");
        this.posOffset = posOffset;
    }

    public void setPosition(double pos) {
        servo.setPosition(posOffset + pos);
    }
}

@Config
public class StaleServoOpMode extends LinearOpMode {
    public static double SERVO_POS_OFFSET = 0.27;

    @Override
    public void runOpMode() {
        ServoArm arm = new ServoArm(hardwareMap, SERVO_POS_OFFSET);

        waitForStart();

        while (opModeIsActive()) {
            arm.setPosition(-gamepad1.left_stick_y);
        }
    }
}
```

The value of `SERVO_POS_OFFSET` is read once at the start of the op mode to pass to the `ServoArm` constructor. The field `posOffset` gets an independent copy of `SERVO_POS_OFFSET`; it only gets the new `SERVO_POS_OFFSET` when the op mode is reinitialized.

With some slight adjustments, position offset modifications can appear truly live,

```java
@Config
public class ServoArm {
    public static double POS_OFFSET = 0.27;

    private Servo servo;

    public ServoArm(HardwareMap hardwareMap) {
        this.servo = hardwareMap.get(Servo.class, "servo");
    }

    public void setPosition(double pos) {
        servo.setPosition(POS_OFFSET + pos);
    }
}

public class FixedServoOpMode extends LinearOpMode {
    @Override
    public void runOpMode() {
        ServoArm arm = new ServoArm(hardwareMap);

        waitForStart();

        while (opModeIsActive()) {
            arm.setPosition(-gamepad1.left_stick_y);
        }
    }
}
```

Java experts may have noticed that `POS_OFFSET` can still be stale or partially updated. If this bothers you, mark all your config variable fields with `volatile`. You can read more about word tearing in [JLS 17.7](https://docs.oracle.com/javase/specs/jls/se8/html/jls-17.html#jls-17.7).

Config variable declarations in Kotlin are cumbersome but still possible with `@JvmField`.

```kotlin
@Config
object RobotConstants {
    @JvmField var MAGIC_NUMBER = 32
    @JvmField var TURNING_PID = PIDCoefficients()
    // other constants
}
```

## Op Mode Controls

Op mode controls replicate limited DS functionality. Some gamepads are supported for testing in a pinch. Plug them in and press Start-A/B as usual to activate. Dashboard gamepads will have higher latency and less robustness than DS ones and should be used accordingly. Safety mechanisms attempt to stop the robot if gamepads spontaneously disconnect, but there are no guarantees.

## Camera

Teams may be interested in previewing the two different vision systems, vision portal and traditional EasyOpenCV. The vision portal API was introduced in CenterStage 2023-2024 and it's usage with FTC dashboard is documented [in this op mode](https://github.com/acmerobotics/ftc-dashboard/blob/master/TeamCode/src/main/java/org/firstinspires/ftc/teamcode/VisionPortalStreamingOpMode.java).

It is also possible to use traditional EasyOpenCV, using a call like `FtcDashboard.getInstance().startCameraStream(camera, 0);` where `camera` implements `CameraStreamSource`. In EasyOpenCV, this camera will be the same one you initialize with the code below.

```java
int cameraMonitorViewId = hardwareMap.appContext.getResources().getIdentifier("cameraMonitorViewId", "id", hardwareMap.appContext.getPackageName());
OpenCvWebcam camera = OpenCvCameraFactory.getInstance().createWebcam(hardwareMap.get(WebcamName.class, "Webcam 1"), cameraMonitorViewId);
FtcDashboard.getInstance().startCameraStream(camera, 0);
```
