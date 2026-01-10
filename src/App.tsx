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

function UDPServerView({ active, commandsOpen, setCommandsOpen }: { active: boolean; commandsOpen: boolean; setCommandsOpen: (v: boolean) => void }) {
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

	// send controls
	const [sendTarget, setSendTarget] = useState("192.168.1.212:61206");
	const [sendMsg, setSendMsg] = useState("");
	const [sendModeLocal, setSendModeLocal] = useState<"ascii" | "hex">("ascii");
	const [repeatEnabled, setRepeatEnabled] = useState(false);
	const [repeatMs, setRepeatMs] = useState("1000");
	const repeatRef = useRef<number | null>(null);

	// histories for datalist dropdowns (persist in localStorage)
	const [histories, setHistories] = useState<Record<string, string[]>>({});

	// command set (右侧侧边栏)
	interface Command {
		name: string;
		format: "ascii" | "hex";
		data: string;
	}

	const [commands, setCommands] = useState<Command[]>([]);

	const importInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		try {
			const raw = localStorage.getItem("nd_commands");
			if (raw) setCommands(JSON.parse(raw));
			else {
				// default sample commands
				setCommands([
					{ name: "Ping ASCII", format: "ascii", data: "ping" },
					{ name: "Status HEX", format: "hex", data: "01 02 03 04" },
					{ name: "Hello", format: "ascii", data: "hello world" },
				]);
			}
		} catch (e) { }
	}, []);

	const saveCommands = (next: Command[]) => {
		try {
			localStorage.setItem("nd_commands", JSON.stringify(next));
		} catch (e) { }
		setCommands(next);
	};

	const exportCommands = () => {
		try {
			const blob = new Blob([JSON.stringify(commands, null, 2)], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "commands.json";
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			console.error(e);
		}
	};

	const onImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const f = e.target.files && e.target.files[0];
		if (!f) return;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const parsed = JSON.parse(String(reader.result || ""));
				if (Array.isArray(parsed)) {
					saveCommands(parsed as Command[]);
				}
			} catch (err) {
				console.error(err);
			}
		};
		reader.readAsText(f);
		// clear value to allow re-import same file
		e.target.value = "";
	};

	const newCommand = () => {
		const name = window.prompt("指令名称:");
		if (!name) return;
		let format = window.prompt("格式 (ascii 或 hex):", "ascii");
		if (!format) return;
		format = format.trim().toLowerCase();
		if (format !== "ascii" && format !== "hex") {
			alert("格式必须为 ascii 或 hex");
			return;
		}
		const data = window.prompt("数据:");
		if (data == null) return;
		const c: Command = { name: name.trim(), format: format as any, data };
		saveCommands([c, ...commands]);
	};

	const applyCommand = (c: Command) => {
		setSendModeLocal(c.format);
		setSendMsg(c.data);
		addHistory("send_msg", c.data);
		addHistory("send_target", sendTarget);
		// close sidebar
		setCommandsOpen(false);
	};

	useEffect(() => {
		try {
			const raw = localStorage.getItem("nd_histories");
			if (raw) setHistories(JSON.parse(raw));
		} catch (e) {
			// ignore
		}
	}, []);

	const saveHistories = (next: Record<string, string[]>) => {
		try {
			localStorage.setItem("nd_histories", JSON.stringify(next));
		} catch (e) { }
		setHistories(next);
	};

	const addHistory = (key: string, value: string) => {
		if (!value) return;
		const cleaned = value.trim();
		if (!cleaned) return;
		// use functional update to avoid stale closures and cap at 50 entries
		setHistories((prev) => {
			const prevList = prev[key] ?? [];
			const next = [cleaned, ...prevList.filter((v) => v !== cleaned)].slice(0, 50);
			const nextObj = { ...prev, [key]: next };
			try {
				localStorage.setItem("nd_histories", JSON.stringify(nextObj));
			} catch (e) { }
			return nextObj;
		});
	};

	useEffect(() => {
		return () => {
			if (repeatRef.current != null) {
				clearInterval(repeatRef.current);
				repeatRef.current = null;
			}
		};
	}, []);

	const parseHex = (s: string) => {
		const cleaned = s.replace(/[^0-9a-fA-F]/g, "");
		if (cleaned.length % 2 !== 0) throw new Error("hex length must be even");
		const bytes = new Uint8Array(cleaned.length / 2);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
		}
		return bytes;
	};

	const sendOnce = async () => {
		try {
			let bytes: Uint8Array;
			if (sendModeLocal === "hex") {
				bytes = parseHex(sendMsg);
			} else {
				bytes = new TextEncoder().encode(sendMsg);
			}
			const b64 = btoa(String.fromCharCode(...bytes));
			await invoke<string>("udp_send", { toAddr: sendTarget, dataB64: b64 });
			// save to histories
			addHistory("send_msg", sendMsg);
			addHistory("send_target", sendTarget);
			appendStatus(`sent ${bytes.length} bytes to ${sendTarget}`);
		} catch (e) {
			appendStatus(String(e));
		}
	};

	const startRepeat = () => {
		if (repeatRef.current != null) return;
		const ms = Number(repeatMs) || 1000;
		const id = window.setInterval(() => {
			sendOnce();
		}, ms);
		repeatRef.current = id;
		setRepeatEnabled(true);
	};

	const stopRepeat = () => {
		if (repeatRef.current != null) {
			clearInterval(repeatRef.current);
			repeatRef.current = null;
		}
		setRepeatEnabled(false);
	};

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
			<h1>UDP Server</h1>

			<div
				ref={editorRef}
				contentEditable
				onInput={() => setHtml(editorRef.current?.innerHTML ?? "")}
				style={{ border: "1px solid #ccc", height: 300, overflowY: "auto", padding: 8, borderRadius: 4 }}
				aria-label="富文本编辑器"
			/>

			<div className="toolbar-row" style={{ marginBottom: 4 }}>
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

				<div className="toolbar-switch">
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
								background: displayMode === "hex" ? "#4caf50" : "#000000",
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

				<label>
					<span className="form-label-text">IP:</span>
					<input
						list="hist-bind-ip"
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
							addHistory("bind_ip", ip);
						}}
						disabled={connected}
						style={{ width: 150 }}
					/>
					<datalist id="hist-bind-ip">
						{(histories["bind_ip"] ?? []).map((h) => (
							<option key={h} value={h} />
						))}
					</datalist>
				</label>
				<label>
					<span className="form-label-text">Port:</span>
					<input list="hist-bind-port"
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
							addHistory("bind_port", port);
						}}
						disabled={connected}
						style={{ width: 100 }}
					/>
					<datalist id="hist-bind-port">
						{(histories["bind_port"] ?? []).map((h) => (
							<option key={h} value={h} />
						))}
					</datalist>
				</label>

				<button type="button" onClick={toggleConnection} style={{ padding: "6px 12px" }}>
					{connected ? "断开" : "连接"}
				</button>
			</div>

			{/* commands sidebar */}
			<div className={"commands-sidebar" + (commandsOpen ? " open" : "")}>
				<div className="commands-header" style={{ position: "relative" }}>
					<button className="commands-close" onClick={() => setCommandsOpen(false)} aria-label="close">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
							<circle cx="12" cy="12" r="11" stroke="currentColor" strokeOpacity="0.06" fill="none" />
							<path d="M10 8l4 4-4 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</button>

					<h3 style={{ margin: 0, textAlign: "center", width: "100%" }}>指令集</h3>

					<span style={{ margin: 15 }}></span>

					<div className="commands-actions">
						<button onClick={() => importInputRef.current?.click()}>导入</button>
						<button onClick={exportCommands}>导出</button>
						<button onClick={newCommand}>新增</button>
						<input ref={importInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={onImportChange} />
					</div>
				</div>
				<div className="commands-body">
					<table className="commands-table" style={{ width: "100%", borderCollapse: "collapse" }}>
						<thead>
							<tr>
								<th style={{ textAlign: "left" }}>名称</th>
								<th style={{ textAlign: "left" }}>格式</th>
								<th style={{ textAlign: "left" }}>数据</th>
								<th style={{ textAlign: "left" }}>操作</th>
							</tr>
						</thead>
						<tbody>
							{commands.map((c, idx) => (
								<tr key={idx}>
									<td>{c.name}</td>
									<td>{c.format.toUpperCase()}</td>
									<td style={{ fontFamily: "monospace" }}>{c.data}</td>
									<td>
										<button onClick={() => applyCommand(c)}>应用</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>

			<div className="control-row send-row send-row-1">
				<label className="field field-target">
					<span className="form-label-text">目标:</span>
					<input list="hist-send-target"
						placeholder="ip:port"
						value={sendTarget}
						onChange={(e) => setSendTarget(e.currentTarget.value)}
						onBlur={() => addHistory("send_target", sendTarget)}
					/>
					<datalist id="hist-send-target">
						{(histories["send_target"] ?? []).map((h) => (
							<option key={h} value={h} />
						))}
					</datalist>
				</label>
				<label className="field field-interval">
					<span className="form-label-text">间隔:</span>
					<input list="hist-repeat-ms"
						value={repeatMs}
						onChange={(e) => setRepeatMs(e.currentTarget.value.replace(/[^0-9]/g, ""))}
						onBlur={() => addHistory("repeat_ms", repeatMs)}
					/>
					<datalist id="hist-repeat-ms">
						{(histories["repeat_ms"] ?? []).map((h) => (
							<option key={h} value={h} />
						))}
					</datalist>
					<span className="form-label-text">ms</span>

				</label>

				<div
					className="field field-repeat"
					role="switch"
					aria-checked={repeatEnabled}
					onClick={() => {
						if (!repeatEnabled) startRepeat();
						else stopRepeat();
					}}
					style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
				>
					<div
						style={{
							width: 44,
							height: 24,
							borderRadius: 16,
							background: repeatEnabled ? "#4caf50" : "#000000",
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
								left: repeatEnabled ? 23 : 3,
								transition: "left 0.12s ease",
								boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
							}}
						/>
					</div>
					<span style={{ fontSize: 12 }}>连续发送</span>
				</div>

				<span style={{ marginLeft: 30 }}></span>
			</div>

			<div className="control-row send-row send-row-2">
				<label className="field field-message">
					<span className="form-label-text">消息:</span>
					<input list="hist-send-msg"
						placeholder="要发送的消息"
						value={sendMsg}
						onChange={(e) => setSendMsg(e.currentTarget.value)}
						onBlur={() => addHistory("send_msg", sendMsg)}
					/>
					<datalist id="hist-send-msg">
						{(histories["send_msg"] ?? []).map((h) => (
							<option key={h} value={h} />
						))}
					</datalist>
				</label>

				<div className="send-group">
					<div
						role="switch"
						aria-checked={sendModeLocal === "hex"}
						onClick={() => setSendModeLocal((m) => (m === "ascii" ? "hex" : "ascii"))}
						style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
					>
						<span style={{ fontSize: 12 }}>{sendModeLocal === "hex" ? "HEX" : "ASCII"}</span>
					</div>
					<button type="button" onClick={() => sendOnce()} style={{ padding: "6px 12px", marginLeft: '16px' }}>
						发送
					</button>
				</div>
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
	const [commandsOpen, setCommandsOpen] = useState(false);
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

			{/* commands icon - fixed, always visible like the sidebar toggle */}
			<button className="commands-toggle" onClick={() => setCommandsOpen(true)} aria-label="指令集">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
					<rect x="2.5" y="4" width="19" height="16" rx="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
					<path d="M8 12l3-2-3-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
					<path d="M14 15h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
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
				<div className="sidebar-bottom">
					<button className="commands-toggle" onClick={() => setCommandsOpen(true)} aria-label="指令集">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
							<path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</button>
				</div>
			</aside>

			<main className={"content" + (sidebarOpen ? " shift" : "")}>
				<section className="views">
					<UDPServerView active={active === "a"} commandsOpen={commandsOpen} setCommandsOpen={setCommandsOpen} />
					<UDPClientView active={active === "b"} />
					<TCPServerView active={active === "c"} />
					<TCPClientView active={active === "d"} />
				</section>
			</main>
		</div>
	);
}

export default App;
