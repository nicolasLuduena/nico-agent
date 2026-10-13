import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { reading } from "./route";
import WikiPage from "./wiki/WikiPage.svelte";

// A Wiki's page, `/wiki/<id>`, or the Board.
mount(reading(location.pathname, location.hash) ? WikiPage : App, { target: document.getElementById("app")! });
