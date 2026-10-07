import '../../../assets/fonts/fonts.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Canvas root #app is missing from index.html');

export default mount(App, { target });
