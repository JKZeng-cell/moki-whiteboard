import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import {SharedWhiteboard} from './shared-whiteboard.js';
import "./styles.css";
import './lan-sharing.css';
import './sharing-ui.css';
import { installModalOutsideDismiss } from '../vendor/moki/web/lib/modal-outside-dismiss.js';
import {installBrowserResourceBridge} from './library-adapter.js';

installModalOutsideDismiss();
const shareToken=/^\/share\/([A-Za-z0-9_-]+)$/u.exec(location.pathname)?.[1];
if(!shareToken)installBrowserResourceBridge();

createRoot(document.getElementById("root")!).render(<StrictMode>{shareToken?<SharedWhiteboard token={shareToken}/>:<App/>}</StrictMode>);
