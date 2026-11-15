import { spawn } from "child_process";

/**
 * Opens a URL in the default browser (xdg-open). Resolves false if it
 * couldn't be launched, so the caller can show the link instead.
 */
export function openUrl(url: string): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
			child.once("error", () => resolve(false)); // xdg-open not installed
			// xdg-open exits right after handing the URL to the browser; a non-zero
			// code means it found nothing to open it with.
			child.once("exit", (code) => resolve(code === 0));
			// Some setups keep xdg-open running with the browser; treat that as success.
			setTimeout(() => resolve(true), 3000).unref();
			child.unref();
		} catch {
			resolve(false);
		}
	});
}
