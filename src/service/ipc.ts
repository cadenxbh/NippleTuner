/**
 * Tiny local IPC between the CLI and the running GUI: one JSON request per
 * connection over a Unix socket (only your user can reach it). Qt-free so
 * the CLI runs under plain Node.
 */
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";

const SOCKET_NAME = `nippletuner-${os.userInfo().uid}.sock`;
const preferred = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), SOCKET_NAME);
/** Unix socket paths are limited to ~107 bytes; fall back to /tmp if needed. */
export const SOCKET_PATH = Buffer.byteLength(preferred) < 100 ? preferred : path.join("/tmp", SOCKET_NAME);

export interface Request {
	cmd: string;
	args: string[];
	/** Show a tray notification for the change (default true from the CLI). */
	notify?: boolean;
}

export interface Response {
	ok: boolean;
	message: string;
	data?: unknown;
}

export type Handler = (req: Request) => Response | Promise<Response>;

/** GUI side: listens for CLI requests. Returns a function that closes the socket. */
export function serve(handler: Handler): () => void {
	try {
		fs.unlinkSync(SOCKET_PATH); // stale socket from a crash (single instance is enforced elsewhere)
	} catch { /* none */ }
	const server = net.createServer((sock) => {
		let buf = "";
		sock.setEncoding("utf8");
		sock.on("data", async (chunk) => {
			buf += chunk;
			const nl = buf.indexOf("\n");
			if (nl < 0) return;
			let res: Response;
			try {
				res = await handler(JSON.parse(buf.slice(0, nl)));
			} catch (err: any) {
				res = { ok: false, message: err?.message ?? String(err) };
			}
			sock.end(JSON.stringify(res) + "\n");
		});
		sock.on("error", () => { /* client went away */ });
	});
	server.listen(SOCKET_PATH, () => {
		try {
			fs.chmodSync(SOCKET_PATH, 0o600);
		} catch { /* ignore */ }
	});
	server.on("error", (err) => console.error("CLI socket error:", err.message));
	return () => {
		server.close();
		try {
			fs.unlinkSync(SOCKET_PATH);
		} catch { /* gone */ }
	};
}

/** CLI side. Rejects with code ENOENT/ECONNREFUSED if the GUI isn't running. */
export function send(req: Request, timeoutMs = 3000): Promise<Response> {
	return new Promise((resolve, reject) => {
		const sock = net.createConnection(SOCKET_PATH);
		let buf = "";
		const timer = setTimeout(() => {
			sock.destroy();
			reject(Object.assign(new Error("NippleTuner didn't answer"), { code: "ETIMEDOUT" }));
		}, timeoutMs);
		sock.setEncoding("utf8");
		sock.on("connect", () => sock.write(JSON.stringify(req) + "\n"));
		sock.on("data", (c) => (buf += c));
		sock.on("end", () => {
			clearTimeout(timer);
			try {
				resolve(JSON.parse(buf));
			} catch {
				reject(new Error("Bad reply from NippleTuner"));
			}
		});
		sock.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}
