Svelte AI Elements (https://github.com/SikandarJODD/ai-elements, MIT, at 0aabbc6),
the unofficial Svelte 5 port of Vercel's AI Elements, copied in as shadcn-svelte
copies its components: ours from here on. Only the parts the agent panel's chat
draws, adapted to this plain Vite app: a fold is a native `<details>` (no
bits-ui), Response is the house `Markdown.svelte` (no streamdown or shiki), no
runed and no icons; themed by DESIGN.md's tokens through `app.css`.
