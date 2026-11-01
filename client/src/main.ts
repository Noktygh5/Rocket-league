import './style.css';
import { App } from './ui';

const app = new App();
(window as unknown as { app: App }).app = app;
app.mainMenu();
