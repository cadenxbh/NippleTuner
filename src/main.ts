import sourceMapSupport from "source-map-support";
import { QApplication, QWidget } from "@nodegui/nodegui";
import App from "./App";
import { dropLegacyThemeEnvironment } from "./app/themeLaunch";
import { ensurePermissions } from "./app/Permissions";
import { runningGuiPid } from "./service/shared";
import { exitProcess } from "./util/exit";
import { appIcon } from "./util/appIcon";

sourceMapSupport.install();

async function main(): Promise<void> {
	// Already running (e.g. in the tray)? Bring that window up instead of
	// starting a second copy that would fight over the TrackPoint.
	const existing = runningGuiPid();
	if (existing !== null && existing !== process.pid) {
		console.log(`NippleTuner is already running (pid ${existing}); showing its window.`);
		process.kill(existing, "SIGUSR2");
		exitProcess(0);
		return;
	}

	// Started by an older version's theme relaunch (GTK_THEME set)? That
	// blocks live theme switching, so relaunch once without it.
	if (dropLegacyThemeEnvironment()) return;

	// The app lives in the tray; closing windows (including dialogs) mustn't quit it.
	QApplication.instance().setQuitOnLastWindowClosed(false);
	// Icon for every window: title bar corner and taskbar (and dialogs).
	QApplication.setWindowIcon(appIcon());

	// qode only starts running Node's event loop (timers, promises resolved
	// from Qt events) once a window has been shown; show+hide in the same
	// tick starts it without anything appearing on screen.
	const kick = new QWidget();
	kick.show();
	kick.hide();
	(global as any).kick = kick;

	// Stateless permission check, before the TrackPoint is opened (prompts
	// only if something is missing).
	await ensurePermissions(null);

	const app = new App();
	// Keep the app (and its Qt objects) referenced for the process lifetime.
	(global as any).app = app;
	// Handy for debugging from a console / test harnesses.
	(global as any).win = app.win;
	(global as any).tray = app.tray;
	app.start();
}

main().catch((err) => {
	console.error(err?.stack ?? err);
	exitProcess(1);
});
