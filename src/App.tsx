import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";



function ProgrammerCalculator({ onClose }: { onClose: () => void }) {
	const [base, setBase] = useState<2 | 8 | 10 | 16>(16);
	const [a, setA] = useState<string>("0");
	const [b, setB] = useState<string>("");
	const [pendingOp, setPendingOp] = useState<null | "+" | "-" | "*" | "/" | "AND" | "OR" | "XOR" | "SHL" | "SHR">(null);
	const [highlight, setHighlight] = useState(false);
	const aRef = useRef<HTMLInputElement | null>(null);
	const bRef = useRef<HTMLInputElement | null>(null);
	type InputTarget = "A" | "B";
	const [editingTarget, setEditingTarget] = useState<InputTarget>("A");

	const parseBigInt = (raw: string, radix: 2 | 8 | 10 | 16): bigint => {
		const s = raw.trim();
		if (s === "") return 0n;
		const neg = s.startsWith("-");
		const body = (neg ? s.slice(1) : s).replace(/^0+/, "") || "0";
		const pref = radix === 16 ? "0x" : radix === 10 ? "" : radix === 2 ? "0b" : "0o";
		const v = BigInt(pref + body);
		return neg ? -v : v;
	};

	const safeParse = (raw: string, radix: 2 | 8 | 10 | 16): bigint => {
		try {
			return parseBigInt(raw, radix);
		} catch {
			return 0n;
		}
	};

	const formatBigInt = (v: bigint, radix: 2 | 8 | 10 | 16) => {
		const neg = v < 0n;
		const abs = neg ? -v : v;
		const s = abs.toString(radix).toUpperCase();
		return neg ? `-${s}` : s;
	};

	const value = safeParse(a, base);

	const activeTarget = (): InputTarget => editingTarget;

	const allowedChar = (k: string, radix: 2 | 8 | 10 | 16) => {
		const c = k.toUpperCase();
		if (c === "-") return true;
		if (/^[0-9]$/.test(c)) return Number(c) < radix;
		if (/^[A-F]$/.test(c)) return radix === 16;
		return false;
	};

	const append = (target: InputTarget, k: string) => {
		const c = k.toUpperCase();
		if (!allowedChar(c, base)) return;
		if (target === "A") {
			setA((prev) => (prev === "0" && c !== "-" ? c : prev + c));
		} else {
			setB((prev) => prev + c);
		}
	};

	const backspace = (target: InputTarget) => {
		if (target === "A") {
			setA((prev) => {
				const next = prev.slice(0, -1);
				return next === "" || next === "-" ? "0" : next;
			});
		} else {
			setB((prev) => prev.slice(0, -1));
		}
	};

	const clearAll = () => {
		setA("0");
		setB("");
		setPendingOp(null);
		setEditingTarget("A");
		setTimeout(() => aRef.current?.focus(), 0);
	};

	const computeBinary = (op: NonNullable<typeof pendingOp>, left: bigint, right: bigint) => {
		switch (op) {
			case "+": return left + right;
			case "-": return left - right;
			case "*": return left * right;
			case "/": return right === 0n ? left : left / right;
			case "AND": return left & right;
			case "OR": return left | right;
			case "XOR": return left ^ right;
			case "SHL": return left << right;
			case "SHR": return left >> right;
		}
	};

	const setOp = (op: NonNullable<typeof pendingOp>) => {
		// If we already have an op and a RHS, chain compute first.
		if (pendingOp && b.trim() !== "") {
			const left = safeParse(a, base);
			const right = safeParse(b, base);
			const res = computeBinary(pendingOp, left, right);
			setA(formatBigInt(res, base));
			setB("");
			setPendingOp(op);
			setEditingTarget("B");
			setTimeout(() => bRef.current?.focus(), 0);
			return;
		}
		setPendingOp(op);
		setB("");
		setEditingTarget("B");
		setTimeout(() => bRef.current?.focus(), 0);
	};

	const equals = () => {
		if (!pendingOp) return;
		if (b.trim() === "") return;
		const left = safeParse(a, base);
		const right = safeParse(b, base);
		const res = computeBinary(pendingOp, left, right);
		setA(formatBigInt(res, base));
		setB("");
		setPendingOp(null);
		setEditingTarget("A");
		setHighlight(true);
		setTimeout(() => setHighlight(false), 700);
		setTimeout(() => aRef.current?.focus(), 0);
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				equals();
				return;
			}
			if (e.key === "Backspace") {
				e.preventDefault();
				backspace(activeTarget());
				return;
			}
			if (e.key === "c" || e.key === "C") {
				clearAll();
				return;
			}
			if (e.key.length === 1) {
				const k = e.key;
				if (k === "+" || k === "-" || k === "*" || k === "/") {
					setOp(k as any);
					return;
				}
				append(activeTarget(), k);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [a, b, base, pendingOp, onClose]);

	return (
		<div className="programmer-calc new-layout">
			{/* copy button moved to top-right */}
			<button className="copy-top" onClick={() => navigator.clipboard?.writeText(formatBigInt(value, base))}>Copy</button>
			<div className="pc-top">
				<div className="pc-left-info">
					<div className="info-row"><div>BIN</div><div className="mono">{formatBigInt(value, 2)}</div></div>
					<div className="info-row"><div>OCT</div><div className="mono">{formatBigInt(value, 8)}</div></div>
					<div className="info-row"><div>DEC</div><div className="mono">{formatBigInt(value, 10)}</div></div>
					<div className="info-row"><div>HEX</div><div className="mono">{formatBigInt(value, 16)}</div></div>
					{/* bits moved below (rendered next to left-info) */}
				</div>
				{/* bits are rendered above Pending (see below) */}

				<div className="pc-display">
					<div>
						<div className="display-value">{formatBigInt(value, base)}</div>
						<div className="pc-io-row">
							<input
								ref={aRef}
								className="pc-input"
								value={a}
								onFocus={() => setEditingTarget("A")}
								onChange={(e) => setA(e.target.value)}
								placeholder="A"
							/>
							<input
								ref={bRef}
								id="pc-b"
								className="pc-input"
								value={b}
								onFocus={() => setEditingTarget("B")}
								onChange={(e) => setB(e.target.value)}
								placeholder="B"
							/>
						</div>

						{/* binary bits display row: show lower 32 bits of current A value */}

						{highlight && <div className="pc-result-highlight" />}
					</div>
				</div>
			</div>

			<div className="pc-grid">
				{/* horizontal 16-bit row (Win11-style) placed above the Pending row */}
				<div className="pc-bits-wrap below-pending">
					<div className="pc-bits" aria-hidden>
						{(() => {
							const mask = (1n << 16n) - 1n;
							const u = value & mask;
							const jsx: any[] = [];
							for (let i = 15; i >= 0; i--) {
								const bit = Number((u >> BigInt(i)) & 1n);
								jsx.push(
									<button
										key={i}
										className={"pc-bit chip" + (bit ? " on" : "")}
										title={`bit ${i}`}
										onClick={() => {
											const mask = 1n << BigInt(i);
											const curr = safeParse(a, base);
											const next = curr ^ mask;
											setA(formatBigInt(next, base));
											setEditingTarget("A");
											setTimeout(() => aRef.current?.focus(), 0);
										}}
									>
										{bit}
									</button>
								);
							}
							return jsx;
						})()}
					</div>
					<div className="pc-bit-labels pc-bit-labels-inline">
						{(() => {
							const labels: any[] = [];
							for (let i = 15; i >= 0; i--) {
								labels.push(
									<span key={i} className="pc-bit-label">{[12, 8, 4, 0].includes(i) ? String(i) : ""}</span>
								);
							}
							return labels;
						})()}
					</div>
				</div>
				<div className="pc-opbar">
					<div className="mono">Pending: {pendingOp ?? "—"}</div>
					{/* inline clear button placed to the right of Pending */}
					<div className="pc-toolbar-buttons">
						<button className={base === 2 ? "small-btn active" : "small-btn"} onClick={() => setBase(2)}>BIN</button>
						<button className={base === 8 ? "small-btn active" : "small-btn"} onClick={() => setBase(8)}>OCT</button>
						<button className={base === 10 ? "small-btn active" : "small-btn"} onClick={() => setBase(10)}>DEC</button>
						<button className={base === 16 ? "small-btn active" : "small-btn"} onClick={() => setBase(16)}>HEX</button>
					</div>
					<div className="pc-clear-inline"><button className="big-clear inline" onClick={clearAll}>C</button></div>
				</div>

				<span style={{ margin: "auto" }} />

				<div className="kp-hex-row">
					{["A", "B", "C", "D", "E", "F"].map((k) => (
						<button key={k} className="kp-hex-h" onClick={() => append(activeTarget(), k)}>{k}</button>
					))}
				</div>
				<div className="kp-main-grid">
					<div className="grid-row">
						{["7", "8", "9"].map((k) => (
							<button key={k} onClick={() => append(activeTarget(), k)}>{k}</button>
						))}
						<button onClick={() => setOp("/")}>/</button>
					</div>
					<div className="grid-row">
						{["4", "5", "6"].map((k) => (
							<button key={k} onClick={() => append(activeTarget(), k)}>{k}</button>
						))}
						<button onClick={() => setOp("*")}>*</button>
					</div>
					<div className="grid-row">
						{["1", "2", "3"].map((k) => (
							<button key={k} onClick={() => append(activeTarget(), k)}>{k}</button>
						))}
						<button onClick={() => setOp("-")}>-</button>
					</div>
					<div className="grid-row">
						<button className="kp-zero" onClick={() => append(activeTarget(), "0")}>0</button>
						<button onClick={() => backspace(activeTarget())}>←</button>
						<button className="kp-eq" onClick={equals}>=</button>
						<button onClick={() => setOp("+")}>+</button>
					</div>
				</div>
			</div>
		</div>
	);
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
	const [connections, setConnections] = useState<string[]>([]);

	const currentBind = `${ip}:${port}`;

	const isConnected = (bind: string) => {
		return connections.includes(bind);
	};
	const [, setStatus] = useState("");
	const [hideDup] = useState(true);

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

	const removeCommand = (index: number) => {
		if (!window.confirm("确定要移除该指令吗？")) return;
		const next = commands.filter((_, i) => i !== index);
		saveCommands(next);
	};

	useEffect(() => {
		try {
			const raw = localStorage.getItem("nd_histories");
			if (raw) setHistories(JSON.parse(raw));
		} catch (e) {
			// ignore
		}
	}, []);

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
			// Send using the currently configured IP:Port as source when possible.
			// If there is a running server on that bind, backend uses the same socket (source port matches the listener).
			await invoke<string>("udp_send_from", { bindAddr: currentBind, toAddr: sendTarget, dataB64: b64 });
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
				const bind = payload.bind ?? "";
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

				const who = bind ? `[${escapeHtml(bind)}] ${escapeHtml(from)}` : escapeHtml(from);
				const snippet = `<div style="margin:6px 0;"><span style="color:#999;font-size:12px;margin-right:8px;">${escapeHtml(ts)}</span><strong>${who}</strong>${seqTag}${dupTag}: ${contentHtml}</div>`;
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
		const bindAddr = currentBind;
		if (!isConnected(bindAddr)) {
			try {
				const res = await invoke<string>("start_udp_server", { bindAddr });
				appendStatus(res ?? `started ${bindAddr}`);
				setStatus(res ?? "started");
				setConnections((prev) => [bindAddr, ...prev.filter((v) => v !== bindAddr)]);
			} catch (e) {
				appendStatus(String(e));
				setStatus(String(e));
			}
		} else {
			try {
				const res = await invoke<string>("stop_udp_server", { bindAddr });
				appendStatus(res ?? `stopped ${bindAddr}`);
				setStatus(res ?? "stopped");
				setConnections((prev) => prev.filter((v) => v !== bindAddr));
			} catch (e) {
				appendStatus(String(e));
				setStatus(String(e));
			}
		}
	};

	const disconnectBind = async (bindAddr: string) => {
		try {
			const res = await invoke<string>("stop_udp_server", { bindAddr });
			appendStatus(res ?? `stopped ${bindAddr}`);
			setStatus(res ?? "stopped");
			setConnections((prev) => prev.filter((v) => v !== bindAddr));
		} catch (e) {
			appendStatus(String(e));
			setStatus(String(e));
		}
	};

	return (
		<div className={"view" + (active ? " active" : " hidden")}>
			<h2>UDP Server</h2>

			<div
				ref={editorRef}
				contentEditable
				onInput={() => setHtml(editorRef.current?.innerHTML ?? "")}
				style={{ border: "1px solid #ccc", height: 250, overflowY: "auto", padding: 8, borderRadius: 4 }}
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
						style={{ width: 100 }}
					/>
					<datalist id="hist-bind-port">
						{(histories["bind_port"] ?? []).map((h) => (
							<option key={h} value={h} />
						))}
					</datalist>
				</label>

				<button type="button" onClick={toggleConnection} style={{ padding: "6px 12px" }}>
					{isConnected(currentBind) ? "断开" : "连接"}
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
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 0 }}>
											<div style={{ display: "flex", gap: 8 }}>
												<button onClick={() => applyCommand(c)}>应用</button>
											</div>
											<div>
												<button onClick={() => removeCommand(idx)}>移除</button>
											</div>
										</div>
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
			{/* active connections list */}
			{connections.length > 0 && (
				<div className="connections-box">
					<div className="connections-header">活跃连接</div>
					<ul className="connections-list">
						{connections.map((c) => (
							<li
								key={c}
								className={c === currentBind ? "connection-item current" : "connection-item"}
								style={{ display: "flex", alignItems: "center", minHeight: 30, gap: 8 }}
							>
								<span className="conn-text" style={{ display: "inline-flex", alignItems: "center", height: 26, lineHeight: "26px", padding: "0 6px" }}>{c}</span>
								<button className="conn-disconnect" onClick={() => disconnectBind(c)} style={{ height: 26, lineHeight: "26px", padding: "0 8px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>断开</button>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function UDPClientView({ active }: { active: boolean }) {
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

	const bytesToHex = (bytes: Uint8Array) => {
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join(" ")
			.toUpperCase();
	};

	const [ip, setIp] = useState("0.0.0.0");
	const [port, setPort] = useState("0");
	const currentBind = `${ip}:${port}`;
	const [connections, setConnections] = useState<string[]>([]);
	const isConnected = (bind: string) => connections.includes(bind);

	const [sendTarget, setSendTarget] = useState("127.0.0.1:9000");
	const [sendMsg, setSendMsg] = useState("");
	const [sendMode, setSendMode] = useState<"ascii" | "hex">("ascii");

	const [histories, setHistories] = useState<Record<string, string[]>>({});
	useEffect(() => {
		try {
			const raw = localStorage.getItem("nd_histories");
			if (raw) setHistories(JSON.parse(raw));
		} catch (e) { }
	}, []);

	const addHistory = (key: string, value: string) => {
		if (!value) return;
		const cleaned = value.trim();
		if (!cleaned) return;
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

	const parseHex = (s: string) => {
		const cleaned = s.replace(/[^0-9a-fA-F]/g, "");
		if (cleaned.length % 2 !== 0) throw new Error("hex length must be even");
		const bytes = new Uint8Array(cleaned.length / 2);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
		}
		return bytes;
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
		let disposed = false;
		let unlistenMsg: (() => void) | null = null;
		let unlistenErr: (() => void) | null = null;

		listen("udp:client:message", (event) => {
			try {
				const payload: any = event.payload as any;
				const bind = payload.bind ?? "";
				const from = payload.from ?? "unknown";
				const b64 = payload.data ?? "";
				const dup = Boolean(payload.dup);
				const seq = payload.seq != null ? String(payload.seq) : "";

				const binStr = atob(b64 || "");
				const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));

				let text = "";
				let isHexShown = false;
				try {
					text = new TextDecoder().decode(bytes);
					if (text.includes("\uFFFD") || /[\x00-\x08\x0E-\x1F]/.test(text)) {
						text = bytesToHex(bytes);
						isHexShown = true;
					}
				} catch (err) {
					text = bytesToHex(bytes);
					isHexShown = true;
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

				const who = bind ? `[${escapeHtml(bind)}] ${escapeHtml(from)}` : escapeHtml(from);
				const tsMs = typeof payload.ts_ms === "number" ? payload.ts_ms : null;
				const ts = tsMs ? new Date(tsMs).toLocaleString() : new Date().toLocaleString();
				const snippet = `<div style=\"margin:6px 0;\"><span style=\"color:#999;font-size:12px;margin-right:8px;\">${escapeHtml(ts)}</span><strong>${who}</strong>${seqTag}${dupTag}: ${contentHtml}</div>`;
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
				else unlistenMsg = u;
			})
			.catch(() => { });

		listen("udp:client:error", (event) => {
			const payload: any = event.payload as any;
			const msg = payload?.error ?? "unknown error";
			appendStatus(String(msg));
		})
			.then((u) => {
				if (disposed) u();
				else unlistenErr = u;
			})
			.catch(() => { });

		return () => {
			disposed = true;
			if (unlistenMsg) unlistenMsg();
			if (unlistenErr) unlistenErr();
		};
	}, [/* nothing */]);

	const toggleConnection = async () => {
		const bindAddr = currentBind;
		if (!isConnected(bindAddr)) {
			try {
				const res = await invoke<string>("start_udp_client", { bindAddr });
				appendStatus(res ?? `started ${bindAddr}`);
				setConnections((prev) => [bindAddr, ...prev.filter((v) => v !== bindAddr)]);
				addHistory("bind_ip", ip);
				addHistory("bind_port", port);
			} catch (e) {
				appendStatus(String(e));
			}
		} else {
			try {
				const res = await invoke<string>("stop_udp_client", { bindAddr });
				appendStatus(res ?? `stopped ${bindAddr}`);
				setConnections((prev) => prev.filter((v) => v !== bindAddr));
			} catch (e) {
				appendStatus(String(e));
			}
		}
	};

	const sendOnce = async () => {
		try {
			let bytes: Uint8Array;
			if (sendMode === "hex") bytes = parseHex(sendMsg);
			else bytes = new TextEncoder().encode(sendMsg);
			const b64 = btoa(String.fromCharCode(...bytes));
			await invoke<string>("udp_client_send_from", { bindAddr: currentBind, toAddr: sendTarget, dataB64: b64 });
			addHistory("send_msg", sendMsg);
			addHistory("send_target", sendTarget);
			appendStatus(`sent ${bytes.length} bytes to ${sendTarget}`);
		} catch (e) {
			appendStatus(String(e));
		}
	};

	return (
		<div className={"view" + (active ? " active" : " hidden")}>
			<h2>UDP Client</h2>

			<div
				ref={editorRef}
				contentEditable
				onInput={() => setHtml(editorRef.current?.innerHTML ?? "")}
				style={{ border: "1px solid #ccc", height: 250, overflowY: "auto", padding: 8, borderRadius: 4 }}
				aria-label="消息面板"
			/>

			<div className="toolbar-row" style={{ marginBottom: 4 }}>
				<button type="button" onClick={() => { if (editorRef.current) { editorRef.current.innerHTML = ""; setHtml(""); } }}>清空</button>
				<button type="button" onClick={() => { if (editorRef.current && navigator.clipboard) { navigator.clipboard.writeText(editorRef.current.innerText); } }}>复制消息</button>

				<label style={{ marginLeft: 12 }}>
					<span className="form-label-text">IP:</span>
					<input value={ip} onChange={(e) => setIp(e.currentTarget.value.replace(/[^0-9.]/g, ""))} onBlur={() => addHistory("bind_ip", ip)} style={{ width: 140 }} />
				</label>
				<label>
					<span className="form-label-text">Port:</span>
					<input value={port} onChange={(e) => setPort(e.currentTarget.value.replace(/[^0-9]/g, ""))} onBlur={() => addHistory("bind_port", port)} style={{ width: 100 }} />
				</label>
				<button type="button" onClick={toggleConnection} style={{ marginLeft: 8 }}>{isConnected(currentBind) ? "断开" : "绑定"}</button>
			</div>

			<div className="control-row send-row send-row-1">
				<label className="field field-target">
					<span className="form-label-text">目标:</span>
					<input list="hist-send-target" placeholder="ip:port" value={sendTarget} onChange={(e) => setSendTarget(e.currentTarget.value)} onBlur={() => addHistory("send_target", sendTarget)} />
					<datalist id="hist-send-target">{(histories["send_target"] ?? []).map((h) => (<option key={h} value={h} />))}</datalist>
				</label>
			</div>

			<div className="control-row send-row send-row-2">
				<label className="field field-message">
					<span className="form-label-text">消息:</span>
					<input list="hist-send-msg" placeholder="要发送的消息" value={sendMsg} onChange={(e) => setSendMsg(e.currentTarget.value)} onBlur={() => addHistory("send_msg", sendMsg)} />
					<datalist id="hist-send-msg">{(histories["send_msg"] ?? []).map((h) => (<option key={h} value={h} />))}</datalist>
				</label>

				<div className="send-group">
					<div role="switch" aria-checked={sendMode === "hex"} onClick={() => setSendMode((m) => (m === "ascii" ? "hex" : "ascii"))} style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
						<span style={{ fontSize: 12 }}>{sendMode === "hex" ? "HEX" : "ASCII"}</span>
					</div>
					<button type="button" onClick={() => sendOnce()} style={{ padding: "6px 12px", marginLeft: '16px' }}>发送</button>
				</div>
			</div>

			{connections.length > 0 && (
				<div className="connections-box">
					<div className="connections-header">已绑定</div>
					<ul className="connections-list">
						{connections.map((c) => (
							<li key={c} className={c === currentBind ? "connection-item current" : "connection-item"} style={{ display: "flex", alignItems: "center", minHeight: 30, gap: 8 }}>
								<span className="conn-text" style={{ display: "inline-flex", alignItems: "center", height: 26, lineHeight: "26px", padding: "0 6px" }}>{c}</span>
								<button className="conn-disconnect" onClick={async () => { try { const res = await invoke<string>("stop_udp_client", { bindAddr: c }); appendStatus(res ?? `stopped ${c}`); setConnections((prev) => prev.filter((v) => v !== c)); } catch (e) { appendStatus(String(e)); } }} style={{ height: 26, lineHeight: "26px", padding: "0 8px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>断开</button>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function TCPServerView({ active }: { active: boolean }) {
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

	const bytesToHex = (bytes: Uint8Array) => {
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join(" ")
			.toUpperCase();
	};

	const [ip, setIp] = useState("0.0.0.0");
	const [port, setPort] = useState("9000");
	const bindAddr = `${ip}:${port}`;

	const [clients, setClients] = useState<string[]>([]);

	const [sendMsg, setSendMsg] = useState("");
	const [sendMode, setSendMode] = useState<"ascii" | "hex">("ascii");
	const [toPeer, setToPeer] = useState<string | null>(null);

	const [histories, setHistories] = useState<Record<string, string[]>>({});
	useEffect(() => {
		try {
			const raw = localStorage.getItem("nd_histories");
			if (raw) setHistories(JSON.parse(raw));
		} catch (e) { }
	}, []);

	const addHistory = (key: string, value: string) => {
		if (!value) return;
		const cleaned = value.trim();
		if (!cleaned) return;
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

	const parseHex = (s: string) => {
		const cleaned = s.replace(/[^0-9a-fA-F]/g, "");
		if (cleaned.length % 2 !== 0) throw new Error("hex length must be even");
		const bytes = new Uint8Array(cleaned.length / 2);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
		}
		return bytes;
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
		let disposed = false;
		let unMsg: (() => void) | null = null;
		let unErr: (() => void) | null = null;
		let unConn: (() => void) | null = null;
		let unDisc: (() => void) | null = null;

		listen("tcp:server:message", (event) => {
			try {
				const payload: any = event.payload as any;
				const bind = payload.bind ?? "";
				const from = payload.from ?? "unknown";
				const b64 = payload.data ?? "";
				const seq = payload.seq != null ? String(payload.seq) : "";
				const tsMs = typeof payload.ts_ms === "number" ? payload.ts_ms : null;
				const ts = tsMs ? new Date(tsMs).toLocaleString() : new Date().toLocaleString();

				const binStr = atob(b64 || "");
				const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));

				let text = "";
				let isHexShown = false;
				try {
					text = new TextDecoder().decode(bytes);
					if (text.includes("\uFFFD") || /[\x00-\x08\x0E-\x1F]/.test(text)) {
						text = bytesToHex(bytes);
						isHexShown = true;
					}
				} catch (err) {
					text = bytesToHex(bytes);
					isHexShown = true;
				}

				const contentHtml = isHexShown
					? `<pre style=\"font-family:monospace; white-space:pre-wrap; margin:0;\">${escapeHtml(text)}</pre>`
					: `<pre style=\"white-space:pre-wrap; margin:0;\">${escapeHtml(text)}</pre>`;

				const seqTag = seq ? `<span style=\"color:#90a4ae;font-size:12px;margin-left:6px;\">#${escapeHtml(seq)}</span>` : "";
				const who = bind ? `[${escapeHtml(bind)}] ${escapeHtml(from)}` : escapeHtml(from);
				const snippet = `<div style=\"margin:6px 0;\"><span style=\"color:#999;font-size:12px;margin-right:8px;\">${escapeHtml(ts)}</span><strong>${who}</strong>${seqTag}: ${contentHtml}</div>`;
				if (editorRef.current) {
					editorRef.current.insertAdjacentHTML("beforeend", snippet);
					editorRef.current.scrollTop = editorRef.current.scrollHeight;
					setHtml(editorRef.current.innerHTML);
				}
			} catch (e) { }
		})
			.then((u) => { if (disposed) u(); else unMsg = u; })
			.catch(() => { });

		listen("tcp:server:error", (event) => {
			const payload: any = event.payload as any;
			const msg = payload?.error ?? "unknown error";
			appendStatus(String(msg));
		})
			.then((u) => { if (disposed) u(); else unErr = u; })
			.catch(() => { });

		listen("tcp:server:client_connected", (event) => {
			try {
				const payload: any = event.payload as any;
				const peer = payload?.peer ?? "";
				if (peer) setClients((p) => [peer, ...p.filter((x) => x !== peer)]);
			} catch (e) { }
		})
			.then((u) => { if (disposed) u(); else unConn = u; })
			.catch(() => { });

		listen("tcp:server:client_disconnected", (event) => {
			try {
				const payload: any = event.payload as any;
				const peer = payload?.peer ?? "";
				if (peer) setClients((p) => p.filter((x) => x !== peer));
			} catch (e) { }
		})
			.then((u) => { if (disposed) u(); else unDisc = u; })
			.catch(() => { });

		return () => {
			disposed = true;
			if (unMsg) unMsg();
			if (unErr) unErr();
			if (unConn) unConn();
			if (unDisc) unDisc();
		};
	}, []);

	const toggleServer = async () => {
		const b = bindAddr;
		if (!b) return;
		try {
			// check if already running by clients/other state
			const running = false; // simple toggle based on client list not reliable; UI shows bind/unbind
			if (!running) {
				const res = await invoke<string>("start_tcp_server", { bindAddr: b });
				appendStatus(res ?? `started ${b}`);
				addHistory("bind_ip", ip);
				addHistory("bind_port", port);
			} else {
				const res = await invoke<string>("stop_tcp_server", { bindAddr: b });
				appendStatus(res ?? `stopped ${b}`);
			}
		} catch (e) {
			appendStatus(String(e));
		}
	};

	const sendOnce = async () => {
		try {
			let bytes: Uint8Array;
			if (sendMode === "hex") bytes = parseHex(sendMsg);
			else bytes = new TextEncoder().encode(sendMsg);
			const b64 = btoa(String.fromCharCode(...bytes));
			await invoke<string>("tcp_server_send", { bindAddr: bindAddr, toPeer: toPeer ?? undefined, dataB64: b64 });
			addHistory("send_msg", sendMsg);
			appendStatus(`sent ${bytes.length} bytes`);
		} catch (e) {
			appendStatus(String(e));
		}
	};

	return (
		<div className={"view" + (active ? " active" : " hidden")}>
			<h2>TCP Server</h2>

			<div
				ref={editorRef}
				contentEditable
				onInput={() => setHtml(editorRef.current?.innerHTML ?? "")}
				style={{ border: "1px solid #ccc", height: 250, overflowY: "auto", padding: 8, borderRadius: 4 }}
				aria-label="消息面板"
			/>

			<div className="toolbar-row" style={{ marginBottom: 4 }}>
				<button type="button" onClick={() => { if (editorRef.current) { editorRef.current.innerHTML = ""; setHtml(""); } }}>清空</button>
				<button type="button" onClick={() => { if (editorRef.current && navigator.clipboard) { navigator.clipboard.writeText(editorRef.current.innerText); } }}>复制消息</button>

				<label style={{ marginLeft: 12 }}>
					<span className="form-label-text">IP:</span>
					<input value={ip} onChange={(e) => setIp(e.currentTarget.value.replace(/[^0-9.]/g, ""))} onBlur={() => addHistory("bind_ip", ip)} style={{ width: 140 }} />
				</label>
				<label>
					<span className="form-label-text">Port:</span>
					<input value={port} onChange={(e) => setPort(e.currentTarget.value.replace(/[^0-9]/g, ""))} onBlur={() => addHistory("bind_port", port)} style={{ width: 100 }} />
				</label>
				<button type="button" onClick={toggleServer} style={{ marginLeft: 8 }}>启动/停止</button>
			</div>

			<div className="control-row send-row send-row-1">
				<label className="field field-peer">
					<span className="form-label-text">目标客户端 (留空为广播):</span>
					<input list="hist-peers" placeholder="ip:port" value={toPeer ?? ""} onChange={(e) => setToPeer(e.currentTarget.value || null)} />
					<datalist id="hist-peers">{clients.map((c) => (<option key={c} value={c} />))}</datalist>
				</label>
			</div>

			<div className="control-row send-row send-row-2">
				<label className="field field-message">
					<span className="form-label-text">消息:</span>
					<input list="hist-send-msg" placeholder="要发送的消息" value={sendMsg} onChange={(e) => setSendMsg(e.currentTarget.value)} onBlur={() => addHistory("send_msg", sendMsg)} />
					<datalist id="hist-send-msg">{(histories["send_msg"] ?? []).map((h) => (<option key={h} value={h} />))}</datalist>
				</label>

				<div className="send-group">
					<div role="switch" aria-checked={sendMode === "hex"} onClick={() => setSendMode((m) => (m === "ascii" ? "hex" : "ascii"))} style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
						<span style={{ fontSize: 12 }}>{sendMode === "hex" ? "HEX" : "ASCII"}</span>
					</div>
					<button type="button" onClick={() => sendOnce()} style={{ padding: "6px 12px", marginLeft: '16px' }}>发送</button>
				</div>
			</div>

			{clients.length > 0 && (
				<div className="connections-box">
					<div className="connections-header">在线客户端</div>
					<ul className="connections-list">
						{clients.map((c) => (
							<li key={c} className={c === toPeer ? "connection-item current" : "connection-item"} style={{ display: "flex", alignItems: "center", minHeight: 30, gap: 8 }}>
								<span className="conn-text" style={{ display: "inline-flex", alignItems: "center", height: 26, lineHeight: "26px", padding: "0 6px" }}>{c}</span>
								<button className="conn-disconnect" onClick={() => { setToPeer(c); }} style={{ height: 26, lineHeight: "26px", padding: "0 8px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>选为目标</button>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function TCPClientView({ active }: { active: boolean }) {
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

	const bytesToHex = (bytes: Uint8Array) => {
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join(" ")
			.toUpperCase();
	};

	const [remoteAddr, setRemoteAddr] = useState("127.0.0.1:9000");
	const [connections, setConnections] = useState<string[]>([]);
	const isConnected = (addr: string) => connections.includes(addr);

	const [sendMsg, setSendMsg] = useState("");
	const [sendMode, setSendMode] = useState<"ascii" | "hex">("ascii");

	const [histories, setHistories] = useState<Record<string, string[]>>({});

	useEffect(() => {
		try {
			const raw = localStorage.getItem("nd_histories");
			if (raw) setHistories(JSON.parse(raw));
		} catch (e) { }
	}, []);

	const addHistory = (key: string, value: string) => {
		if (!value) return;
		const cleaned = value.trim();
		if (!cleaned) return;
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

	const parseHex = (s: string) => {
		const cleaned = s.replace(/[^0-9a-fA-F]/g, "");
		if (cleaned.length % 2 !== 0) throw new Error("hex length must be even");
		const bytes = new Uint8Array(cleaned.length / 2);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
		}
		return bytes;
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
		let disposed = false;
		let unlistenMsg: (() => void) | null = null;
		let unlistenErr: (() => void) | null = null;

		listen("tcp:client:message", (event) => {
			try {
				const payload: any = event.payload as any;
				const remote = payload.remote ?? "unknown";
				const b64 = payload.data ?? "";
				const seq = payload.seq != null ? String(payload.seq) : "";
				const tsMs = typeof payload.ts_ms === "number" ? payload.ts_ms : null;
				const ts = tsMs ? new Date(tsMs).toLocaleString() : new Date().toLocaleString();

				const binStr = atob(b64 || "");
				const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));

				let text = "";
				let isHexShown = false;
				try {
					text = new TextDecoder().decode(bytes);
					if (text.includes("\uFFFD") || /[\x00-\x08\x0E-\x1F]/.test(text)) {
						text = bytesToHex(bytes);
						isHexShown = true;
					}
				} catch (err) {
					text = bytesToHex(bytes);
					isHexShown = true;
				}

				const contentHtml = isHexShown
					? `<pre style=\"font-family:monospace; white-space:pre-wrap; margin:0;\">${escapeHtml(text)}</pre>`
					: `<pre style=\"white-space:pre-wrap; margin:0;\">${escapeHtml(text)}</pre>`;

				const seqTag = seq ? `<span style=\"color:#90a4ae;font-size:12px;margin-left:6px;\">#${escapeHtml(seq)}</span>` : "";
				const who = escapeHtml(String(remote));
				const snippet = `<div style=\"margin:6px 0;\"><span style=\"color:#999;font-size:12px;margin-right:8px;\">${escapeHtml(ts)}</span><strong>${who}</strong>${seqTag}: ${contentHtml}</div>`;
				if (editorRef.current) {
					editorRef.current.insertAdjacentHTML("beforeend", snippet);
					editorRef.current.scrollTop = editorRef.current.scrollHeight;
					setHtml(editorRef.current.innerHTML);
				}
			} catch (e) {
				// ignore
			}
		})
			.then((u) => {
				if (disposed) u();
				else unlistenMsg = u;
			})
			.catch(() => { });

		listen("tcp:client:error", (event) => {
			const payload: any = event.payload as any;
			const msg = payload?.error ?? "unknown error";
			appendStatus(String(msg));
		})
			.then((u) => {
				if (disposed) u();
				else unlistenErr = u;
			})
			.catch(() => { });

		return () => {
			disposed = true;
			if (unlistenMsg) unlistenMsg();
			if (unlistenErr) unlistenErr();
		};
	}, []);

	const toggleConnection = async () => {
		const addr = remoteAddr.trim();
		if (!addr) return;
		if (!isConnected(addr)) {
			try {
				const res = await invoke<string>("start_tcp_client", { remoteAddr: addr });
				appendStatus(res ?? `connected ${addr}`);
				setConnections((prev) => [addr, ...prev.filter((v) => v !== addr)]);
				addHistory("tcp_remote", addr);
			} catch (e) {
				appendStatus(String(e));
			}
		} else {
			try {
				const res = await invoke<string>("stop_tcp_client", { remoteAddr: addr });
				appendStatus(res ?? `disconnected ${addr}`);
				setConnections((prev) => prev.filter((v) => v !== addr));
			} catch (e) {
				appendStatus(String(e));
			}
		}
	};

	const sendOnce = async () => {
		try {
			let bytes: Uint8Array;
			if (sendMode === "hex") {
				bytes = parseHex(sendMsg);
			} else {
				bytes = new TextEncoder().encode(sendMsg);
			}
			const b64 = btoa(String.fromCharCode(...bytes));
			await invoke<string>("tcp_client_send", { remoteAddr: remoteAddr.trim(), dataB64: b64 });
			addHistory("send_msg", sendMsg);
			appendStatus(`sent ${bytes.length} bytes to ${remoteAddr}`);
		} catch (e) {
			appendStatus(String(e));
		}
	};

	return (
		<div className={"view" + (active ? " active" : " hidden")}>
			<h2>TCP Client</h2>

			<div
				ref={editorRef}
				contentEditable
				onInput={() => setHtml(editorRef.current?.innerHTML ?? "")}
				style={{ border: "1px solid #ccc", height: 250, overflowY: "auto", padding: 8, borderRadius: 4 }}
				aria-label="消息面板"
			/>

			<div className="toolbar-row" style={{ marginBottom: 4 }}>
				<button type="button" onClick={() => { if (editorRef.current) { editorRef.current.innerHTML = ""; setHtml(""); } }}>清空</button>
				<button type="button" onClick={() => { if (editorRef.current && navigator.clipboard) { navigator.clipboard.writeText(editorRef.current.innerText); } }}>复制消息</button>

				<label style={{ marginLeft: 12 }}>
					<span className="form-label-text">远端:</span>
					<input list="hist-tcp-remote" value={remoteAddr} onChange={(e) => setRemoteAddr(e.currentTarget.value)} onBlur={() => addHistory("tcp_remote", remoteAddr)} style={{ width: 220 }} />
					<datalist id="hist-tcp-remote">{(histories["tcp_remote"] ?? []).map((h) => (<option key={h} value={h} />))}</datalist>
				</label>

				<button type="button" onClick={toggleConnection} style={{ marginLeft: 8 }}>{isConnected(remoteAddr.trim()) ? "断开" : "连接"}</button>
			</div>

			<div className="control-row send-row send-row-2">
				<label className="field field-message">
					<span className="form-label-text">消息:</span>
					<input list="hist-send-msg" placeholder="要发送的消息" value={sendMsg} onChange={(e) => setSendMsg(e.currentTarget.value)} onBlur={() => addHistory("send_msg", sendMsg)} />
					<datalist id="hist-send-msg">{(histories["send_msg"] ?? []).map((h) => (<option key={h} value={h} />))}</datalist>
				</label>

				<div className="send-group">
					<div role="switch" aria-checked={sendMode === "hex"} onClick={() => setSendMode((m) => (m === "ascii" ? "hex" : "ascii"))} style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
						<span style={{ fontSize: 12 }}>{sendMode === "hex" ? "HEX" : "ASCII"}</span>
					</div>
					<button type="button" onClick={() => sendOnce()} style={{ padding: "6px 12px", marginLeft: '16px' }}>发送</button>
				</div>
			</div>

			{connections.length > 0 && (
				<div className="connections-box">
					<div className="connections-header">已连接</div>
					<ul className="connections-list">
						{connections.map((c) => (
							<li key={c} className={c === remoteAddr ? "connection-item current" : "connection-item"} style={{ display: "flex", alignItems: "center", minHeight: 30, gap: 8 }}>
								<span className="conn-text" style={{ display: "inline-flex", alignItems: "center", height: 26, lineHeight: "26px", padding: "0 6px" }}>{c}</span>
								<button className="conn-disconnect" onClick={async () => { try { const res = await invoke<string>("stop_tcp_client", { remoteAddr: c }); appendStatus(res ?? `disconnected ${c}`); setConnections((prev) => prev.filter((v) => v !== c)); } catch (e) { appendStatus(String(e)); } }} style={{ height: 26, lineHeight: "26px", padding: "0 8px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>断开</button>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function App() {
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [commandsOpen, setCommandsOpen] = useState(false);
	const [calcOpen, setCalcOpen] = useState(false);
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

			{/* calculator toggle (new) */}
			<button className="calc-toggle" onClick={() => setCalcOpen((s) => !s)} aria-label="计算器">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
					<rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth={1.2} />
					<path d="M7 7h10v3H7z" fill="currentColor" />
					<path d="M8.5 15.5h1.5v1.5H8.5zM11 15.5h1.5v1.5H11zM13.5 15.5h1.5v1.5h-1.5zM8.5 12h1.5v1.5H8.5zM11 12h1.5v1.5H11zM13.5 12h1.5v1.5h-1.5z" fill="currentColor" />
				</svg>
			</button>

			{/* commands icon - fixed, always visible like the sidebar toggle */}
			<button className="commands-toggle" onClick={() => setCommandsOpen((s) => !s)} aria-label="指令集">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
					<path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</button>

			{calcOpen && (
				<div
					className="calculator-overlay"
					role="presentation"
					onMouseDown={() => setCalcOpen(false)}
				>
					<div
						className="calculator-panel"
						role="dialog"
						aria-label="程序员计算器"
						onMouseDown={(e) => e.stopPropagation()}
					>
						<div className="calc-header">
							<div className="calc-title">计算器</div>
							<button className="calc-close" onClick={() => setCalcOpen(false)} aria-label="关闭">✕</button>
						</div>
						<ProgrammerCalculator onClose={() => setCalcOpen(false)} />
					</div>
				</div>
			)}

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
					<button className="commands-toggle" onClick={() => setCommandsOpen((s) => !s)} aria-label="指令集">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
							<path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
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
