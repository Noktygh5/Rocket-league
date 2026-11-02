import './style.css';
import { DevTools } from './dev';
import { OnlineUi } from './onlineUi';
import { App } from './ui';

const app = new App();
(window as unknown as { app: App }).app = app;
const online = new OnlineUi(app);
new DevTools(app);

// quality changes made while a match runs are saved by the settings screen; prevent the page from scrolling
window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault(); });

const room = new URLSearchParams(location.search).get('room');
if (room && /^[A-Za-z]{5}$/.test(room)) online.autoJoin(room.toUpperCase());
else app.mainMenu();
