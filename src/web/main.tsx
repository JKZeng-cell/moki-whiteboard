import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./styles.css";
import { installModalOutsideDismiss } from '../vendor/moki/web/lib/modal-outside-dismiss.js';
import {installBrowserResourceBridge} from './library-adapter.js';

installModalOutsideDismiss();
installBrowserResourceBridge();

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
