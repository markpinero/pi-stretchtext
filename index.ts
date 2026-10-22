// stretchtext: cc-stretch (https://github.com/pro-vi/cc-stretch) for Pi.
// Replies carry `{{short|long}}` stretches. Pi draws each closed one as its underlined short form;
// in fullscreen a click on it opens it in place and a click on « closes it. alt+o puts a letter
// over each closed stretch and typing it opens it; alt+c does the same over each « to close. alt+a
// opens every stretch of the latest reply, or closes them all when all are open.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { LinkTable } from "./src/links.ts";
import { Store } from "./src/monad.ts";
import { onMarkdownClick } from "./src/mouse.ts";
import { GUIDE } from "./src/prompt.ts";
import { draw } from "./src/render.ts";
import { Screen } from "./src/screen.ts";
import { initialState, isOpen, pickLetter, remember, settle, startLettering, takeReadNote, toggle } from "./src/state.ts";
import type { Mode } from "./src/state.ts";
import type { Target } from "./src/target.ts";
import { isLinkable, parse, stretches } from "./src/parse.ts";
import type { Stretch } from "./src/parse.ts";

export default function stretchtext(pi: ExtensionAPI) {
	const screen = new Screen();
	const store = new Store(initialState, () => screen.redraw());
	const links = new LinkTable();

	/** Opens a closed stretch or closes an open one, at once: no grow or shrink animation. */
	function toggleStretch(target: Target) {
		const isOpening = store.run(toggle(target));
		store.run(settle(target, isOpening));
	}

	/** Opens every stretch of the latest reply holding one; when all are open already, closes them all. */
	function toggleAll(ctx: ExtensionContext) {
		const reply = store.current.replies.at(-1);
		if (reply === undefined) return ctx.ui.notify("stretchtext: nothing to open", "info");
		const all = parse(reply).filter((segment): segment is Stretch => typeof segment !== "string" && isLinkable(segment));
		const closed = all.filter((stretch) => !isOpen(store.current, reply, stretch.key));
		(closed.length > 0 ? closed : all).forEach((stretch) => toggleStretch({ reply, stretch }));
	}

	function askForLetter(ctx: ExtensionContext, mode: Mode) {
		if (ctx.mode !== "tui") return;
		if (!store.run(startLettering(mode))) {
			ctx.ui.notify(`stretchtext: nothing to ${mode}`, "info");
			return;
		}
		void ctx.ui.custom<void>((tui, theme, _keys, done) => {
			screen.attach(tui, theme);
			return {
				render: (width: number) => [theme.fg("dim", `stretch: type a letter to ${mode} (any other key cancels)`.slice(0, width))],
				invalidate: () => {},
				handleInput: (key: string) => {
					store.run(pickLetter(key)).forEach(toggleStretch);
					done();
				},
			};
		});
	}

	onMarkdownClick((line, x) => links.at(line, x).map((target) => () => toggleStretch(target)));

	pi.registerMarkdownTransformer((markdown, { messageType }) => {
		if (messageType !== "assistant" || !markdown.includes("{{")) return markdown;
		const segments = parse(markdown);
		if (stretches(segments).length === 0) return markdown;
		store.run(remember(markdown));
		return draw(store.current, { links, theme: screen.theme }, markdown, segments);
	});

	pi.on("before_agent_start", (event) => {
		const sections = event.systemPromptOptions.sections;
		sections.stretchtext = GUIDE;
		store.run(takeReadNote()).match({
			some: (note) => {
				sections.stretchtext_read = note;
			},
			none: () => {
				delete sections.stretchtext_read;
			},
		});
	});

	// An empty widget below the editor draws nothing and takes no row; it is only how an extension gets the TUI.
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget(
			"stretchtext",
			(tui, theme) => {
				screen.attach(tui, theme);
				return { render: () => [], invalidate: () => {} };
			},
			{ placement: "belowEditor" },
		);
	});

	pi.registerShortcut("alt+o", {
		description: "stretchtext: letters over closed stretches, to open one",
		handler: (ctx) => askForLetter(ctx, "open"),
	});
	pi.registerShortcut("alt+a", {
		description: "stretchtext: open every stretch of the latest reply, or close them all when all are open",
		handler: (ctx) => toggleAll(ctx),
	});
	pi.registerShortcut("alt+c", {
		description: "stretchtext: letters over open stretches, to close one",
		handler: (ctx) => askForLetter(ctx, "close"),
	});
}
