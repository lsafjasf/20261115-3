import { createApp } from './app.js';

const canvas = document.getElementById('map');
createApp(canvas, { toolbar: document.getElementById('toolbar') });
