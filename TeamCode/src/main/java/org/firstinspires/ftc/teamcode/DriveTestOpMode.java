package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.FtcDashboard;
import com.acmerobotics.dashboard.config.Config;
import com.acmerobotics.dashboard.telemetry.MultipleTelemetry;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.util.ElapsedTime;

/*
 * Timed mecanum drive: forward, pause, reverse. Useful for putting a real load on the battery
 * while watching the dashboard's voltage and current readouts.
 */
@Config
@Autonomous
public class DriveTestOpMode extends LinearOpMode {
    public static double DRIVE_POWER = 0.4;

    public static double FORWARD_SECONDS = 1.0;
    public static double PAUSE_SECONDS = 2.0;
    public static double REVERSE_SECONDS = 1.0;

    private DcMotor frontLeft;
    private DcMotor frontRight;
    private DcMotor backLeft;
    private DcMotor backRight;

    @Override
    public void runOpMode() throws InterruptedException {
        telemetry = new MultipleTelemetry(telemetry, FtcDashboard.getInstance().getTelemetry());

        frontLeft = hardwareMap.get(DcMotor.class, "fl");
        frontRight = hardwareMap.get(DcMotor.class, "fr");
        backLeft = hardwareMap.get(DcMotor.class, "bl");
        backRight = hardwareMap.get(DcMotor.class, "br");

        // Left motors are mirrored on a typical mecanum chassis. If the robot spins in place
        // instead of driving straight, flip these two.
        frontLeft.setDirection(DcMotorSimple.Direction.REVERSE);
        backLeft.setDirection(DcMotorSimple.Direction.REVERSE);
        frontRight.setDirection(DcMotorSimple.Direction.FORWARD);
        backRight.setDirection(DcMotorSimple.Direction.FORWARD);

        for (DcMotor motor : new DcMotor[] {frontLeft, frontRight, backLeft, backRight}) {
            motor.setZeroPowerBehavior(DcMotor.ZeroPowerBehavior.BRAKE);
            motor.setMode(DcMotor.RunMode.RUN_WITHOUT_ENCODER);
        }

        telemetry.addLine("Ready. Put the robot on blocks or clear the area before starting.");
        telemetry.update();

        waitForStart();

        if (isStopRequested()) {
            return;
        }

        driveFor("forward", DRIVE_POWER, FORWARD_SECONDS);
        driveFor("pause", 0.0, PAUSE_SECONDS);
        driveFor("reverse", -DRIVE_POWER, REVERSE_SECONDS);

        setDrivePower(0.0);

        telemetry.addData("phase", "done");
        telemetry.update();
    }

    /**
     * Holds the given power on all four wheels for the given duration, bailing out early if the
     * op mode is stopped.
     */
    private void driveFor(String phase, double power, double seconds) {
        ElapsedTime timer = new ElapsedTime();
        setDrivePower(power);

        while (opModeIsActive() && timer.seconds() < seconds) {
            telemetry.addData("phase", phase);
            telemetry.addData("power", power);
            telemetry.addData("elapsed", timer.seconds());
            telemetry.update();

            sleep(20);
        }

        setDrivePower(0.0);
    }

    private void setDrivePower(double power) {
        frontLeft.setPower(power);
        frontRight.setPower(power);
        backLeft.setPower(power);
        backRight.setPower(power);
    }
}
