import {
	AcceptMode, ButtonRole, FileMode, QFileDialog, QInputDialog, QMessageBox, QPushButton, QWidget, WidgetEventTypes,
} from "@nodegui/nodegui";
import * as os from "os";
import * as path from "path";

/*
 * Dialog helpers. All of them are NON-BLOCKING and return promises:
 *
 *  - QDialog.exec() runs a nested Qt loop during which no JavaScript runs.
 *    The TrackPoint is remapped in JavaScript, so with a profile applied the
 *    pointer froze while any dialog was open (you couldn't even close it).
 *    open() + a promise keeps everything running.
 *  - nodegui doesn't deliver QDialog's finished/accepted/rejected signals,
 *    but the Hide event fires however the dialog closes (button, X, Escape).
 *    Value signals (textValueSelected, fileSelected) arrive just *after* Hide,
 *    so results are read on the next tick.
 *  - Dialog objects (and buttons handed to Qt) are kept referenced for the
 *    session: letting nodegui garbage-collect objects Qt also owns can free
 *    them twice and crash the app.
 */
const keepAlive: object[] = [];

/** Shows `dialog` without blocking; resolves with `result()` once it closes. */
function openAndWait<T>(dialog: QWidget, show: () => void, result: () => T): Promise<T> {
	keepAlive.push(dialog);
	return new Promise<T>((resolve) => {
		let done = false;
		dialog.addEventListener(WidgetEventTypes.Hide, () => {
			if (done) return;
			done = true;
			setImmediate(() => resolve(result())); // let value signals arrive first
		});
		show();
	});
}

function messageBox(parent: QWidget | null, title: string, text: string, informative?: string, details?: string): QMessageBox {
	const box = parent ? new QMessageBox(parent) : new QMessageBox();
	box.setWindowTitle(title);
	box.setText(text);
	if (informative) box.setInformativeText(informative);
	if (details) box.setDetailedText(details);
	return box;
}

export interface AskOptions {
	title: string;
	/** Main message (shown prominently). */
	text: string;
	/** Smaller text under the message. */
	informative?: string;
	/** Collapsible "Show Details" text (e.g. the exact commands). */
	details?: string;
	ok: string;
	cancel?: string;
}

/** Two-button question. Resolves true if the OK button was clicked. */
export function ask(parent: QWidget | null, o: AskOptions): Promise<boolean> {
	const box = messageBox(parent, o.title, o.text, o.informative, o.details);
	const ok = new QPushButton();
	const cancel = new QPushButton();
	keepAlive.push(ok, cancel);
	ok.setText(o.ok);
	cancel.setText(o.cancel ?? "Cancel");
	let confirmed = false;
	ok.addEventListener("clicked", () => (confirmed = true));
	box.addButton(ok, ButtonRole.AcceptRole);
	box.addButton(cancel, ButtonRole.RejectRole); // also what X / Escape do
	// (setDefaultButton is broken in nodegui: it passes the JS wrapper to Qt and throws.)
	return openAndWait(box, () => box.open(), () => confirmed);
}

/** Yes/no confirmation with a custom confirm button label. */
export function confirm(parent: QWidget | null, title: string, text: string, confirmLabel = "OK"): Promise<boolean> {
	return ask(parent, { title, text, ok: confirmLabel });
}

/** Message with a single OK button. Resolves when it's closed. */
export function showError(parent: QWidget | null, title: string, text: string, informative?: string, details?: string): Promise<void> {
	const box = messageBox(parent, title, text, informative, details);
	const ok = new QPushButton();
	keepAlive.push(ok);
	ok.setText("OK");
	box.addButton(ok, ButtonRole.AcceptRole);
	return openAndWait(box, () => box.open(), () => undefined);
}

/** Text prompt. Resolves with the trimmed text, or null if cancelled/empty. */
export function askText(parent: QWidget | null, title: string, label: string, value = ""): Promise<string | null> {
	const d = parent ? new QInputDialog(parent) : new QInputDialog();
	d.setWindowTitle(title);
	d.setLabelText(label);
	d.setTextValue(value);
	let selected: string | null = null;
	d.addEventListener("textValueSelected", (t) => (selected = t));
	return openAndWait(d, () => d.open(), () => selected?.trim() || null);
}

const JSON_FILTER = "JSON files (*.json);;All files (*)";

function fileDialog(parent: QWidget, title: string, start: string, save: boolean): Promise<string | null> {
	const d = new QFileDialog(parent, title, start, JSON_FILTER);
	d.setWindowTitle(title);
	d.setNameFilter(JSON_FILTER);
	if (save) {
		d.setAcceptMode(AcceptMode.AcceptSave);
		d.setDefaultSuffix("json");
	} else {
		d.setAcceptMode(AcceptMode.AcceptOpen);
		d.setFileMode(FileMode.ExistingFile);
	}
	let selected: string | null = null;
	d.addEventListener("fileSelected", (f) => (selected = f));
	return openAndWait(d, () => d.open(), () => selected);
}

export function openFile(parent: QWidget, title: string): Promise<string | null> {
	return fileDialog(parent, title, os.homedir(), false);
}

/** `suggestedName` is pre-filled (in the home directory unless it's a path). */
export function saveFile(parent: QWidget, title: string, suggestedName: string): Promise<string | null> {
	const target = path.isAbsolute(suggestedName) ? suggestedName : path.join(os.homedir(), suggestedName);
	return fileDialog(parent, title, target, true);
}
