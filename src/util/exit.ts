import { QWidget } from "@nodegui/nodegui";

/**
 * Exits the process. In qode, process.exit() hangs if it's called before
 * the Qt/Node event loop has started (e.g. during startup); starting the
 * loop (show+hide a hidden widget) and exiting on the next tick works.
 */
export function exitProcess(code = 0): void {
	const kick = new QWidget();
	kick.show();
	kick.hide();
	(global as any).__exitKick = kick;
	setImmediate(() => process.exit(code));
}
