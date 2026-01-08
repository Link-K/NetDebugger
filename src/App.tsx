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

	const [ip, setIp] = useState("0.0.0.0");
	const [port, setPort] = useState("9000");
	const ipRegex = /^((25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(25[0-5]|2[0-4]\d|[01]?\d?\d)$/;

	const isValidIP = (v: string) => ipRegex.test(v.trim());
	const isValidPort = (v: string) => {
		const n = Number(v);
		return Number.isInteger(n) && n >= 1 && n <= 65535;
	};
	const [connected, setConnected] = useState(false);
	const [status, setStatus] = useState("");

	useEffect(() => {
		if (editorRef.current) editorRef.current.innerHTML = html;
	}, []);

	useEffect(() => {
		const escapeHtml = (s: string) =>
			s
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&#039;");

		let unlistenMessage: (() => void) | null = null;
		let unlistenError: (() => void) | null = null;

		(async () => {
			unlistenMessage = await listen("udp:message", (event) => {
				try {
					const payload: any = event.payload as any;
					const from = payload.from ?? "unknown";
					const b64 = payload.data ?? "";
					const binStr = atob(b64 || "");
					const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
					const text = new TextDecoder().decode(bytes);
					const snippet = `<div><strong>${escapeHtml(from)}</strong>: <pre style=\"white-space:pre-wrap; margin:0;\">${escapeHtml(text)}</pre></div>`;
					if (editorRef.current) {
						editorRef.current.insertAdjacentHTML("beforeend", snippet);
						setHtml(editorRef.current.innerHTML);
					}
				} catch (e) {
					// ignore per-message errors
				}
			});

			unlistenError = await listen("udp:server:error", (event) => {
				const payload: any = event.payload as any;
				const msg = payload?.error ?? "unknown error";
				setStatus(String(msg));
			});
		})();

		return () => {
			if (unlistenMessage) unlistenMessage();
			if (unlistenError) unlistenError();
		};
	}, []);

	const toggleConnection = async () => {
		if (!connected) {
			const bindAddr = `${ip}:${port}`;
			try {
				const res = await invoke<string>("start_udp_server", { bindAddr });
				setStatus(res ?? "started");
				setConnected(true);
			} catch (e) {
				setStatus(String(e));
			}
		} else {
			try {
				const res = await invoke<string>("stop_udp_server");
				setStatus(res ?? "stopped");
				setConnected(false);
			} catch (e) {
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
				style={{ border: "1px solid #ccc", minHeight: 120, padding: 8, borderRadius: 4 }}
				aria-label="富文本编辑器"
			/>

			<div style={{ marginBottom: 8 }}>
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
							navigator.clipboard.writeText(editorRef.current.innerHTML);
						}
					}}
				>
					复制消息
				</button>
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
						}}
						disabled={connected}
						style={{ width: 140 }}
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
							if (!isValidPort(port)) setStatus("Port 格式无效");
							else setStatus("");
						}}
						disabled={connected}
						style={{ width: 80 }}
					/>
				</label>
				<button type="button" onClick={toggleConnection} style={{ padding: "6px 12px" }}>
					{connected ? "断开" : "连接"}
				</button>
				<span style={{ marginLeft: 8 }}>{status}</span>
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
