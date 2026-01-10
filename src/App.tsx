import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

function useCounter(start = 0) {
	const [count, setCount] = useState(start);
	useEffect(() => {
		const id = setInterval(() => setCount((c) => c + 1), 1000);
		return () => clearInterval(id);
	}, []);
	return count;
}

function UDPServerView({ active }: { active: boolean }) {
	const editorRef = useRef<HTMLDivElement | null>(null);
	const [html, setHtml] = useState("<p></p>");

	const escapeHtml = (s: string) =>
		s
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");

	const appendStatus = (msg: string) => {
		if (!editorRef.current) return;
		const snippet = `<div style=\"color:#666;font-size:12px;margin:4px 0;\"><em>${escapeHtml(String(msg))}</em></div>`;
		editorRef.current.insertAdjacentHTML("beforeend", snippet);
		editorRef.current.scrollTop = editorRef.current.scrollHeight;
		setHtml(editorRef.current.innerHTML);
	};

	const [displayMode, setDisplayMode] = useState<"ascii" | "hex">("ascii");
	const displayModeRef = useRef(displayMode);
	useEffect(() => {
		displayModeRef.current = displayMode;
	}, [displayMode]);



	const bytesToHex = (bytes: Uint8Array) => {
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join(" ")
			.toUpperCase();
	};

	const [ip, setIp] = useState("192.168.1.212");
	const [port, setPort] = useState("61206");
	const ipRegex = /^((25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(25[0-5]|2[0-4]\d|[01]?\d?\d)$/;

	const isValidIP = (v: string) => ipRegex.test(v.trim());
	const isValidPort = (v: string) => {
		const n = Number(v);
		return Number.isInteger(n) && n >= 1 && n <= 65535;
	};
	const [connected, setConnected] = useState(false);
	const [status, setStatus] = useState("");
	const [hideDup, setHideDup] = useState(true);

	useEffect(() => {
		if (editorRef.current) {
			editorRef.current.innerHTML = html;
			setTimeout(() => {
				if (editorRef.current) editorRef.current.scrollTop = editorRef.current.scrollHeight;
			}, 0);
		}
	}, []);

	useEffect(() => {
		// NOTE: cannot `await` inside effect cleanup reliably (React StrictMode can mount/unmount quickly).
		// Use a disposed flag so we always unlisten, even if the promise resolves later.
		let disposed = false;
		let unlistenMessage: (() => void) | null = null;
		let unlistenError: (() => void) | null = null;

		listen("udp:message", (event) => {
			try {
				const payload: any = event.payload as any;
				const from = payload.from ?? "unknown";
				const b64 = payload.data ?? "";
				const dup = Boolean(payload.dup);
				if (dup && hideDup) return;
				const seq = payload.seq != null ? String(payload.seq) : "";

				const binStr = atob(b64 || "");
				const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
				const mode = displayModeRef.current;
				// timestamp (prefer backend ts_ms)
				const tsMs = typeof payload.ts_ms === "number" ? payload.ts_ms : null;
				const ts = tsMs ? new Date(tsMs).toLocaleString() : new Date().toLocaleString();

				// decode
				let text = "";
				let isHexShown = false;
				if (mode === "hex") {
					text = bytesToHex(bytes);
					isHexShown = true;
				} else {
					try {
						text = new TextDecoder().decode(bytes);
						// if contains replacement characters or many non-printables, fallback to hex
						if (text.includes("\uFFFD") || /[\x00-\x08\x0E-\x1F]/.test(text)) {
							text = bytesToHex(bytes);
							isHexShown = true;
						}
					} catch (err) {
						text = bytesToHex(bytes);
						isHexShown = true;
					}
				}

				const contentHtml = isHexShown
					? `<pre style=\"font-family:monospace; white-space:pre-wrap; margin:0;\">${escapeHtml(text)}</pre>`
					: `<pre style=\"white-space:pre-wrap; margin:0;\">${escapeHtml(text)}</pre>`;

				const dupTag = dup
					? `<span style=\"color:#ffb74d;font-size:12px;margin-left:6px;\">DUP</span>`
					: "";
				const seqTag = seq
					? `<span style=\"color:#90a4ae;font-size:12px;margin-left:6px;\">#${escapeHtml(seq)}</span>`
					: "";

				const snippet = `<div style="margin:6px 0;"><span style="color:#999;font-size:12px;margin-right:8px;">${escapeHtml(ts)}</span><strong>${escapeHtml(
					from
				)}</strong>${seqTag}${dupTag}: ${contentHtml}</div>`;
				if (editorRef.current) {
					editorRef.current.insertAdjacentHTML("beforeend", snippet);
					editorRef.current.scrollTop = editorRef.current.scrollHeight;
					setHtml(editorRef.current.innerHTML);
				}
			} catch (e) {
				// ignore per-message errors
			}
		})
			.then((u) => {
				if (disposed) u();
				else unlistenMessage = u;
			})
			.catch(() => {
				// ignore listener setup errors
			});

		listen("udp:server:error", (event) => {
			const payload: any = event.payload as any;
			const msg = payload?.error ?? "unknown error";
			appendStatus(String(msg));
			setStatus(String(msg));
		})
			.then((u) => {
				if (disposed) u();
				else unlistenError = u;
			})
			.catch(() => {
				// ignore listener setup errors
			});

		return () => {
			disposed = true;
			if (unlistenMessage) unlistenMessage();
			if (unlistenError) unlistenError();
		};
	}, [hideDup]);

	const toggleConnection = async () => {
		if (!connected) {
			const bindAddr = `${ip}:${port}`;
			try {
				const res = await invoke<string>("start_udp_server", { bindAddr });
				appendStatus(res ?? "started");
				setStatus(res ?? "started");
				setConnected(true);
			} catch (e) {
				appendStatus(String(e));
				setStatus(String(e));
			}
		} else {
			try {
				const res = await invoke<string>("stop_udp_server");
				appendStatus(res ?? "stopped");
				setStatus(res ?? "stopped");
				setConnected(false);
			} catch (e) {
				appendStatus(String(e));
				setStatus(String(e));
			}
		}
	};

	return (
		<div className={"view" + (active ? " active" : " hidden")}>
			<h2>UDP Server</h2>

			<div
				ref={editorRef}
				contentEditable
				onInput={() => setHtml(editorRef.current?.innerHTML ?? "")}
				style={{ border: "1px solid #ccc", height: 300, overflowY: "auto", padding: 8, borderRadius: 4 }}
				aria-label="富文本编辑器"
			/>

			<div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
				<button
					type="button"
					onClick={() => {
						if (editorRef.current) {
							editorRef.current.innerHTML = "";
							setHtml("");
						}
					}}
				>
					清空
				</button>
				<button
					type="button"
					onClick={() => {
						if (editorRef.current && navigator.clipboard) {
							navigator.clipboard.writeText(editorRef.current.innerText);
						}
					}}
				>
					复制消息
				</button>

				<div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 8 }}>
					<span style={{ fontSize: 12 }}>显示:</span>
					<div
						role="switch"
						aria-checked={displayMode === "hex"}
						onClick={() => setDisplayMode((m) => (m === "ascii" ? "hex" : "ascii"))}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 8,
							cursor: "pointer",
							userSelect: "none",
						}}
					>
						<div
							style={{
								width: 44,
								height: 24,
								borderRadius: 16,
								background: displayMode === "hex" ? "#4caf50" : "#ccc",
								padding: 3,
								boxSizing: "border-box",
								position: "relative",
							}}
						>
							<div
								style={{
									width: 18,
									height: 18,
									borderRadius: 9,
									background: "#fff",
									position: "absolute",
									left: displayMode === "hex" ? 23 : 3,
									transition: "left 0.12s ease",
									boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
								}}
							/>
						</div>
						<span style={{ fontSize: 12 }}>{displayMode === "hex" ? "HEX" : "ASCII"}</span>
					</div>
				</div>

				<div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 8 }}>
					<label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#666" }}>
						<input
							type="checkbox"
							checked={hideDup}
							onChange={(e) => setHideDup(e.currentTarget.checked)}
							aria-label="过滤重复包"
						/>
						过滤重复(50ms)
					</label>
				</div>
			</div>

			<div className="control-row" style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
				<label style={{ display: "flex", gap: 4, alignItems: "center" }}>
					<span className="form-label-text">IP:</span>
					<input
						placeholder="0.0.0.0"
						pattern="^((25[0-5]|2[0-4]\\d|[01]?\\d?\\d)\\.){3}(25[0-5]|2[0-4]\\d|[01]?\\d?\\d)$"
						title="请输入有效的 IPv4 地址"
						value={ip}
						onChange={(e) => {
							// allow only digits and dots while typing
							const v = e.currentTarget.value.replace(/[^0-9.]/g, "");
							setIp(v);
						}}
						onBlur={() => {
							if (!isValidIP(ip)) setStatus("IP 格式无效");
							else setStatus("");
							if (!isValidIP(ip)) {
								appendStatus("IP 格式无效");
								setStatus("IP 格式无效");
							}
						}}
						disabled={connected}
						style={{ width: 150 }}
					/>
				</label>
				<label style={{ display: "flex", gap: 4, alignItems: "center" }}>
					<span className="form-label-text">Port:</span>
					<input
						placeholder="9000"
						type="text"
						inputMode="numeric"
						pattern="^([1-9][0-9]{0,4}|6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3})$"
						title="请输入端口号 1-65535"
						value={port}
						onChange={(e) => {
							const v = e.currentTarget.value.replace(/[^0-9]/g, "");
							setPort(v);
						}}
						onBlur={() => {
							if (!isValidPort(port)) {
								appendStatus("Port 格式无效");
								setStatus("Port 格式无效");
							} else setStatus("");
						}}
						disabled={connected}
						style={{ width: 100 }}
					/>
				</label>
				<button type="button" onClick={toggleConnection} style={{ padding: "6px 12px" }}>
					{connected ? "断开" : "连接"}
				</button>
			</div>
		</div>
	);
}

function UDPClientView({ active }: { active: boolean }) {
	const c = useCounter(100);
	return (
		<div className={"view" + (active ? " active" : " hidden")}>
			<h2>UDP Client</h2>
			<p>计数器: {c} (在后台继续运行)</p>
		</div>
	);
}

function TCPServerView({ active }: { active: boolean }) {
	const c = useCounter(200);
	return (
		<div className={"view" + (active ? " active" : " hidden")}>
			<h2>TCP Server</h2>
			<p>计数器: {c} (在后台继续运行)</p>
		</div>
	);
}

function TCPClientView({ active }: { active: boolean }) {
	const c = useCounter(300);
	return (
		<div className={"view" + (active ? " active" : " hidden")}>
			<h2>TCP Client</h2>
			<p>计数器: {c} (在后台继续运行)</p>
		</div>
	);
}

function App() {
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [active, setActive] = useState<"a" | "b" | "c" | "d">("a");

	return (
		<div className="app-root">
			<button
				className="sidebar-toggle"
				onClick={() => setSidebarOpen((s) => !s)}
				aria-label="Toggle sidebar"
			>
				☰
			</button>

			<aside className={"sidebar" + (sidebarOpen ? " open" : "")}>
				<div className="sidebar-inner">
					<button
						className={active === "a" ? "active" : ""}
						onClick={() => setActive("a")}
					>
						UDP Server
					</button>
					<button
						className={active === "b" ? "active" : ""}
						onClick={() => setActive("b")}
					>
						UDP Client
					</button>
					<button
						className={active === "c" ? "active" : ""}
						onClick={() => setActive("c")}
					>
						TCP Server
					</button>
					<button
						className={active === "d" ? "active" : ""}
						onClick={() => setActive("d")}
					>
						TCP Client
					</button>
				</div>
			</aside>

			<main className={"content" + (sidebarOpen ? " shift" : "")}>
				<section className="views">
					<UDPServerView active={active === "a"} />
					<UDPClientView active={active === "b"} />
					<TCPServerView active={active === "c"} />
					<TCPClientView active={active === "d"} />
				</section>
			</main>
		</div>
	);
}

export default App;
