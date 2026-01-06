import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function useCounter(start = 0) {
	const [count, setCount] = useState(start);
	useEffect(() => {
		const id = setInterval(() => setCount((c) => c + 1), 1000);
		return () => clearInterval(id);
	}, []);
	return count;
}

function ViewA({ active }: { active: boolean }) {
	const c = useCounter(0);
	return (
		<div className={"view" + (active ? " active" : " hidden")}>
			<h2>视图 A</h2>
			<p>计数器: {c} (在后台继续运行)</p>
		</div>
	);
}

function ViewB({ active }: { active: boolean }) {
	const c = useCounter(100);
	return (
		<div className={"view" + (active ? " active" : " hidden")}>
			<h2>视图 B</h2>
			<p>计数器: {c} (在后台继续运行)</p>
		</div>
	);
}

function ViewC({ active }: { active: boolean }) {
	const c = useCounter(200);
	return (
		<div className={"view" + (active ? " active" : " hidden")}>
			<h2>视图 C</h2>
			<p>计数器: {c} (在后台继续运行)</p>
		</div>
	);
}

function ViewD({ active }: { active: boolean }) {
	const c = useCounter(300);
	return (
		<div className={"view" + (active ? " active" : " hidden")}>
			<h2>视图 D</h2>
			<p>计数器: {c} (在后台继续运行)</p>
		</div>
	);
}

function App() {
	const [greetMsg, setGreetMsg] = useState("");
	const [name, setName] = useState("");
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [active, setActive] = useState<"a" | "b" | "c" | "d">("a");

	async function greet() {
		setGreetMsg(await invoke("greet", { name }));
	}

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
						视图 A
					</button>
					<button
						className={active === "b" ? "active" : ""}
						onClick={() => setActive("b")}
					>
						视图 B
					</button>
					<button
						className={active === "c" ? "active" : ""}
						onClick={() => setActive("c")}
					>
						视图 C
					</button>
					<button
						className={active === "d" ? "active" : ""}
						onClick={() => setActive("d")}
					>
						视图 D
					</button>
				</div>
			</aside>

			<main className={"content" + (sidebarOpen ? " shift" : "")}>
				<div className="container">
					<h1>Welcome to Tauri + React</h1>

					<form
						className="row"
						onSubmit={(e) => {
							e.preventDefault();
							greet();
						}}
					>
						<input
							id="greet-input"
							onChange={(e) => setName(e.currentTarget.value)}
							placeholder="Enter a name..."
						/>
						<button type="submit">Greet</button>
					</form>
					<p>{greetMsg}</p>
				</div>

				<section className="views">
					<ViewA active={active === "a"} />
					<ViewB active={active === "b"} />
					<ViewC active={active === "c"} />
					<ViewD active={active === "d"} />
				</section>
			</main>
		</div>
	);
}

export default App;
