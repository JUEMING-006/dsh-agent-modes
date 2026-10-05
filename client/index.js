/**
 * dsh-agent-modes 客户端入口（渲染进程）。
 * 遵循 dsh 客户端模块约定（参照 @deepseek-ai/dsh-client-ui-cordis/lib/client.js）：
 *   window.__ModuleLoader__.load({ id, factory(require) { ...; exports.apply; exports.inject; return module.exports } })
 * package.json 需要配套：exports["./client"] 指向本文件 + dsh.client.platform="web"。
 * UI 注册发生在客户端；数据来自插件宿主的本地看板 HTTP API；模型列表来自 dsh 设置（/api/models）。
 */
window.__ModuleLoader__.load({
	id: "dsh-agent-modes",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const { useState, useEffect, useRef, useCallback } = react;
		const e = react.createElement;

		/* ---------- 线性 SVG 图标 ---------- */
		const svg = (children, size) => e("svg", {
			width: size || 14, height: size || 14, viewBox: "0 0 24 24", fill: "none",
			stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round",
			style: { flexShrink: 0, display: "block" },
		}, children);
		const IconGrip = () => svg([
			e("circle", { cx: 9, cy: 6, r: 1.2, fill: "currentColor", stroke: "none" }),
			e("circle", { cx: 15, cy: 6, r: 1.2, fill: "currentColor", stroke: "none" }),
			e("circle", { cx: 9, cy: 12, r: 1.2, fill: "currentColor", stroke: "none" }),
			e("circle", { cx: 15, cy: 12, r: 1.2, fill: "currentColor", stroke: "none" }),
			e("circle", { cx: 9, cy: 18, r: 1.2, fill: "currentColor", stroke: "none" }),
			e("circle", { cx: 15, cy: 18, r: 1.2, fill: "currentColor", stroke: "none" }),
		], 12);
		const IconFlag = () => svg([
			e("path", { d: "M5 21V4" }),
			e("path", { d: "M5 4c2.5-1.5 5-1.5 7.5 0S17.5 5.5 20 4v9c-2.5 1.5-5 1.5-7.5 0S7.5 11.5 5 13" }),
		]);
		const IconLayers = () => svg([
			e("path", { d: "M12 3 3 8l9 5 9-5-9-5Z" }),
			e("path", { d: "m3 13 9 5 9-5" }),
		]);
		const IconShield = () => svg([
			e("path", { d: "M12 3l7 3v5.5c0 4.4-2.9 7.4-7 9-4.1-1.6-7-4.6-7-9V6l7-3Z" }),
			e("path", { d: "m9 11.5 2.2 2.2 4.3-4.2" }),
		]);
		const IconChevron = () => svg([e("path", { d: "m6 9 6 6 6-6" })], 13);
		const IconClose = () => svg([e("path", { d: "M6 6l12 12M18 6 6 18" })], 13);
		const IconRefresh = () => svg([
			e("path", { d: "M20 11a8 8 0 1 0-.9 4.6" }),
			e("path", { d: "M20 5v6h-6" }),
		], 13);
		const IconUser = () => svg([
			e("circle", { cx: 12, cy: 8, r: 3.4 }),
			e("path", { d: "M5.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5" }),
		], 13);
		const IconBubble = () => svg([
			e("path", { d: "M21 11.5a8 8 0 0 1-8 8c-1.2 0-2.4-.2-3.4-.7L4 20l1.3-4A8 8 0 1 1 21 11.5Z" }),
		], 13);
		const IconWrench = () => svg([
			e("path", { d: "M14.7 6.3a4.5 4.5 0 0 0-6 5.6L4 16.6V20h3.4l4.7-4.7a4.5 4.5 0 0 0 5.6-6l-2.6 2.6-2.4-2.4 2.6-2.6Z" }),
		], 13);
		const kindIcon = (k, size) => (k === "lead" ? IconFlag(size) : k === "verifier" ? IconShield(size) : IconLayers(size));
		const kindLabel = (k) => (k === "lead" ? "主控" : k === "verifier" ? "验证" : "执行");

		const usd = (n) => "$" + (n ?? 0).toFixed(2);
		const fmtK = (n) => (n >= 10000 ? (n / 1000).toFixed(1) + "k" : String(n ?? 0));
		const cut2 = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
		const fmtTime = (ts) => new Date(ts).toLocaleTimeString();
		const fmtStamp = (ts) => { const d = new Date(ts); return (d.getMonth() + 1) + "/" + d.getDate() + " " + d.toLocaleTimeString(); };
		const kindLabel2 = (k) => (k === "user" ? "用户" : k === "tool" ? "命令" : "智能体");
		const C = {
			bg: "#161b21", bg2: "#1a2028", line: "#2a313b", lineSoft: "#232a33",
			text: "#d7dde3", muted: "#8b949e", dim: "#6b7681",
			accent: "#3fa66a", accentSoft: "#23303a", accentText: "#7ec9a0",
			warn: "#e0a63f", danger: "#d45b5b",
		};
		const dot = (running) => ({ width: 8, height: 8, borderRadius: "50%", background: running ? C.warn : C.accent, flexShrink: 0, animation: running ? "dsh-am-pulse 1s infinite" : undefined });
		const tag = { fontSize: 11.5, padding: "1px 8px", borderRadius: 999, background: C.accentSoft };
		const meter = { height: 5, background: C.lineSoft, borderRadius: 3, overflow: "hidden" };
		const meterFill = (over, ratio) => ({ width: Math.round((ratio ?? 0) * 100) + "%", height: "100%", background: over ? C.danger : C.accent });

		const CSS = `
.am-ghost{background:transparent;border:1px solid ${C.lineSoft};color:${C.muted};border-radius:7px;padding:4px 8px;cursor:pointer;display:flex;align-items:center;transition:color .12s,border-color .12s;flex-shrink:0}
.am-ghost:hover{color:${C.accentText};border-color:${C.accent}}
.am-apply{background:#24483a;color:${C.accentText};border:none;border-radius:7px;padding:5px 12px;cursor:pointer;font-size:12px;flex-shrink:0;transition:filter .12s}
.am-apply:hover{filter:brightness(1.18)}
.am-apply:active{filter:brightness(.92)}
.am-mode{background:transparent;color:${C.text};border:1px solid ${C.lineSoft};border-radius:999px;padding:3px 11px;cursor:pointer;font-size:11.5px;white-space:nowrap;transition:all .12s}
.am-mode:hover{border-color:${C.accent};color:${C.accentText}}
.am-select{flex:1;min-width:0;background:#1e242c;color:${C.text};border:1px solid ${C.lineSoft};border-radius:8px;padding:5px 6px;font-size:12px;outline:none;transition:border-color .12s}
.am-select:hover{border-color:#39424e}
.am-select:focus{border-color:${C.accent}}
.am-input{flex:1;min-width:0;background:#1e242c;color:${C.text};border:1px solid ${C.lineSoft};border-radius:8px;padding:5px 6px;font-size:12px;outline:none}
.am-input:focus{border-color:${C.accent}}
.am-row{display:flex;gap:8px;align-items:center;padding:6px 4px;border-radius:8px;transition:background .12s}
.am-row:hover{background:rgba(255,255,255,.03)}
.am-spin{animation:dsh-am-rot .9s linear infinite}
@keyframes dsh-am-rot{to{transform:rotate(360deg)}}
`;

		function AgentModesBar(props) {
			const base = (props && props.base) || "http://127.0.0.1:3117";
			const [s, setS] = useState(null);
			const [open, setOpen] = useState(false);
			const [pos, setPos] = useState(null);
			const [dragging, setDragging] = useState(false);
			const [catalog, setCatalog] = useState(null);
			const [modes, setModes] = useState([]);
			const [draft, setDraft] = useState({});
			const [refreshing, setRefreshing] = useState(false);
			const [newModeName, setNewModeName] = useState("");
			const [sessions, setSessions] = useState([]);
			const [selSession, setSelSession] = useState("");
			const [feed, setFeed] = useState(null);
			const pillRef = useRef(null);
			const drag = useRef({ timer: 0, moved: false, startX: 0, startY: 0, baseLeft: 0, baseTop: 0, w: 0 });

			useEffect(() => {
				try {
					const saved = localStorage.getItem("agent-modes:pos");
					if (saved) {
						const p = JSON.parse(saved);
						setPos({
							x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - 120)),
							y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - 44)),
						});
					}
				} catch {}
				let alive = true;
				const tick = () => fetch(base + "/api/status")
					.then((r) => r.json())
					.then((d) => { if (alive) setS(d); })
					.catch(() => {});
				tick();
				const t = setInterval(tick, 3000);
				return () => { alive = false; clearInterval(t); };
			}, [base]);

			const loadCatalog = useCallback((force) => {
				return fetch(base + "/api/models" + (force ? "?force=1" : ""))
					.then((r) => r.json())
					.then((d) => { setCatalog(d); return d; })
					.catch(() => { setCatalog({ available: false, providers: [] }); });
			}, [base]);
			useEffect(() => {
				if (!open) return;
				if (!catalog) loadCatalog(false);
				if (!modes.length) fetch(base + "/api/modes").then((r) => r.json()).then((list) => setModes(list.map((m) => ({ id: m.id, name: m.name })))).catch(() => {});
				if (!sessions.length) fetch(base + "/api/sessions").then((r) => r.json()).then((list) => { setSessions(list); if (list.length) setSelSession((cur) => cur || list[0].key); }).catch(() => {});
			}, [open, catalog, modes.length, sessions.length, loadCatalog, base]);
			useEffect(() => {
				if (!open || !selSession) return;
				setFeed(null);
				fetch(base + "/api/session-feed?key=" + encodeURIComponent(selSession))
					.then((r) => r.json())
					.then(setFeed)
					.catch(() => setFeed({ title: "", entries: [] }));
			}, [open, selSession, base]);

			/* ---------- 长按拖拽（320ms 起拖；pointer capture 保证跟手；位置记忆） ---------- */
			const clamp = (x, y, w) => ({
				x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)),
				y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 44)),
			});
			const onPointerDown = (ev) => {
				const el = pillRef.current;
				if (!el) return;
				try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch {}
				ev.preventDefault();
				drag.current = {
					timer: 0, moved: false, handled: false,
					startX: ev.clientX, startY: ev.clientY,
					baseLeft: pos ? pos.x : el.getBoundingClientRect().left,
					baseTop: pos ? pos.y : el.getBoundingClientRect().top,
					w: el.offsetWidth,
				};
				drag.current.timer = setTimeout(() => setDragging(true), 320);
			};
			const onPointerMove = (ev) => {
				const d = drag.current;
				const dx = ev.clientX - d.startX, dy = ev.clientY - d.startY;
				if (!dragging) {
					if (Math.abs(dx) + Math.abs(dy) > 6) clearTimeout(d.timer);
					return;
				}
				d.moved = true;
				setPos(clamp(d.baseLeft + dx, d.baseTop + dy, d.w));
			};
			const finishGesture = () => {
				// pointerup 之后浏览器还会补发 lostpointercapture/pointercancel —— 去重，否则点一下开合两次
				if (drag.current.handled) return;
				drag.current.handled = true;
				clearTimeout(drag.current.timer);
				if (dragging) {
					setDragging(false);
					setPos((p) => {
						if (p) { try { localStorage.setItem("agent-modes:pos", JSON.stringify(p)); } catch {} }
						return p;
					});
					return;
				}
				if (!drag.current.moved) setOpen((o) => !o);
			};

			const doRefresh = () => {
				setRefreshing(true);
				Promise.resolve(loadCatalog(true)).finally(() => setTimeout(() => setRefreshing(false), 500));
			};
			const setRole = (r) => {
				const v = draft[r.role] || { provider: r.provider, model: r.model };
				fetch(base + "/api/role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: r.role, provider: v.provider, model: v.model }) })
					.then(() => tick2(base, setS));
			};
			const switchMode = (id) => {
				fetch(base + "/api/mode/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then(() => refreshAll(base, setS, setModes));
			};
			const removeMode = (id) => {
				if (!window.confirm("删除该模式？")) return;
				fetch(base + "/api/mode/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
					.then((r) => r.json())
					.then((res) => { if (res.error) { window.alert(res.error); return; } refreshAll(base, setS, setModes); });
			};
			const saveMode = () => {
				const name = (newModeName || "").trim();
				if (!name) { window.alert("先输入模式名称，再把当前编队保存为新模式"); return; }
				fetch(base + "/api/mode/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })
					.then((r) => r.json())
					.then((res) => { if (res.error) { window.alert(res.error); return; } setNewModeName(""); refreshAll(base, setS, setModes); });
			};
			const modelOptions = (r) => {
				const current = r.provider + "::" + r.model;
				const opts = [];
				let inList = false;
				if (catalog?.available) {
					for (const p of catalog.providers) {
						const children = [];
						for (const m of p.models) {
							const v = p.id + "::" + m.id;
							if (v === current) inList = true;
							children.push(e("option", { value: v, key: v }, m.name && m.name !== m.id ? m.id + " · " + m.name : m.id));
						}
						if (children.length) opts.push(e("optgroup", { label: p.name, key: p.id }, children));
					}
				}
				if (!inList) opts.unshift(e("option", { value: current, key: "current" }, "（当前）" + r.provider + " / " + r.model));
				return opts;
			};

			const anchorStyle = pos
				? { position: "fixed", left: pos.x, top: pos.y, pointerEvents: "auto", zIndex: 30 }
				: { position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 14, pointerEvents: "auto", zIndex: 30 };
			const pillStyle = {
				display: "flex", alignItems: "center", gap: 8,
				padding: "7px 13px", background: C.bg2, color: C.text,
				border: "1px solid " + (dragging ? C.accent : C.line), borderRadius: 999,
				boxShadow: dragging ? "0 10px 30px rgba(0,0,0,.55)" : "0 4px 16px rgba(0,0,0,.4)",
				cursor: dragging ? "grabbing" : "grab", fontSize: 12.5, userSelect: "none",
				whiteSpace: "nowrap", transition: dragging ? "none" : "border-color .15s, box-shadow .15s",
				touchAction: "none",
			};
			const chip = (k) => ({
				width: 27, height: 27, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
				background: k === "lead" ? "#2b2a1c" : k === "verifier" ? "#1c2a30" : C.accentSoft,
				color: k === "lead" ? "#d0b95e" : k === "verifier" ? "#5eb6d0" : C.accentText,
			});
			const section = { margin: "13px 0 5px", fontSize: 11, letterSpacing: ".05em", color: C.muted, display: "flex", alignItems: "center", justifyContent: "space-between" };
			const modeBtn = (m, active) => ({
				background: active ? C.accent : "transparent", color: active ? "#0d1117" : C.text,
				border: "1px solid " + (active ? C.accent : C.lineSoft), borderRadius: 999,
			});

			if (!s) {
				return e("div", { style: { ...anchorStyle, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 } },
					e("style", null, CSS),
					e("div", { style: pillStyle, title: "智能体编队：看板连接中" },
						e("span", { style: { color: C.dim, display: "flex" } }, IconGrip()),
						e("span", { style: dot(false) }),
						e("span", { style: { color: C.muted } }, "智能体编队：连接看板中…")));
			}
			return e("div", { style: { ...anchorStyle, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 } },
				e("style", null, CSS + "@keyframes dsh-am-pulse{50%{opacity:.35}}"),
				open && e("div", {
					style: { width: 470, maxHeight: "min(440px, 62vh)", overflow: "auto", background: C.bg, color: C.text, border: "1px solid " + C.line, borderRadius: 14, boxShadow: "0 12px 36px rgba(0,0,0,.55)", padding: "12px 14px", fontSize: 12.5 },
				},
					e("div", { style: { display: "flex", alignItems: "center", gap: 8, paddingBottom: 8, borderBottom: "1px solid " + C.lineSoft } },
						e("b", { style: { fontSize: 13 } }, "智能体编队"),
						e("span", { style: { ...tag, color: C.accentText } }, s.activeModeId),
						e("span", { style: { flex: 1 } }),
						e("button", { title: "刷新模型目录", onClick: doRefresh, className: "am-ghost" },
							e("span", { className: refreshing ? "am-spin" : undefined, style: { display: "flex" } }, IconRefresh())),
						e("button", { title: "收起", onClick: () => setOpen(false), className: "am-ghost" }, IconClose())),
					e("div", { style: section }, e("span", null, "会话与损耗"),
						e("span", { style: { color: C.dim, fontSize: 10.5 } },
							(() => {
								const cur = sessions.find((x) => x.key === selSession);
								return cur ? "入 " + cur.usage.inputTokens + " · 出 " + cur.usage.outputTokens + " tokens" : sessions.length ? "最近 " + sessions.length + " 个" : "无记录";
							})())),
					sessions.length && e("select", {
						className: "am-select", value: selSession,
						onChange: (ev) => setSelSession(ev.target.value),
					}, sessions.map((ss) => e("option", { value: ss.key, key: ss.key }, cut2(ss.title || "未命名", 26) + " · " + fmtStamp(ss.updatedAt)))),
					feed && e("div", {
						style: { maxHeight: 250, overflow: "auto", border: "1px solid " + C.lineSoft, borderRadius: 10, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 7 },
					},
						feed.entries.length
							? feed.entries.map((en, i) => e("div", { key: i, className: "am-row", style: { alignItems: "flex-start" } },
								e("div", { style: { ...chip(en.kind === "tool" ? "worker" : en.kind === "user" ? "lead" : "verifier"), width: 24, height: 24 } },
									en.kind === "user" ? IconUser() : en.kind === "tool" ? IconWrench() : IconBubble()),
								e("div", { style: { flex: 1, minWidth: 0 } },
								e("div", { style: { display: "flex", gap: 6, alignItems: "center", marginBottom: 2 } },
									e("span", { style: { fontSize: 10.5, color: C.dim } }, kindLabel2(en.kind) + " " + fmtTime(en.ts)),
									en.tool && e("span", { style: { fontSize: 10.5, color: C.text, background: C.lineSoft, padding: "0 6px", borderRadius: 6 } }, en.tool),
									en.model && e("span", { style: { fontSize: 10, color: C.accentText, background: C.accentSoft, padding: "0 6px", borderRadius: 6 } }, en.model.split("/").pop()),
									en.usage && e("span", { style: { fontSize: 10, color: C.dim } }, "入 " + en.usage.inputTokens + " · 出 " + en.usage.outputTokens)),
									e("div", { style: { fontSize: 12, color: en.error ? C.danger : en.kind === "user" ? C.text : C.muted, whiteSpace: "pre-wrap", wordBreak: "break-word" } }, en.text))))
							: e("div", { style: { color: C.dim, fontSize: 11.5 } }, "该会话暂无可展示的对话/命令")),
					e("div", { style: section }, e("span", null, "编队模式（点击切换，× 删除）")),
					e("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
						modes.map((m) => e("span", {
							key: m.id,
							className: "am-mode",
							style: { ...modeBtn(m, m.id === s.activeModeId), display: "inline-flex", alignItems: "center", gap: 5 },
						},
							e("span", { onClick: () => switchMode(m.id), style: { cursor: "pointer" } }, m.name || m.id),
							e("span", { title: "删除该模式", onClick: (ev) => { ev.stopPropagation(); removeMode(m.id); }, style: { color: m.id === s.activeModeId ? "#0d1117" : C.dim, cursor: "pointer", fontWeight: 700 } }, "×")))),
					e("div", { style: { display: "flex", gap: 6, marginTop: 6 } },
						e("input", { className: "am-input", placeholder: "输入名称，把当前编队保存为新模式（不同项目可各存一套）", value: newModeName, onChange: (ev) => setNewModeName(ev.target.value) }),
						e("button", { className: "am-apply", onClick: saveMode }, "保存")),
					e("div", { style: section }, e("span", null, "角色与模型"), e("span", { style: { color: C.dim } }, catalog?.available ? "模型来自 dsh 设置" : refreshing ? "读取模型目录中…" : "输入 provider / 模型")),
					(s.roles || []).map((r) => {
						const sel = draft[r.role] || { provider: r.provider, model: r.model };
						return e("div", { key: r.role, className: "am-row" },
							e("div", { style: chip(r.kind), title: kindLabel(r.kind) }, kindIcon(r.kind, 15)),
							e("div", { style: { width: 88, flexShrink: 0 } },
								e("div", { style: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" } }, r.role),
								e("div", { style: { fontSize: 10.5, color: C.dim } }, kindLabel(r.kind))),
							catalog?.available
								? e("select", {
									className: "am-select", value: sel.provider + "::" + sel.model,
									onChange: (ev) => { const idx = ev.target.value.indexOf("::"); const pv = ev.target.value.slice(0, idx); const md = ev.target.value.slice(idx + 2); setDraft((d) => ({ ...d, [r.role]: { provider: pv, model: md } })); },
								}, modelOptions(r))
								: e("input", {
									className: "am-input", value: sel.provider + " / " + sel.model,
									onChange: (ev) => { const parts = ev.target.value.split("/"); const md = parts.pop().trim(); const pv = parts.join("/").trim(); setDraft((d) => ({ ...d, [r.role]: { provider: pv, model: md } })); },
								}),
							e("button", { className: "am-apply", onClick: () => setRole(r) }, "应用"));
					}),
					e("div", { style: section }, e("span", null, "本月 Token（编队调用）"), e("span", { style: { color: C.muted } }, "↑" + fmtK(s.monthTok?.promptTokens) + " ↓" + fmtK(s.monthTok?.completionTokens) + " · " + (s.monthTok?.calls ?? 0) + " 次")),
					e("div", { style: section }, e("span", null, "动态")),
					(s.log || []).slice(-5).reverse().map((l) =>
						e("div", { key: l.ts, style: { fontSize: 11.5, color: C.muted, marginTop: 3, fontFamily: "ui-monospace, monospace" } }, new Date(l.ts).toLocaleTimeString() + "  " + l.text)),
					e("div", { style: { marginTop: 10, fontSize: 10.5, color: C.dim, textAlign: "center" } }, "长按横条拖动位置 · 看板 " + base)),
				e("div", {
					ref: pillRef, style: pillStyle,
					onPointerDown, onPointerMove, onPointerUp: finishGesture,
					onPointerCancel: finishGesture, onLostPointerCapture: finishGesture,
				},
					e("span", { style: { color: C.dim, display: "flex" } }, IconGrip()),
					e("span", { style: dot(s.running) }),
					e("b", null, "编队 " + s.activeModeId),
					e("span", { style: { color: C.muted, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" } }, s.running ? s.activity : "空闲"),
					e("span", { style: { borderLeft: "1px solid " + C.lineSoft, paddingLeft: 10 } },
						e("span", { style: { color: C.accentText } }, "↑" + fmtK(s.today?.total?.promptTokens) + " ↓" + fmtK(s.today?.total?.completionTokens)),
						e("span", { style: { color: C.dim } }, " tok · " + (s.today?.total?.calls ?? 0) + " 次")),
					e("span", { style: { color: C.muted, display: "flex", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" } }, IconChevron())));
		}

		function tick2(base, setS) {
			fetch(base + "/api/status").then((r) => r.json()).then(setS).catch(() => {});
		}

		const inject = ["slots"];

		function apply(ctx) {
			const base = "http://127.0.0.1:3117";
			ctx.effect(() => {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "agent-modes-bar",
					order: 10,
					inject: () => ({ base }),
				}, AgentModesBar));
			}, "agent-modes: shell.overlay 悬浮横条");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
